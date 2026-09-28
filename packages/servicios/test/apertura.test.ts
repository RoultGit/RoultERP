/**
 * Saldos de apertura: lo que se trae del sistema anterior el día del cambio.
 *
 * La prueba que manda en este archivo es una sola y está repetida desde cuatro
 * ángulos: **lo migrado entra en la cartera y no entra en los libros**. Esas
 * facturas ya se declararon en Starsoft; volver a declararlas haría pagar dos
 * veces el IGV de toda la cartera pendiente, y el error no se vería hasta que
 * SUNAT cruzara la información.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, analizarApertura, registrarApertura, AperturaInvalida,
  documentosPorCobrar, antiguedadCartera, programacionDeEgresos,
  existencias, balanceComprobacion, filasRegistroVentas, liquidacionMensual,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";

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

  await raw`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_cliente, es_proveedor)
    VALUES (${empresaId}, '6', '20522633721', 'MINERA CERRO VERDE S.A.A.', 'PE', true, false),
           (${empresaId}, '6', '20512333338', 'FERRETERIA DEL SUR S.A.C.', 'PE', false, true)`;

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  await raw`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga 2HP', ${unidad!.id}),
           (${empresaId}, 'P002', 'Válvula de bronce 2"', ${unidad!.id})`;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const n = (v: string) => Number(v);

/** Una cartera pequeña con las tres hojas, como sale de exportar Starsoft. */
const HOJAS = {
  cxc: [
    "01\tFA01\t1200\t20522633721\t15/07/2026\t14/09/2026\tPEN\t1\t8.500,00",
    "01\tFA01\t1215\t20522633721\t02/08/2026\t01/10/2026\tPEN\t1\t3.200,50",
  ].join("\n"),
  cxp: ["01\tF500\t880\t20512333338\t20/07/2026\t19/09/2026\tPEN\t1\t4.700,00"].join("\n"),
  stock: ["P001\t001\t40\t320.00", "P002\t001\t150\t28.50"].join("\n"),
};

describe("análisis previo", () => {
  test("lee el Excel peruano y calcula la contrapartida antes de escribir", async () => {
    const a = await con((db) => analizarApertura(db, empresaId, HOJAS));
    assert.equal(a.problemas, 0);
    assert.equal(a.totales.cxc, "11700.50", "8 500 + 3 200,50, no 8,5 + 3,2");
    assert.equal(a.totales.cxp, "4700.00");
    // 40 × 320 + 150 × 28,50.
    assert.equal(a.totales.stock, "17075.00");
    // Activo menos pasivo: el patrimonio con el que empieza aquí.
    assert.equal(a.contrapartida, "24075.50");
    assert.equal(a.cuentaContrapartida, "5911");

    const [{ n: filas }] = await raw<{ n: number }[]>`SELECT count(*)::int AS n FROM comprobantes`;
    assert.equal(filas, 0, "analizar no escribe");
  });

  test("denuncia lo que falta en el maestro en vez de crearlo", async () => {
    // Dar de alta clientes y productos desde una hoja pegada llenaría el
    // maestro de razones sociales mal escritas y duplicadas.
    const a = await con((db) =>
      analizarApertura(db, empresaId, {
        cxc: "01\tFA01\t1\t20999999999\t15/07/2026\t14/09/2026\tPEN\t1\t100",
        stock: "P999\t001\t5\t10",
      }),
    );
    assert.deepEqual(a.faltantes.terceros, ["20999999999"]);
    assert.deepEqual(a.faltantes.productos, ["P999"]);
    assert.equal(a.problemas, 2);
  });

  test("un costo cero se rechaza: arrastraría el promedio de ese producto a cero", async () => {
    const a = await con((db) =>
      analizarApertura(db, empresaId, { stock: "P001\t001\t40\t0" }),
    );
    assert.match(a.stock[0]!.problemas.join(" "), /costo unitario debe ser mayor que cero/);
  });

  test("un saldo en dólares sin tipo de cambio se rechaza", async () => {
    const a = await con((db) =>
      analizarApertura(db, empresaId, {
        cxc: "01\tFA01\t1\t20522633721\t15/07/2026\t14/09/2026\tUSD\t1\t1000",
      }),
    );
    assert.match(a.cxc[0]!.problemas.join(" "), /necesita su tipo de cambio/);
  });
});

