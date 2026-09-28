/**
 * Orden de pago y estado de cuenta del proveedor.
 *
 * Lo que se comprueba es el control: que no se pague lo que nadie autorizó, que
 * dos órdenes no puedan reclamar la misma factura, y que el estado de cuenta
 * explique el saldo en vez de sólo declararlo.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearCuenta, registrarCompra, registrarPago, listarCxp,
  crearOrdenPago, resolverOrdenPago, anularOrdenPago, ejecutarOrdenPago,
  listarOrdenesPago, cargarOrdenPago, documentosOrdenables, estadoCuentaProveedor,
  cuentasConSaldo, balanceComprobacion, OrdenPagoInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let autorizador = "";
let proveedor = "";
let otroProveedor = "";
let bancoId = "";

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

  // Un segundo usuario: autorizar lo que uno mismo pidió es lo que la orden de
  // pago existe para evitar, aunque el programa no lo impida todavía.
  const [u] = await raw<{ id: string }[]>`
    INSERT INTO usuarios (email, nombre, password_hash)
    VALUES ('gerencia@servidimar.pe', 'Gerencia', 'x') RETURNING id`;
  autorizador = u!.id;

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SAN MARTIN SAC', true, 30)
    RETURNING id`;
  proveedor = p!.id;

  const [o] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20522633721', 'OTRO PROVEEDOR SAC', true) RETURNING id`;
  otroProveedor = o!.id;

  bancoId = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "BCP", nombre: "BCP soles", tipo: "banco",
      moneda: "PEN", cuentaContable: "1041",
      banco: "BCP", numeroCuenta: "191-1234567-0-11",
    }),
  );
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);
const d = (v: string) => money.dec(v);

/** Una compra de servicio, que deja su documento por pagar. */
async function compra(
  numero: string,
  valorUnitario: string,
  opts: { moneda?: string; tipoCambio?: string; proveedorId?: string } = {},
): Promise<string> {
  const r = await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: opts.proveedorId ?? proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero,
      fechaEmision: "2026-08-01",
      moneda: opts.moneda ?? "PEN",
      tipoCambio: opts.tipoCambio ?? "1",
      lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario, cuenta: "6431" }],
    }),
  );
  return r.documentoCxpId;
}

const ordenar = (documentos: { documentoId: string; importe?: string }[]) =>
  con((db) =>
    crearOrdenPago(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      fecha: "2026-09-05",
      medioPago: "transferencia",
      cuentaEfectivoId: bancoId,
      documentos,
    }),
  );

// ─── Armar la orden ───────────────────────────────────────────────────────

describe("armar la orden de pago", () => {
  test("toma el saldo completo cuando no se dice cuánto", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    assert.equal(o.numero, "OP2026-000001");
    assert.equal(o.importe, "1180.00");

    const { cabecera, documentos } = await con((db) => cargarOrdenPago(db, o.id));
    assert.equal(cabecera.estado, "pendiente");
    assert.equal(cabecera.solicitante ?? null, null);
    assert.equal(documentos.length, 1);
    assert.equal(s2(documentos[0]!.importe), "1180.00");
  });

  test("suma varios documentos del mismo proveedor", async () => {
    const uno = await compra("0000001", "1000");
    const dos = await compra("0000002", "500");
    const o = await ordenar([{ documentoId: uno }, { documentoId: dos }]);
    assert.equal(o.importe, "1770.00");
  });

  test("admite un pago a cuenta", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc, importe: "500.00" }]);
    assert.equal(o.importe, "500.00");
  });

  test("no mezcla proveedores", async () => {
    const mio = await compra("0000001", "1000");
    const ajeno = await compra("0000009", "300", { proveedorId: otroProveedor });
    await assert.rejects(
      () => ordenar([{ documentoId: mio }, { documentoId: ajeno }]),
      /es de otro proveedor/,
    );
  });

  test("no mezcla monedas", async () => {
    const soles = await compra("0000001", "1000");
    const dolares = await compra("0000002", "300", { moneda: "USD", tipoCambio: "3.80" });
    await assert.rejects(
      () => ordenar([{ documentoId: soles }, { documentoId: dolares }]),
      /no mezcla monedas/,
    );
  });

  /**
   * El error caro que este documento evita: dos órdenes pidiendo el pago de la
   * misma factura y la empresa pagándola dos veces.
   */
  test("no deja ordenar dos veces el mismo saldo", async () => {
    const doc = await compra("0000001", "1000");
    await ordenar([{ documentoId: doc, importe: "700.00" }]);

    await assert.rejects(
      () => ordenar([{ documentoId: doc, importe: "700.00" }]),
      /sólo quedan 480\.00 sin ordenar.*otra orden/s,
    );
    // Lo que sí queda libre se puede ordenar.
    const segunda = await ordenar([{ documentoId: doc }]);
    assert.equal(segunda.importe, "480.00");
  });

  test("lo comprometido se descuenta de lo ordenable", async () => {
    const doc = await compra("0000001", "1000");
    await ordenar([{ documentoId: doc, importe: "700.00" }]);
    const libres = await con((db) => documentosOrdenables(db, proveedor));
    assert.equal(libres.length, 1);
    assert.equal(libres[0]!.enOrden, "700.00");
    assert.equal(libres[0]!.libre, "480.00");
  });

  test("una orden anulada libera su saldo", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    assert.equal((await con((db) => documentosOrdenables(db, proveedor))).length, 0);
    await con((db) => anularOrdenPago(db, o.id));
    const libres = await con((db) => documentosOrdenables(db, proveedor));
    assert.equal(libres[0]!.libre, "1180.00");
  });

  test("rechaza una orden sin documentos", async () => {
    await assert.rejects(() => ordenar([]), /al menos un documento/);
  });
});

