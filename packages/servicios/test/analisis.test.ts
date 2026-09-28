/**
 * Análisis contable: cuenta corriente por anexo, resultados por centro de costo
 * y precios históricos.
 *
 * Lo que se comprueba es que cada una responda lo que promete sin esconder
 * nada: que las cuentas de un tercero no se compensen solas, que una obra que
 * pierde salga a la luz aunque el total sea positivo, y que un alza de precio
 * se vea.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, registrarPago, emitirVenta, asentar,
  crearImportacion, agregarItem, agregarGasto, confirmarLiquidacion,
  cuentaCorrienteAnexo, resultadosPorCentro, preciosHistoricos,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let cliente = "";
let proveedor = "";
let otroProveedor = "";
let producto = "";
let centroUno = "";
let centroDos = "";

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
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true, true) RETURNING id`;
  proveedor = pr!.id;
  const [pr2] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '6', '20100066603', 'IMPORTADORA DEL NORTE SAC', true, true) RETURNING id`;
  otroProveedor = pr2!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = p!.id;

  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
  centroUno = cc!.id;
  const [cc2] = await raw<{ id: string }[]>`
    INSERT INTO centros_costo (empresa_id, codigo, nombre)
    VALUES (${empresaId}, '900', 'Obra San Miguel') RETURNING id`;
  centroDos = cc2!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

const comprar = (
  valor: string,
  numero: string,
  opts: { proveedorId?: string; moneda?: string; tipoCambio?: string; fecha?: string } = {},
) =>
  con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: opts.proveedorId ?? proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero,
      fechaEmision: opts.fecha ?? "2026-09-05",
      moneda: opts.moneda ?? "PEN",
      tipoCambio: opts.tipoCambio ?? "1",
      almacenId: almacen,
      lineas: [
        { productoId: producto, descripcion: "Bomba", cantidad: "10", valorUnitario: valor },
      ],
    }),
  );

// ─── Cuenta corriente por anexo ───────────────────────────────────────────

describe("cuenta corriente por anexo", () => {
  test("muestra el movimiento del tercero con el saldo corriendo", async () => {
    const c = await comprar("100", "0000001"); // 1 180 a la 42
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        numero: "PG-001",
        proveedorId: proveedor,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioPago: "transferencia",
        cuentaOrigen: "1041",
        aplicaciones: [{ documentoId: c.documentoCxpId, importe: "500.00" }],
      }),
    );

    const cc = await con((db) => cuentaCorrienteAnexo(db, proveedor));
    assert.equal(cc.tercero.razonSocial, "FERRETERIA SA");
    const cuenta42 = cc.cuentas.find((x) => x.cuenta.startsWith("42"))!;
    assert.ok(cuenta42, "la cuenta por pagar no aparece");
    // Abonada por 1 180 y cargada por 500: queda debiendo 680, con signo de pasivo.
    assert.equal(s2(cuenta42.saldo), "-680.00");
    assert.equal(cuenta42.movimientos.length, 2);
    assert.equal(s2(cuenta42.movimientos[0]!.haber), "1180.00");
    assert.equal(s2(cuenta42.movimientos[1]!.debe), "500.00");
  });

  /**
   * Lo que se le debe y lo que él debe no se compensan solos: presentarlos como
   * un saldo único esconde las dos cifras que importan.
   */
  test("separa por cuenta en vez de netear", async () => {
    await comprar("100", "0000001");
    // Un anticipo al mismo proveedor, que es activo y va a otra cuenta.
    await con((db) =>
      asentar(db, empresaId, usuarioId, {
        periodo: "202609",
        fecha: "2026-09-10",
        subdiario: "01",
        glosa: "Anticipo a proveedor",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          { cuenta: "1673", glosa: "Anticipo", debe: "300.00", anexoId: proveedor },
          { cuenta: "1041", glosa: "Anticipo", haber: "300.00" },
        ],
      }),
    );

    const cc = await con((db) => cuentaCorrienteAnexo(db, proveedor));
    assert.equal(cc.cuentas.length, 2);
    const anticipo = cc.cuentas.find((x) => x.cuenta === "1673")!;
    assert.equal(s2(anticipo.saldo), "300.00");
    // El total sí netea, para quien quiera la posición.
    assert.equal(s2(cc.saldoTotal), "-880.00");
  });

  test("un tercero sin movimientos devuelve sus cuentas vacías, no un error", async () => {
    const cc = await con((db) => cuentaCorrienteAnexo(db, cliente));
    assert.deepEqual(cc.cuentas, []);
    assert.equal(cc.saldoTotal, "0.00");
  });

  test("respeta el rango de fechas", async () => {
    await comprar("100", "0000001", { fecha: "2026-08-05" });
    const cc = await con((db) =>
      cuentaCorrienteAnexo(db, proveedor, { desde: "2026-09-01" }),
    );
    assert.deepEqual(cc.cuentas, []);
  });
});

