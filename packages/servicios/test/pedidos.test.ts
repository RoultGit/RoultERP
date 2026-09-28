/**
 * Cotización y pedido de venta.
 *
 * Lo que se comprueba aquí es el hábito que el cliente trae de Starsoft: que
 * el precio cotizado sea el precio del pedido, que el pedido sepa cuánto le
 * falta por despachar, y que nadie pueda facturar dos veces lo mismo.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta,
  crearCotizacion, cargarCotizacion, listarCotizaciones, resolverCotizacion,
  cotizacionAPedido, crearPedido, cargarPedido, listarPedidos, anularPedido,
  saldoPedido, vencerCotizaciones, PedidoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let producto = "";
let productoDos = "";
let cliente = "";
let proveedor = "";

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

  const [a1] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a1!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522458364', 'CONSTRUCTORA LIMA SAC', true) RETURNING id`;
  cliente = c!.id;

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = p!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'CEM-42', 'Cemento Portland 42.5 kg', ${u!.id}) RETURNING id`;
  producto = pr!.id;
  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;
  const [pr2] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'FIE-06', 'Fierro corrugado 6 mm', ${u!.id}) RETURNING id`;
  productoDos = pr2!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

async function stockInicial() {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero: "0001000",
      fechaEmision: "2026-09-02",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: [
        { productoId: producto, descripcion: "Cemento", cantidad: "500", valorUnitario: "24.00" },
        { productoId: productoDos, descripcion: "Fierro", cantidad: "500", valorUnitario: "18.00" },
      ],
    }),
  );
}

const cotizar = (lineas: { productoId: string; cantidad: string; valorUnitario: string }[]) =>
  con((db) =>
    crearCotizacion(db, empresaId, usuarioId, {
      clienteId: cliente,
      fecha: "2026-09-05",
      moneda: "PEN",
      tipoCambio: "1",
      lineas,
    }),
  );

// ─── Cotización ───────────────────────────────────────────────────────────

describe("cotización", () => {
  test("totaliza con IGV y se numera sola", async () => {
    const c = await cotizar([{ productoId: producto, cantidad: "100", valorUnitario: "30.00" }]);
    assert.equal(c.numero, "COT2026-000001");

    const { cabecera, lineas } = await con((db) => cargarCotizacion(db, c.id));
    assert.equal(s2(cabecera.gravadas), "3000.00");
    assert.equal(s2(cabecera.igv), "540.00");
    assert.equal(s2(cabecera.total), "3540.00");
    assert.equal(cabecera.estado, "pendiente");
    // El maestro completa lo que el vendedor no escribió.
    assert.equal(lineas[0]!.codigo, "CEM-42");
    assert.equal(lineas[0]!.unidad, "NIU");
  });

  test("numera correlativo por año", async () => {
    await cotizar([{ productoId: producto, cantidad: "1", valorUnitario: "30.00" }]);
    const segunda = await cotizar([{ productoId: producto, cantidad: "2", valorUnitario: "30.00" }]);
    assert.equal(segunda.numero, "COT2026-000002");
  });

  test("caduca a los 15 días si no se dice otra cosa", async () => {
    const c = await cotizar([{ productoId: producto, cantidad: "1", valorUnitario: "30.00" }]);
    const { cabecera } = await con((db) => cargarCotizacion(db, c.id));
    assert.equal(cabecera.validaHasta, "2026-09-20");
  });

  test("rechaza a quien no es cliente", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearCotizacion(db, empresaId, usuarioId, {
            clienteId: proveedor,
            fecha: "2026-09-05",
            moneda: "PEN",
            tipoCambio: "1",
            lineas: [{ productoId: producto, cantidad: "1", valorUnitario: "30.00" }],
          }),
        ),
      PedidoInvalido,
    );
  });

  test("rechaza cantidad cero", async () => {
    await assert.rejects(
      () => cotizar([{ productoId: producto, cantidad: "0", valorUnitario: "30.00" }]),
      /cantidad debe ser positiva/,
    );
  });

  test("vence las que pasaron de fecha", async () => {
    await cotizar([{ productoId: producto, cantidad: "1", valorUnitario: "30.00" }]);
    assert.equal(await con((db) => vencerCotizaciones(db, "2026-09-10")), 0);
    assert.equal(await con((db) => vencerCotizaciones(db, "2026-10-01")), 1);
    const [fila] = await con((db) => listarCotizaciones(db));
    assert.equal(fila!.estado, "vencida");
  });
});

// ─── Conversión ───────────────────────────────────────────────────────────

describe("de cotización a pedido", () => {
  test("copia las líneas con el precio congelado", async () => {
    const c = await cotizar([
      { productoId: producto, cantidad: "100", valorUnitario: "30.00" },
      { productoId: productoDos, cantidad: "40", valorUnitario: "25.00" },
    ]);
    await con((db) => resolverCotizacion(db, c.id, "aceptada"));

    const ped = await con((db) =>
      cotizacionAPedido(db, empresaId, usuarioId, c.id, {
        fecha: "2026-09-08",
        fechaEntrega: "2026-09-15",
        almacenId: almacen,
      }),
    );
    assert.equal(ped.numero, "PED2026-000001");

    const { cabecera, lineas } = await con((db) => cargarPedido(db, ped.id));
    assert.equal(cabecera.cotizacionId, c.id);
    assert.equal(s2(cabecera.total), "4720.00");
    assert.equal(lineas.length, 2);
    assert.equal(s2(lineas[0]!.valorUnitario), "30.00");
    assert.equal(s2(lineas[0]!.cantidadAtendida), "0.00");

    const { cabecera: cot } = await con((db) => cargarCotizacion(db, c.id));
    assert.equal(cot.estado, "convertida");
  });

  test("no se convierte dos veces", async () => {
    const c = await cotizar([{ productoId: producto, cantidad: "10", valorUnitario: "30.00" }]);
    await con((db) =>
      cotizacionAPedido(db, empresaId, usuarioId, c.id, { fecha: "2026-09-08" }),
    );
    await assert.rejects(
      () => con((db) => cotizacionAPedido(db, empresaId, usuarioId, c.id, { fecha: "2026-09-09" })),
      /ya se convirtió/,
    );
  });

  test("no se convierte una rechazada", async () => {
    const c = await cotizar([{ productoId: producto, cantidad: "10", valorUnitario: "30.00" }]);
    await con((db) => resolverCotizacion(db, c.id, "rechazada"));
    await assert.rejects(
      () => con((db) => cotizacionAPedido(db, empresaId, usuarioId, c.id, { fecha: "2026-09-09" })),
      /rechazada/,
    );
  });
});

// ─── Atención ─────────────────────────────────────────────────────────────

describe("atención del pedido", () => {
  const pedir = () =>
    con((db) =>
      crearPedido(db, empresaId, usuarioId, {
        clienteId: cliente,
        fecha: "2026-09-08",
        almacenId: almacen,
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          { productoId: producto, cantidad: "100", valorUnitario: "30.00" },
          { productoId: productoDos, cantidad: "40", valorUnitario: "25.00" },
        ],
      }),
    );

  const facturar = (pedidoId: string, lineas: { productoId: string; cantidad: string; valorUnitario: string }[]) =>
    con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente,
        tipoDocumento: "01",
        serie: "F001",
        fechaEmision: "2026-09-10",
        moneda: "PEN",
        tipoCambio: "1",
        almacenId: almacen,
        pedidoId,
        lineas,
      }),
    );

  test("una factura parcial deja el pedido en parcial", async () => {
    await stockInicial();
    const p = await pedir();
    await facturar(p.id, [{ productoId: producto, cantidad: "60", valorUnitario: "30.00" }]);

    const { cabecera, lineas } = await con((db) => cargarPedido(db, p.id));
    assert.equal(cabecera.estado, "parcial");
    assert.equal(s2(lineas[0]!.cantidadAtendida), "60.00");
    assert.equal(s2(lineas[1]!.cantidadAtendida), "0.00");

    const { pendientes } = await con((db) => saldoPedido(db, p.id));
    assert.equal(pendientes.length, 2);
    assert.equal(money.toString(pendientes[0]!.saldo, 2), "40.00");
  });

  test("al completarse queda atendido", async () => {
    await stockInicial();
    const p = await pedir();
    await facturar(p.id, [
      { productoId: producto, cantidad: "100", valorUnitario: "30.00" },
      { productoId: productoDos, cantidad: "40", valorUnitario: "25.00" },
    ]);
    const { cabecera } = await con((db) => cargarPedido(db, p.id));
    assert.equal(cabecera.estado, "atendido");
    const { pendientes } = await con((db) => saldoPedido(db, p.id));
    assert.equal(pendientes.length, 0);
  });

  test("no deja facturar más de lo pedido", async () => {
    await stockInicial();
    const p = await pedir();
    await assert.rejects(
      () => facturar(p.id, [{ productoId: producto, cantidad: "150", valorUnitario: "30.00" }]),
      /excede lo pedido/,
    );
    // La factura entera se deshizo: nada de inventario, nada de pedido.
    const { cabecera } = await con((db) => cargarPedido(db, p.id));
    assert.equal(cabecera.estado, "pendiente");
    const comprobantes = await raw<{ n: string }[]>`
      SELECT count(*)::text AS n FROM comprobantes WHERE empresa_id = ${empresaId}`;
    assert.equal(comprobantes[0]!.n, "0");
  });

  test("no deja facturar un pedido ya atendido", async () => {
    await stockInicial();
    const p = await pedir();
    await facturar(p.id, [
      { productoId: producto, cantidad: "100", valorUnitario: "30.00" },
      { productoId: productoDos, cantidad: "40", valorUnitario: "25.00" },
    ]);
    await assert.rejects(
      () => facturar(p.id, [{ productoId: producto, cantidad: "1", valorUnitario: "30.00" }]),
      /ya está atendido/,
    );
  });

  test("la venta guarda de qué pedido salió", async () => {
    await stockInicial();
    const p = await pedir();
    const v = await facturar(p.id, [
      { productoId: producto, cantidad: "10", valorUnitario: "30.00" },
    ]);
    const [fila] = await raw<{ pedido_id: string }[]>`
      SELECT pedido_id FROM comprobantes WHERE id = ${v.comprobanteId}`;
    assert.equal(fila!.pedido_id, p.id);
  });

  test("anular sólo mientras nadie despachó", async () => {
    await stockInicial();
    const p = await pedir();
    await con((db) => anularPedido(db, p.id));
    const [fila] = await con((db) => listarPedidos(db));
    assert.equal(fila!.estado, "anulado");

    const otro = await pedir();
    await facturar(otro.id, [{ productoId: producto, cantidad: "10", valorUnitario: "30.00" }]);
    await assert.rejects(() => con((db) => anularPedido(db, otro.id)), /ya no se anula/);
  });

  test("no se atiende un pedido anulado", async () => {
    await stockInicial();
    const p = await pedir();
    await con((db) => anularPedido(db, p.id));
    await assert.rejects(
      () => facturar(p.id, [{ productoId: producto, cantidad: "10", valorUnitario: "30.00" }]),
      /anulado/,
    );
  });

  test("filtra el listado por estado", async () => {
    await stockInicial();
    const p = await pedir();
    await pedir();
    await con((db) => anularPedido(db, p.id));
    const pendientes = await con((db) => listarPedidos(db, "pendiente"));
    assert.equal(pendientes.length, 1);
  });
});