// ─── Autorización ─────────────────────────────────────────────────────────

describe("autorización", () => {
  test("autorizar deja constancia de quién firmó", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    await con((db) => resolverOrdenPago(db, o.id, autorizador, { estado: "autorizada" }));

    const [fila] = await raw<{ autorizada_por: string; autorizada_en: Date }[]>`
      SELECT autorizada_por, autorizada_en FROM ordenes_pago WHERE id = ${o.id}`;
    assert.equal(fila!.autorizada_por, autorizador);
    assert.ok(fila!.autorizada_en);
  });

  test("rechazar exige motivo y lo guarda", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    await assert.rejects(
      () => con((db) => resolverOrdenPago(db, o.id, autorizador, { estado: "rechazada" })),
      /motivo del rechazo/,
    );
    await con((db) =>
      resolverOrdenPago(db, o.id, autorizador, {
        estado: "rechazada",
        motivo: "Falta la conformidad del área usuaria",
      }),
    );
    const [fila] = await con((db) => listarOrdenesPago(db, "rechazada"));
    assert.equal(fila!.motivoRechazo, "Falta la conformidad del área usuaria");
  });

  test("no se resuelve dos veces", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    await con((db) => resolverOrdenPago(db, o.id, autorizador, { estado: "autorizada" }));
    await assert.rejects(
      () =>
        con((db) =>
          resolverOrdenPago(db, o.id, autorizador, { estado: "rechazada", motivo: "x" }),
        ),
      /ya no se resuelve/,
    );
  });
});

// ─── Ejecución ────────────────────────────────────────────────────────────

