/**
 * Planillas de cobranza.
 *
 * Lo que más importa comprobar es que **una planilla no toma lo que ya está en
 * otra**: dos cobradores con la misma factura es la forma de cobrarla dos veces,
 * o de que no la cobre ninguno porque cada uno cree que la tiene el otro.
 *
 * Y lo segundo: que lo cobrado se deduzca del saldo del documento y no de lo
 * que alguien apunte. Si el cliente pagó por transferencia en vez de al
 * cobrador, la deuda igual se extinguió.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, registrarCobranza, canjearPorLetra,
  crearPlanilla, liquidarPlanilla, cerrarPlanilla, anularPlanilla,
  listarPlanillas, cobrablesLibres, planillasDe, PlanillaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let cliente = "";
let otroCliente = "";
let producto = "";

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true) RETURNING id`;
  cliente = c!.id;
  const [o] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20100066603', 'OTRO CLIENTE SAC', true) RETURNING id`;
  otroCliente = o!.id;
  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;

  await enEmpresa(app, { empresaId, usuarioId }, (db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: prov!.id, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-08-01", moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "200", valorUnitario: "300" }],
    }),
  );
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

/** Una venta de 5 900 con IGV incluido. */
async function venta(clienteId = cliente): Promise<string> {
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-01",
      fechaVencimiento: "2026-10-01",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "10", valorUnitario: "500" }],
    }),
  );
  return r.comprobanteId;
}

const planilla = (documentos: { comprobanteId?: string; letraId?: string; importe?: string }[]) =>
  con((db) =>
    crearPlanilla(db, empresaId, usuarioId, {
      fecha: "2026-09-10",
      responsable: "Luis Quispe",
      documentos,
    }),
  );

// ─── Armado ───────────────────────────────────────────────────────────────

describe("armar la planilla", () => {
  test("toma el saldo entero cuando no se dice cuánto", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);
    assert.equal(s2(p.importe), "5900.00");
    assert.match(p.numero, /^PC2026-\d{6}$/);
  });

  test("una planilla vacía no es una planilla", async () => {
    await assert.rejects(
      () => planilla([]),
      (e: unknown) => e instanceof PlanillaInvalida && /al menos un documento/.test(String(e)),
    );
  });

  test("un renglón que no dice qué documento lleva se rechaza", async () => {
    await assert.rejects(() => planilla([{}]), /una factura o una letra/);
  });

  test("no se pueden mezclar monedas en una misma planilla", async () => {
    const c = await venta();
    const [otra] = await raw<{ id: string }[]>`
      UPDATE comprobantes SET moneda = 'USD' WHERE id = ${c} RETURNING id`;
    const d = await venta(otroCliente);
    await assert.rejects(() => planilla([{ comprobanteId: otra!.id }, { comprobanteId: d }]),
      /no mezcla monedas/);
  });

  /** La razón de ser del documento. */
  test("lo que ya está en una planilla abierta no se puede entregar otra vez", async () => {
    const c = await venta();
    await planilla([{ comprobanteId: c }]);
    await assert.rejects(() => planilla([{ comprobanteId: c }]), /no tiene saldo libre/);
  });

  test("se puede entregar sólo una parte, y el resto queda libre", async () => {
    const c = await venta();
    await planilla([{ comprobanteId: c, importe: "2000.00" }]);

    const libres = await con((db) => cobrablesLibres(db));
    assert.equal(libres.length, 1);
    assert.equal(s2(libres[0]!.libre), "3900.00");

    // Y pedir más de lo que queda libre se rechaza diciendo por qué.
    await assert.rejects(
      () => planilla([{ comprobanteId: c, importe: "4000.00" }]),
      /sólo quedan 3900.00 sin entregar \(el resto está en otra planilla\)/,
    );
  });

  test("cerrar la planilla libera lo que no se cobró", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);
    await con((db) => cerrarPlanilla(db, p.id, usuarioId));

    // Vuelve a estar disponible para la siguiente salida.
    const libres = await con((db) => cobrablesLibres(db));
    assert.equal(s2(libres[0]!.libre), "5900.00");
    const otra = await planilla([{ comprobanteId: c }]);
    assert.equal(s2(otra.importe), "5900.00");
  });
});