describe("registro", () => {
  test("la cartera, el almacén y el asiento quedan cuadrados", async () => {
    const r = await con((db) =>
      registrarApertura(db, empresaId, usuarioId, HOJAS, { fecha: "2026-08-31" }),
    );
    assert.equal(r.cxc, 2);
    assert.equal(r.cxp, 1);
    assert.equal(r.stock, 2);

    // Por cobrar: el saldo que quedaba, no el importe original de la factura.
    const porCobrar = await con((db) => documentosPorCobrar(db));
    assert.equal(porCobrar.length, 2);
    assert.equal(n(porCobrar.find((d) => d.numero === "1200")!.saldo), 8500);

    // Por pagar: llega hasta la programación de egresos, que es lo que decide
    // cuánta caja hace falta cada semana.
    const egresos = await con((db) => programacionDeEgresos(db, "2026-09-01"));
    assert.equal(egresos.lineas.length, 1);
    assert.equal(n(egresos.lineas[0]!.saldo), 4700);

    const stock = await con((db) => existencias(db));
    const p1 = stock.find((x) => x.codigo === "P001")!;
    assert.equal(n(p1.cantidad), 40);
    // 40 × 320: el valor entra al kardex al costo con el que se migró.
    assert.equal(n(p1.valor), 12800);

    // El asiento: activo al debe, pasivo al haber, patrimonio de cuadre.
    const balance = await con((db) => balanceComprobacion(db, "202608"));
    const debe = balance.reduce((a, l) => a + n(l.debe), 0);
    const haber = balance.reduce((a, l) => a + n(l.haber), 0);
    assert.equal(Math.round(debe * 100), Math.round(haber * 100));
    assert.equal(n(balance.find((l) => l.cuenta === "1212")!.debe), 11700.5);
    assert.equal(n(balance.find((l) => l.cuenta === "4212")!.haber), 4700);
    assert.equal(n(balance.find((l) => l.cuenta === "5911")!.haber), 24075.5);
  });

  test("LO IMPORTANTE: la cartera migrada no entra en los libros", async () => {
    await con((db) => registrarApertura(db, empresaId, usuarioId, HOJAS, { fecha: "2026-08-31" }));

    // 1. Sí está en la cartera: es dinero que el cliente debe.
    const cartera = await con((db) => antiguedadCartera(db, "2026-09-26"));
    assert.equal(
      Math.round(n(cartera.totales.total) * 100),
      Math.round(11700.5 * 100),
      "la deuda del cliente tiene que verse",
    );

    // 2. No está en el registro de ventas ni en el PLE 14.1: ya se declaró allá.
    const registro = await con((db) => filasRegistroVentas(db, "202608"));
    assert.deepEqual(registro, [], "volver a declararlas pagaría dos veces su IGV");

    // 3. No está en la liquidación del PDT: ni base gravada ni débito fiscal.
    const liq = await con((db) => liquidacionMensual(db, "202608"));
    const totalVentas = liq.ventas.reduce((a, c) => a + Math.abs(n(c.importe)), 0);
    assert.equal(totalVentas, 0, "declararlas otra vez pagaría dos veces su IGV");

    // 4. No está en la cola de envío a SUNAT: nunca se manda un documento ajeno.
    const [{ n: enCola }] = await raw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM comprobantes
       WHERE estado IN ('borrador', 'firmado', 'enviado')`;
    assert.equal(enCola, 0);
  });

  test("no se carga dos veces", async () => {
    // Duplicaría la cartera entera y el stock, y para cuando alguien lo note ya
    // habrá cobranzas encima.
    await con((db) => registrarApertura(db, empresaId, usuarioId, HOJAS, { fecha: "2026-08-31" }));
    await assert.rejects(
      () => con((db) => registrarApertura(db, empresaId, usuarioId, HOJAS, { fecha: "2026-08-31" })),
      (e: unknown) => e instanceof AperturaInvalida && /ya hay una apertura/.test(e.message),
    );
  });

  test("es todo o nada: una fila mala deja la base intacta", async () => {
    // Al revés que la carga en serie de compras. Una apertura a medias deja el
    // balance descuadrado desde el primer día, y el asiento es uno solo.
    await assert.rejects(
      () =>
        con((db) =>
          registrarApertura(
            db,
            empresaId,
            usuarioId,
            { ...HOJAS, stock: HOJAS.stock + "\nP999\t001\t5\t10" },
            { fecha: "2026-08-31" },
          ),
        ),
      AperturaInvalida,
    );
    const [{ n: c }] = await raw<{ n: number }[]>`SELECT count(*)::int AS n FROM comprobantes`;
    const [{ n: m }] = await raw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM movimientos_inventario`;
    assert.equal(c, 0);
    assert.equal(m, 0);
  });

  test("lo migrado se cobra como cualquier otra factura", async () => {
    // Es la prueba de que valió la pena meterlo en `comprobantes`: la cobranza,
    // las letras y las notas de crédito funcionan sin tocar una línea.
    await con((db) => registrarApertura(db, empresaId, usuarioId, HOJAS, { fecha: "2026-08-31" }));
    const antes = await con((db) => documentosPorCobrar(db));
    const doc = antes.find((d) => d.numero === "1200")!;
    await raw`
      INSERT INTO cobranzas (empresa_id, numero, cliente_id, fecha, moneda, tipo_cambio,
                             importe, medio_cobro, estado)
      VALUES (${empresaId}, 'C-001', ${doc.cliente_id}, '2026-09-10', 'PEN', 1, 2500, 'transferencia', 'registrada')`;
    const [cob] = await raw<{ id: string }[]>`SELECT id FROM cobranzas WHERE numero = 'C-001'`;
    await raw`
      INSERT INTO cobranza_aplicaciones (empresa_id, cobranza_id, comprobante_id, importe)
      VALUES (${empresaId}, ${cob!.id}, ${doc.id}, 2500)`;

    const despues = await con((db) => documentosPorCobrar(db));
    assert.equal(n(despues.find((d) => d.numero === "1200")!.saldo), 6000, "8 500 − 2 500");
  });
});
