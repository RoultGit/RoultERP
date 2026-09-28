/**
 * La cola de envío a SUNAT.
 *
 * SUNAT tarda lo que tarda y a veces no contesta; eso no está en nuestras
 * manos. Lo que se fija aquí es lo que sí: que una caída no pierda
 * comprobantes, que no se reintente en bucle contra un servicio caído, y que
 * lo que nunca va a entrar deje de reintentarse y se denuncie en vez de
 * esconderse en el registro.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { zipSync } from "fflate";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { certificadoDePrueba, pfxDePrueba } from "@roulterp/core/cpe";
import {
  crearEmpresa, cargarCertificado, guardarCredencialesSol, emitirVenta,
  enviarPendientes, estadoDeLaCola, reencolar, esperaTrasFallo, MAX_INTENTOS,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(7);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let clienteId = "";
let productoId = "";
let almacenId = "";

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  app = conectar({ url: URL, rol: "app", max: 4 });
});
after(async () => {
  await raw?.end();
  await app?.cliente.end();
});

beforeEach(async () => {
  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  const e = await crearEmpresa(
    URL,
    { ruc: "20303051831", razonSocial: "SERVIDIMAR S.A.C." },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, pais, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'MINERA CERRO VERDE S.A.A.', 'PE', true) RETURNING id`;
  clienteId = c!.id;
  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  productoId = p!.id;
  const [a] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = a!.id;
  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'FA01', 0)`;

  await con(async (db) => {
    await registrarStock(db);
    await cargarCertificado(
      db, empresaId, usuarioId,
      pfxDePrueba(certificadoDePrueba("20303051831"), "clave"), "clave", KEK, "prueba",
    );
    await guardarCredencialesSol(db, empresaId, usuarioId,
      { usuarioSol: "MODDATOS", claveSol: "moddatos", entorno: "beta" }, KEK, "prueba");
  });
});

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);

async function registrarStock(db: Db) {
  const { registrarMovimiento } = await import("../src/inventario.ts");
  const { money } = await import("@roulterp/core");
  await registrarMovimiento(db, empresaId, {
    almacenId, productoId, fecha: "2026-09-01", sentido: "ingreso",
    tipoOperacion: "ajuste_inicial", cantidad: money.dec("500"), costoUnitario: money.dec("50"),
  });
}

async function emitir(numero: number): Promise<string> {
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId, tipoDocumento: "01", serie: "FA01",
      fechaEmision: "2026-09-10", moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId, cantidad: String(numero), valorUnitario: "100" }],
    }),
  );
  return r.comprobanteId;
}

/**
 * Un SUNAT de mentira.
 *
 * El CDR tiene que ser un ZIP de verdad con su XML dentro: es lo que el
 * cliente descomprime para leer el código de respuesta, y uno inválido haría
 * fallar el envío por una razón que no es la que la prueba quiere provocar.
 */
const cdrFalso = (codigo: string, descripcion: string) =>
  Buffer.from(
    zipSync({
      "R-1.xml": new TextEncoder().encode(
        `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x">` +
          `<cbc:ResponseCode>${codigo}</cbc:ResponseCode>` +
          `<cbc:Description>${descripcion}</cbc:Description></ApplicationResponse>`,
      ),
    }),
  ).toString("base64");

const respuestaAceptada = () =>
  new Response(
    `<soap:Envelope xmlns:soap="http://x"><soap:Body><applicationResponse>` +
      `${cdrFalso("0", "La Factura ha sido aceptada")}</applicationResponse></soap:Body></soap:Envelope>`,
    { status: 200 },
  );

function sunatQue(respuesta: "acepta" | "cae"): typeof fetch {
  return (async () => {
    if (respuesta === "cae") throw new TypeError("fetch failed: ECONNRESET");
    return respuestaAceptada();
  }) as unknown as typeof fetch;
}

describe("la espera entre reintentos", () => {
  test("dobla en cada fallo y se detiene en una hora", () => {
    // Reintentar cada segundo contra un servicio caído consigue que SUNAT
    // corte por abuso y que el registro se llene de la misma línea mil veces.
    const min = (n: number) => esperaTrasFallo(n) / 60_000;
    assert.equal(min(1), 1);
    assert.equal(min(2), 2);
    assert.equal(min(3), 4);
    assert.equal(min(7), 60, "topa en una hora");
    assert.equal(min(20), 60);
  });
});