describe("ejecutar la orden", () => {
  async function autorizada(importe?: string) {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc, ...(importe ? { importe } : {}) }]);
    await con((db) => resolverOrdenPago(db, o.id, autorizador, { estado: "autorizada" }));
    return { doc, o };
  }

  test("sólo se paga lo autorizado", async () => {
    const doc = await compra("0000001", "1000");
    const o = await ordenar([{ documentoId: doc }]);
    await assert.rejects(
      () =>
        con((db) =>
          ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-10" }),
        ),
      /sólo se paga lo autorizado/,
    );
  });

  test("ejecutar cancela el documento y mueve el banco", async () => {
    const { o } = await autorizada();
    const r = await con((db) =>
      ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-10" }),
    );
    assert.equal(r.numeroPago, "PG2026-000001");
    assert.equal(r.importeNeto, "1180.00");

    assert.deepEqual(await con((db) => listarCxp(db)), [], "no quedan documentos abiertos");

    // El dinero salió del banco de verdad, no sólo del mayor.
    const cuentas = await con((db) => cuentasConSaldo(db));
    assert.equal(s2(cuentas.find((c) => c.id === bancoId)!.saldo), "-1180.00");

    const { cabecera } = await con((db) => cargarOrdenPago(db, o.id));
    assert.equal(cabecera.estado, "pagada");
    assert.equal(cabecera.pagoId, r.pagoId);

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(
      money.toString(balance.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO), 2),
      "0.00",
    );
  });

  test("un pago a cuenta deja el documento parcial", async () => {
    const { doc, o } = await autorizada("500.00");
    await con((db) => ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-10" }));
    const abiertos = await con((db) => listarCxp(db));
    assert.equal(abiertos.length, 1);
    assert.equal(abiertos[0]!.id, doc);
    assert.equal(s2(abiertos[0]!.saldo), "680.00");
  });

  test("no se ejecuta dos veces", async () => {
    const { o } = await autorizada();
    await con((db) => ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-10" }));
    await assert.rejects(
      () => con((db) => ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-11" })),
      /ya se pagó/,
    );
  });

  test("una orden pagada ya no se anula", async () => {
    const { o } = await autorizada();
    await con((db) => ejecutarOrdenPago(db, empresaId, usuarioId, o.id, { fecha: "2026-09-10" }));
    await assert.rejects(() => con((db) => anularOrdenPago(db, o.id)), /extorne el pago/);
  });
});

// ─── Estado de cuenta ─────────────────────────────────────────────────────

describe("estado de cuenta del proveedor", () => {
  test("explica el saldo con cargos y abonos en orden", async () => {
    const uno = await compra("0000001", "1000");
    await compra("0000002", "500");
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        numero: "PG-2026-001",
        proveedorId: proveedor,
        fecha: "2026-09-10",
        moneda: "PEN",
        tipoCambio: "1",
        medioPago: "transferencia",
        cuentaOrigen: "1041",
        cuentaEfectivoId: bancoId,
        aplicaciones: [{ documentoId: uno, importe: "1180.00" }],
      }),
    );

    const [cuenta] = await con((db) => estadoCuentaProveedor(db, proveedor));
    assert.equal(cuenta!.moneda, "PEN");
    assert.equal(cuenta!.movimientos.length, 3);
    // 1180 + 590 de cargos, 1180 de abono: queda debiendo la segunda factura.
    assert.equal(cuenta!.saldoFinal, "590.00");

    const tipos = cuenta!.movimientos.map((m) => m.tipo);
    assert.deepEqual(tipos, ["documento", "documento", "pago"]);
    assert.equal(cuenta!.movimientos[2]!.saldo, "590.00");
  });

  test("separa las monedas en vez de sumarlas", async () => {
    await compra("0000001", "1000");
    await compra("0000002", "300", { moneda: "USD", tipoCambio: "3.80" });
    const cuentas = await con((db) => estadoCuentaProveedor(db, proveedor));
    assert.deepEqual(cuentas.map((c) => c.moneda), ["PEN", "USD"]);
    assert.equal(cuentas[0]!.saldoFinal, "1180.00");
    assert.equal(cuentas[1]!.saldoFinal, "354.00");
  });

  /**
   * Si un pago del mismo día apareciera antes que su factura, el saldo quedaría
   * negativo un renglón y quien lo lee creería que se pagó de más.
   */
  test("el documento va antes que su pago del mismo día", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        numero: "PG-2026-001",
        proveedorId: proveedor,
        fecha: "2026-08-01",
        moneda: "PEN",
        tipoCambio: "1",
        medioPago: "efectivo",
        cuentaOrigen: "1011",
        aplicaciones: [{ documentoId: doc, importe: "1180.00" }],
      }),
    );
    const [cuenta] = await con((db) => estadoCuentaProveedor(db, proveedor));
    assert.deepEqual(cuenta!.movimientos.map((m) => m.tipo), ["documento", "pago"]);
    assert.equal(cuenta!.movimientos[0]!.saldo, "1180.00");
    assert.equal(cuenta!.saldoFinal, "0.00");
  });

  test("un proveedor sin movimientos devuelve nada, no un error", async () => {
    assert.deepEqual(await con((db) => estadoCuentaProveedor(db, otroProveedor)), []);
  });
});