// ─── Resultados por centro de costo ───────────────────────────────────────

describe("resultados por centro de costo", () => {
  /** Un resultado global positivo puede estar tapando una obra que pierde. */
  test("saca a la luz el centro que pierde", async () => {
    await con((db) =>
      asentar(db, empresaId, usuarioId, {
        periodo: "202609",
        fecha: "2026-09-10",
        subdiario: "01",
        glosa: "Ingresos y gastos de dos obras",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          { cuenta: "1041", glosa: "Cobro", debe: "10000.00" },
          { cuenta: "70111", glosa: "Obra A", haber: "8000.00", centroCostoId: centroUno },
          { cuenta: "70111", glosa: "Obra B", haber: "2000.00", centroCostoId: centroDos },
          { cuenta: "6351", glosa: "Alquiler obra A", debe: "1000.00", centroCostoId: centroUno },
          { cuenta: "6351", glosa: "Alquiler obra B", debe: "5000.00", centroCostoId: centroDos },
          { cuenta: "1041", glosa: "Pagos", haber: "6000.00" },
        ],
      }),
    );

    const r = await con((db) => resultadosPorCentro(db, "202609"));
    const a = r.find((x) => x.centroId === centroUno)!;
    const b = r.find((x) => x.centroId === centroDos)!;
    assert.equal(s2(a.resultado), "7000.00");
    assert.equal(s2(b.resultado), "-3000.00");
    // El global es positivo y aun así hay una obra perdiendo 3 000.
    assert.equal(b.margen, "-150.00");
  });

  /** Repartir gasto indirecto por una fórmula inventada da números falsos. */
  test("lo que no lleva centro aparece en su propia fila", async () => {
    await con((db) =>
      asentar(db, empresaId, usuarioId, {
        periodo: "202609",
        fecha: "2026-09-10",
        subdiario: "01",
        glosa: "Gasto general",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          { cuenta: "6373", glosa: "Comisiones bancarias", debe: "120.00" },
          { cuenta: "1041", glosa: "Comisiones bancarias", haber: "120.00" },
        ],
      }),
    );
    const r = await con((db) => resultadosPorCentro(db, "202609"));
    const sinCentro = r.find((x) => x.centroId === null)!;
    assert.equal(sinCentro.nombre, "Sin centro de costo");
    assert.equal(s2(sinCentro.gastos), "120.00");
  });

  test("un periodo sin asientos devuelve vacío", async () => {
    assert.deepEqual(await con((db) => resultadosPorCentro(db, "202612")), []);
  });
});

// ─── Precios históricos ───────────────────────────────────────────────────