// ─── Letras ───────────────────────────────────────────────────────────────

describe("letras en la planilla", () => {
  const canjear = async (comprobanteId: string) =>
    con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, {
        cartera: "cobrar",
        terceroId: cliente,
        numero: "L-001",
        fechaGiro: "2026-09-05",
        fechaVencimiento: "2026-11-05",
        moneda: "PEN",
        documentos: [{ documentoId: comprobanteId, importe: "5900.00" }],
      }),
    );

  test("una letra en cartera se entrega como cualquier documento", async () => {
    const c = await venta();
    const letra = await canjear(c);
    const p = await planilla([{ letraId: letra.letraId }]);
    assert.equal(s2(p.importe), "5900.00");

    const liq = await con((db) => liquidarPlanilla(db, p.id));
    assert.match(liq.renglones[0]!.documento, /^Letra /);
  });

  /** Canjeada, la factura ya no se debe: la deuda vive en la letra. */
  test("la factura canjeada deja de estar libre y la letra ocupa su lugar", async () => {
    const c = await venta();
    await canjear(c);
    const libres = await con((db) => cobrablesLibres(db));
    assert.equal(libres.length, 1);
    assert.equal(libres[0]!.clase, "letra");
  });
});

// ─── Liquidación ──────────────────────────────────────────────────────────

describe("liquidar la planilla", () => {
  test("lo cobrado sale del saldo del documento, no de lo que se apunte", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);

    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: "CB-2026-001",
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "efectivo",
        cuentaDestino: "1011",
        aplicaciones: [{ comprobanteId: c, importe: "2000.00" }],
      }),
    );

    const liq = await con((db) => liquidarPlanilla(db, p.id));
    assert.equal(liq.entregado, "5900.00");
    assert.equal(liq.cobrado, "2000.00");
    assert.equal(liq.pendiente, "3900.00");
    assert.equal(liq.renglones[0]!.cliente, "HIDRAULICA DEL SUR SAC");
  });

  test("sin cobrar nada, todo queda pendiente", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);
    const liq = await con((db) => liquidarPlanilla(db, p.id));
    assert.equal(liq.cobrado, "0.00");
    assert.equal(liq.pendiente, "5900.00");
  });

  test("cerrar devuelve lo cobrado y deja la planilla cerrada", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);
    const r = await con((db) => cerrarPlanilla(db, p.id, usuarioId));
    assert.equal(r.pendiente, "5900.00");

    await assert.rejects(() => con((db) => cerrarPlanilla(db, p.id, usuarioId)), /ya está cerrada/);
  });

  test("anular exige motivo y lo deja escrito", async () => {
    const c = await venta();
    const p = await planilla([{ comprobanteId: c }]);
    await assert.rejects(() => con((db) => anularPlanilla(db, p.id, "  ")), /exige un motivo/);

    await con((db) => anularPlanilla(db, p.id, "el cobrador no salió"));
    const [fila] = await raw<{ estado: string; observaciones: string }[]>`
      SELECT estado, observaciones FROM planillas_cobranza WHERE id = ${p.id}`;
    assert.equal(fila!.estado, "anulada");
    assert.match(fila!.observaciones, /el cobrador no salió/);
  });
});

// ─── Consultas ────────────────────────────────────────────────────────────

describe("consultas", () => {
  test("el listado cuenta los documentos de cada planilla", async () => {
    const a = await venta();
    const b = await venta(otroCliente);
    await planilla([{ comprobanteId: a }, { comprobanteId: b }]);

    const lista = await con((db) => listarPlanillas(db));
    assert.equal(lista.length, 1);
    assert.equal(Number(lista[0]!.documentos), 2);
    assert.equal(lista[0]!.responsable, "Luis Quispe");
  });

  test("se puede saber quién tiene un documento", async () => {
    const c = await venta();
    await planilla([{ comprobanteId: c }]);
    const donde = await con((db) => planillasDe(db, c));
    assert.equal(donde.length, 1);
    assert.equal(donde[0]!.responsable, "Luis Quispe");
    assert.equal(donde[0]!.estado, "abierta");
  });
});