describe("vaciar la cola", () => {
  test("lo emitido entra en la cola sin hablar con SUNAT", async () => {
    // Emitir es instantáneo: el mostrador nunca espera a SUNAT.
    await emitir(1);
    await emitir(2);
    const cola = await estadoDeLaCola(app, ctx());
    assert.equal(cola.length, 2);
    assert.ok(cola.every((c) => c.intentos === 0 && !c.atascado));
  });

  test("una caída de SUNAT no pierde nada y reprograma con espera", async () => {
    await emitir(1);
    const ahora = new Date("2026-09-10T10:00:00Z");
    const r = await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("cae"), ahora });

    assert.equal(r.intentados, 1);
    assert.equal(r.aceptados, 0);
    assert.equal(r.reprogramados, 1, "sigue en la cola, no se perdió");

    const [c] = await estadoDeLaCola(app, ctx());
    assert.equal(c!.intentos, 1);
    assert.ok(c!.ultimoError, "queda dicho por qué falló");
    assert.ok(c!.reintentarDesde! > ahora, "y cuándo se vuelve a intentar");
  });

  test("no se reintenta antes de tiempo", async () => {
    await emitir(1);
    const t0 = new Date("2026-09-10T10:00:00Z");
    await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("cae"), ahora: t0 });

    // Treinta segundos después todavía no le toca.
    const pronto = await enviarPendientes(app, ctx(), KEK, {
      fetchImpl: sunatQue("acepta"),
      ahora: new Date(t0.getTime() + 30_000),
    });
    assert.equal(pronto.intentados, 0, "respeta su turno");

    // Dos minutos después, sí.
    const luego = await enviarPendientes(app, ctx(), KEK, {
      fetchImpl: sunatQue("acepta"),
      ahora: new Date(t0.getTime() + 120_000),
    });
    assert.equal(luego.intentados, 1);
  });

  test("lo que nunca va a entrar deja de reintentarse y se denuncia", async () => {
    // Un RUC inválido no entra por mucho que se insista. Reintentarlo para
    // siempre escondería el problema en el registro.
    await emitir(1);
    let ahora = new Date("2026-09-10T10:00:00Z");
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("cae"), ahora });
      ahora = new Date(ahora.getTime() + 3 * 60 * 60_000);
    }
    const [c] = await estadoDeLaCola(app, ctx());
    assert.equal(c!.intentos, MAX_INTENTOS);
    assert.equal(c!.atascado, true);
    assert.equal(c!.reintentarDesde, null, "ya no espera turno: espera a una persona");

    // Y la cola deja de tocarlo.
    const r = await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("acepta"), ahora });
    assert.equal(r.intentados, 0);

    // Hasta que alguien lo corrige y lo devuelve a la cola.
    await reencolar(app, ctx(), c!.id);
    const tras = await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("acepta"), ahora });
    assert.equal(tras.intentados, 1);
  });

  test("un fallo no arrastra a los demás", async () => {
    // Uno por transacción: si el número doce falla, los once anteriores ya
    // están declarados.
    await emitir(1);
    await emitir(2);
    await emitir(3);
    let llamada = 0;
    const alternante = (async () => {
      llamada++;
      if (llamada === 2) throw new TypeError("fetch failed");
      return respuestaAceptada();
    }) as unknown as typeof fetch;

    const r = await enviarPendientes(app, ctx(), KEK, { fetchImpl: alternante, limite: 3 });
    assert.equal(r.intentados, 3);
    assert.equal(r.aceptados, 2, "los otros dos quedaron declarados");
    assert.equal(r.reprogramados, 1, "sólo el que falló vuelve a la cola");
    assert.equal((await estadoDeLaCola(app, ctx())).length, 1);
  });

  test("el límite acota el trabajo de una pasada", async () => {
    // Sin él, la primera ejecución tras una caída larga intentaría vaciarlo
    // todo en una petición y se cortaría por tiempo a la mitad.
    for (let i = 1; i <= 5; i++) await emitir(i);
    const r = await enviarPendientes(app, ctx(), KEK, { fetchImpl: sunatQue("cae"), limite: 2 });
    assert.equal(r.intentados, 2);
    assert.equal((await estadoDeLaCola(app, ctx())).length, 5);
  });

  test("los atascados salen primero en la lista", async () => {
    // Son los que necesitan que alguien haga algo, y los que se perderían al
    // final de una lista larga.
    await emitir(1);
    await emitir(2);
    const cola0 = await estadoDeLaCola(app, ctx());
    await raw`UPDATE comprobantes SET intentos_envio = ${MAX_INTENTOS} WHERE id = ${cola0[1]!.id}`;
    const cola = await estadoDeLaCola(app, ctx());
    assert.equal(cola[0]!.atascado, true);
    assert.equal(cola[0]!.id, cola0[1]!.id);
  });
});