describe("precios históricos del proveedor", () => {
  test("lista las compras de la más reciente a la más antigua", async () => {
    await comprar("100", "0000001", { fecha: "2026-07-05" });
    await comprar("112", "0000002", { fecha: "2026-08-05" });
    await comprar("120", "0000003", { fecha: "2026-09-05", proveedorId: otroProveedor });

    const h = await con((db) => preciosHistoricos(db, producto));
    assert.equal(h.length, 3);
    assert.equal(h[0]!.fecha, "2026-09-05");
    assert.equal(s2(h[0]!.valorUnitario), "120.00");
    assert.equal(h[0]!.proveedor, "IMPORTADORA DEL NORTE SAC");
  });

  /** Es lo que evita aceptar un alza del 12 % porque nadie recordaba el precio. */
  test("calcula la variación contra la compra anterior", async () => {
    await comprar("100", "0000001", { fecha: "2026-07-05" });
    await comprar("112", "0000002", { fecha: "2026-08-05" });

    const h = await con((db) => preciosHistoricos(db, producto));
    assert.equal(h[0]!.variacion, "12.00");
    // La más antigua no tiene con qué compararse.
    assert.equal(h[1]!.variacion, null);
  });

  test("lleva a soles lo comprado en dólares", async () => {
    await comprar("100", "0000001", { fecha: "2026-07-05" });
    await comprar("30", "0000002", {
      fecha: "2026-08-05", moneda: "USD", tipoCambio: "3.80",
    });

    const h = await con((db) => preciosHistoricos(db, producto));
    // USD 30 × 3.80 = 114.00, que es más caro que los 100 soles anteriores.
    assert.equal(s2(h[0]!.valorUnitarioSoles), "114.00");
    assert.equal(h[0]!.variacion, "14.00");
  });

  /**
   * Dejar los embarques fuera sería dejar fuera casi todo el abastecimiento de
   * un importador: la serie saldría con dos entradas y parecería que el
   * producto casi no se compra.
   */
  test("las importaciones entran en la serie, con su FOB y su costo en almacén", async () => {
    await comprar("100", "0000001", { fecha: "2026-07-05" });

    const impId = await con((db) =>
      crearImportacion(db, empresaId, usuarioId, {
        numero: "IMP-2026-001",
        proveedorId: proveedor,
        almacenId: almacen,
        moneda: "USD",
        tipoCambio: "3.80",
        fechaOrden: "2026-09-01",
      }),
    );
    await con((db) =>
      agregarItem(db, empresaId, impId, {
        productoId: producto,
        descripcion: "Bomba",
        cantidad: "10",
        fobUnitario: "20.00",
        peso: "100",
      }),
    );
    await con((db) =>
      agregarGasto(db, empresaId, impId, {
        concepto: "Flete internacional", importe: "380.00", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
      }),
    );

    // Sin liquidar todavía no hay costo puesto en almacén: no se sabe.
    let h = await con((db) => preciosHistoricos(db, producto));
    assert.equal(h[0]!.origen, "importacion");
    assert.equal(s2(h[0]!.valorUnitarioSoles), "76.00", "FOB 20 × 3.80");
    assert.equal(h[0]!.costoUnitarioSoles, null);

    await con((db) =>
      confirmarLiquidacion(db, empresaId, usuarioId, impId, {
        numero: "LIQ-001", fecha: "2026-09-08", periodo: "202609",
      }),
    );

    h = await con((db) => preciosHistoricos(db, producto));
    // 760 de FOB más 380 de flete, entre 10 unidades.
    assert.equal(s2(h[0]!.costoUnitarioSoles!), "114.00");
    // Y el precio del exportador sigue siendo el FOB, no el costo: confundirlos
    // es lo que lleva a creer que importar sale más barato de lo que sale.
    assert.equal(s2(h[0]!.valorUnitarioSoles), "76.00");
  });

  test("un producto sin compras devuelve vacío", async () => {
    const [u] = await raw<{ id: string }[]>`
      SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
      VALUES (${empresaId}, 'P999', 'Nunca comprado', ${u!.id}) RETURNING id`;
    assert.deepEqual(await con((db) => preciosHistoricos(db, p!.id)), []);
  });
});
