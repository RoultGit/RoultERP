/**
 * Reportes de gestión: ranking de ventas, stock mensual y rotación.
 *
 * Lo que se comprueba es que las cifras salgan de las mismas fuentes que la
 * contabilidad. Un margen calculado con lista de precios y otro con el costo de
 * ventas dan números distintos, y entonces nadie sabe cuál creer.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, emitirNota,
  rankingVentas, stockMensual, rotacionInventario, estadoResultados,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let cliente = "";
let otroCliente = "";
let proveedor = "";
const p: Record<string, string> = {};

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

  const [a] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true) RETURNING id`;
  cliente = c!.id;
  const [c2] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20100066603', 'CONSTRUCTORA LIMA SAC', true) RETURNING id`;
  otroCliente = c2!.id;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = pr!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  for (const [codigo, descripcion] of [
    ["P001", "Bomba centrífuga"],
    ["P002", "Válvula de bronce"],
    ["P003", "Manguera"],
  ] as const) {
    const [fila] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
      VALUES (${empresaId}, ${codigo}, ${descripcion}, ${u!.id}) RETURNING id`;
    p[codigo] = fila!.id;
  }

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '07', 'FC01', 0)`;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

async function comprar(
  lineas: { codigo: string; cantidad: string; valor: string }[],
  numero: string,
  fecha = "2026-09-01",
) {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero,
      fechaEmision: fecha,
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: lineas.map((l) => ({
        productoId: p[l.codigo]!,
        descripcion: l.codigo,
        cantidad: l.cantidad,
        valorUnitario: l.valor,
      })),
    }),
  );
}

const vender = (
  lineas: { codigo: string; cantidad: string; valor: string }[],
  opts: { clienteId?: string; fecha?: string } = {},
) =>
  con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: opts.clienteId ?? cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: opts.fecha ?? "2026-09-15",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: lineas.map((l) => ({
        productoId: p[l.codigo]!,
        cantidad: l.cantidad,
        valorUnitario: l.valor,
      })),
    }),
  );

// ─── Ranking ──────────────────────────────────────────────────────────────

describe("ranking de ventas", () => {
  async function mes() {
    await comprar(
      [
        { codigo: "P001", cantidad: "100", valor: "100" },
        { codigo: "P002", cantidad: "100", valor: "20" },
      ],
      "0000001",
    );
    await vender([{ codigo: "P001", cantidad: "10", valor: "150" }]);
    await vender([{ codigo: "P002", cantidad: "40", valor: "30" }], { clienteId: otroCliente });
  }

  test("ordena por venta y calcula el margen con el costo del kardex", async () => {
    await mes();
    const r = await con((db) =>
      rankingVentas(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );

    // P001: 10 × 150 = 1 500 de venta, 10 × 100 = 1 000 de costo.
    // P002: 40 × 30 = 1 200 de venta, 40 × 20 = 800 de costo.
    assert.deepEqual(r.lineas.map((l) => l.codigo), ["P001", "P002"]);
    assert.equal(r.lineas[0]!.venta, "1500.00");
    assert.equal(r.lineas[0]!.costo, "1000.00");
    assert.equal(r.lineas[0]!.margen, "500.00");
    assert.equal(r.lineas[0]!.margenPorcentaje, "33.33");
    assert.equal(r.total.venta, "2700.00");
    assert.equal(r.total.margen, "900.00");
  });

  /**
   * El margen del ranking y el del estado de resultados salen de la misma
   * cifra. Calcularlo con una lista de precios daría dos números distintos y
   * nadie sabría cuál creer.
   */
  test("el margen coincide con el del estado de resultados", async () => {
    await mes();
    const r = await con((db) =>
      rankingVentas(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    const { lineas } = await con((db) => estadoResultados(db, "202609"));
    const bruta = lineas.find((l) => /utilidad bruta/i.test(l.concepto));
    assert.ok(bruta, "el estado de resultados no trae la utilidad bruta");
    assert.equal(money.toString(bruta!.importe, 2), r.total.margen);
  });

  test("agrupa por cliente cuando se pide así", async () => {
    await mes();
    const r = await con((db) =>
      rankingVentas(db, { desde: "2026-09-01", hasta: "2026-09-30" }, "cliente"),
    );
    assert.equal(r.lineas.length, 2);
    assert.equal(r.lineas[0]!.nombre, "HIDRAULICA DEL SUR SAC");
    assert.equal(r.lineas[0]!.venta, "1500.00");
    assert.equal(r.lineas[0]!.participacion, "55.56");
  });

  test("la nota de crédito descuenta del ranking", async () => {
    await mes();
    const v = await vender([{ codigo: "P003", cantidad: "0.0001", valor: "1" }]).catch(() => null);
    assert.equal(v, null, "no debería poder venderse lo que no hay");

    const venta = await vender([{ codigo: "P001", cantidad: "5", valor: "150" }]);
    await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${venta.comprobanteId}`;
    await con((db) =>
      emitirNota(db, empresaId, usuarioId, {
        comprobanteId: venta.comprobanteId,
        tipoDocumento: "07",
        serie: "FC01",
        fechaEmision: "2026-09-20",
        motivo: "01",
        descripcionMotivo: "Anulación de la operación",
      }),
    );

    const r = await con((db) =>
      rankingVentas(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    // La venta de 5 y su nota se anulan entre sí: queda el ranking original.
    assert.equal(r.lineas.find((l) => l.codigo === "P001")!.venta, "1500.00");
  });

  test("respeta el rango de fechas", async () => {
    await mes();
    const r = await con((db) =>
      rankingVentas(db, { desde: "2026-10-01", hasta: "2026-10-31" }),
    );
    assert.deepEqual(r.lineas, []);
    assert.equal(r.total.venta, "0.00");
  });
});

// ─── Stock mensual ────────────────────────────────────────────────────────

describe("stock mensual", () => {
  test("saldo inicial, entradas, salidas y saldo final", async () => {
    await comprar([{ codigo: "P001", cantidad: "100", valor: "100" }], "0000001", "2026-08-10");
    await comprar([{ codigo: "P001", cantidad: "50", valor: "100" }], "0000002", "2026-09-05");
    await vender([{ codigo: "P001", cantidad: "30", valor: "150" }], { fecha: "2026-09-20" });

    const filas = await con((db) => stockMensual(db, "202609"));
    const bomba = filas.find((f) => f.codigo === "P001")!;
    assert.equal(bomba.inicial, "100.00");
    assert.equal(bomba.ingresos, "50.00");
    assert.equal(bomba.salidas, "30.00");
    assert.equal(bomba.final, "120.00");
    assert.equal(s2(bomba.valorFinal), "12000.00");
  });

  test("un mes sin movimientos sigue mostrando el saldo que quedó", async () => {
    await comprar([{ codigo: "P001", cantidad: "10", valor: "100" }], "0000001", "2026-08-10");
    const filas = await con((db) => stockMensual(db, "202609"));
    const bomba = filas.find((f) => f.codigo === "P001")!;
    assert.equal(bomba.inicial, "10.00");
    assert.equal(bomba.ingresos, "0.00");
    assert.equal(bomba.final, "10.00");
  });

  test("filtra por almacén", async () => {
    await comprar([{ codigo: "P001", cantidad: "10", valor: "100" }], "0000001");
    const [suc] = await raw<{ id: string }[]>`
      SELECT id FROM sucursales WHERE empresa_id = ${empresaId} LIMIT 1`;
    const [otro] = await raw<{ id: string }[]>`
      INSERT INTO almacenes (empresa_id, sucursal_id, codigo, nombre)
      VALUES (${empresaId}, ${suc!.id}, '002', 'Obra') RETURNING id`;
    assert.deepEqual(await con((db) => stockMensual(db, "202609", otro!.id)), []);
    assert.equal((await con((db) => stockMensual(db, "202609", almacen))).length, 1);
  });
});

// ─── Rotación ─────────────────────────────────────────────────────────────

describe("rotación del inventario", () => {
  test("cuenta las vueltas y los días en almacén", async () => {
    // 100 unidades a 100; se venden 60 en el mes.
    await comprar([{ codigo: "P001", cantidad: "100", valor: "100" }], "0000001", "2026-08-31");
    await vender([{ codigo: "P001", cantidad: "60", valor: "150" }], { fecha: "2026-09-15" });

    const filas = await con((db) =>
      rotacionInventario(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    const bomba = filas.find((f) => f.codigo === "P001")!;
    // Consumo 6 000; stock promedio (10 000 + 4 000) / 2 = 7 000.
    assert.equal(bomba.consumo, "6000.00");
    assert.equal(bomba.stockPromedio, "7000.00");
    assert.equal(bomba.vueltas, "0.86");
    // 7 000 × 30 / 6 000 = 35 días.
    assert.equal(bomba.diasEnAlmacen, "35.0");
    assert.equal(bomba.sinMovimiento, false);
  });

  /** Capital inmovilizado que en el balance figura como activo. */
  test("marca lo que tiene stock y no se movió", async () => {
    await comprar([{ codigo: "P002", cantidad: "50", valor: "20" }], "0000001", "2026-08-01");
    const filas = await con((db) =>
      rotacionInventario(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    const valvula = filas.find((f) => f.codigo === "P002")!;
    assert.equal(valvula.consumo, "0.00");
    assert.equal(valvula.vueltas, "0.00");
    assert.equal(valvula.sinMovimiento, true);
  });

  test("no informa de lo que no tiene ni stock ni consumo", async () => {
    await comprar([{ codigo: "P001", cantidad: "10", valor: "100" }], "0000001", "2026-08-01");
    await vender([{ codigo: "P001", cantidad: "10", valor: "150" }], { fecha: "2026-08-15" });
    const filas = await con((db) =>
      rotacionInventario(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    assert.deepEqual(filas, []);
  });
});
