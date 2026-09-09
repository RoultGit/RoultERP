/**
 * Cuentas por cobrar, contra Postgres real.
 *
 * La prueba que más importa es la del signo de la diferencia de cambio: una
 * cuenta por cobrar es un activo, así que una subida del dólar es ganancia. Es
 * lo contrario que en el módulo de pagos, y copiarlo mal es el error más
 * silencioso posible: los asientos cuadran igual y el resultado del ejercicio
 * sale al revés.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, registrarCobranza, canjearPorLetra,
  documentosPorCobrar, listarCobranzas, carteraPorCliente,
  estadoCredito, cabeEnElLimite, balanceComprobacion, CobranzaInvalida,
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
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_cliente, dias_credito, limite_credito)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true, 30, '20000')
    RETURNING id`;
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

async function venta(
  opts: { clienteId?: string; moneda?: string; tipoCambio?: string; valorUnitario?: string } = {},
): Promise<string> {
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: opts.clienteId ?? cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-01",
      fechaVencimiento: "2026-10-01",
      moneda: opts.moneda ?? "PEN",
      tipoCambio: opts.tipoCambio ?? "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "10", valorUnitario: opts.valorUnitario ?? "500" }],
    }),
  );
  return r.comprobanteId;
}

const cobranzaBase = (comprobanteId: string, importe: string) => ({
  numero: "CB-2026-001",
  clienteId: cliente,
  fecha: "2026-09-20",
  moneda: "PEN",
  tipoCambio: "1",
  medioCobro: "transferencia",
  cuentaDestino: "1041",
  aplicaciones: [{ comprobanteId, importe }],
});

// ─── Documentos por cobrar ────────────────────────────────────────────────

describe("documentos por cobrar", () => {
  test("una venta emitida aparece con su saldo completo", async () => {
    await venta();
    const docs = await con((db) => documentosPorCobrar(db));
    assert.equal(docs.length, 1);
    assert.equal(s2(docs[0]!.saldo), "5900.00");
    assert.equal(docs[0]!.fecha_vencimiento, "2026-10-01");
  });

  test("cobrar baja el saldo y cancelar lo saca de la lista", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "2000.00")));

    let docs = await con((db) => documentosPorCobrar(db));
    assert.equal(s2(docs[0]!.saldo), "3900.00");

    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(c, "3900.00"),
        numero: "CB-2026-002",
      }),
    );
    docs = await con((db) => documentosPorCobrar(db));
    assert.deepEqual(docs, [], "cancelado, sale de la cartera");
  });

  test("se puede filtrar por cliente", async () => {
    await venta();
    await venta({ clienteId: otroCliente });
    assert.equal((await con((db) => documentosPorCobrar(db, cliente))).length, 1);
    assert.equal((await con((db) => documentosPorCobrar(db))).length, 2);
  });
});

// ─── Cobranzas ────────────────────────────────────────────────────────────

describe("cobranzas", () => {
  test("no se puede cobrar más que el saldo", async () => {
    const c = await venta();
    await assert.rejects(
      () => con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "9000.00"))),
      /tiene un saldo de 5900.00 y se intenta cobrar 9000.00/,
    );
  });

  test("un comprobante de otro cliente se rechaza", async () => {
    const ajeno = await venta({ clienteId: otroCliente });
    await assert.rejects(
      () => con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(ajeno, "100.00"))),
      /es de otro cliente/,
    );
  });

  test("un importe cero o negativo se rechaza", async () => {
    const c = await venta();
    for (const importe of ["0", "-500"]) {
      await assert.rejects(
        () => con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, importe))),
        /debe ser positivo/,
      );
    }
  });

  test("una cobranza cubre varias facturas del mismo cliente", async () => {
    const a = await venta();
    const b = await venta();
    const r = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(a, "5900.00"),
        aplicaciones: [
          { comprobanteId: a, importe: "5900.00" },
          { comprobanteId: b, importe: "5900.00" },
        ],
      }),
    );
    assert.equal(r.importe, "11800.00");
    assert.equal(r.documentosCancelados, 2);
  });

  test("el asiento cuadra: entra al banco y baja el cliente", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "5900.00")));

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "1041")!.saldo), "5900.00", "entra al banco");
    // La 1212 se cargó al vender y se abona al cobrar: queda en cero.
    assert.equal(s2(balance.find((b) => b.cuenta === "1212")!.saldo), "0.00");
  });

  test("la cobranza aparece en la lista con su cliente", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "5900.00")));
    const lista = await con((db) => listarCobranzas(db));
    assert.equal(lista.length, 1);
    assert.match(lista[0]!.cliente, /HIDRAULICA/);
  });

  test("una cobranza sin aplicaciones se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          registrarCobranza(db, empresaId, usuarioId, {
            ...cobranzaBase("x", "1"),
            aplicaciones: [],
          }),
        ),
      CobranzaInvalida,
    );
  });
});

// ─── Diferencia de cambio: el signo se invierte ───────────────────────────

describe("diferencia de cambio en cobranzas", () => {
  test("cobrar en dólares cuando el dólar subió es una GANANCIA", async () => {
    // Lo contrario que al pagar. Una cuenta por cobrar es un activo: los mismos
    // dólares valen más soles hoy que cuando se facturó.
    const c = await venta({ moneda: "USD", tipoCambio: "3.75" });
    const r = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(c, "5900.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );
    // 5900 × (3.80 − 3.75) = 295, a favor
    assert.equal(r.diferenciaCambio, "295.00");

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.ok(balance.find((b) => b.cuenta === "776"), "la ganancia va a la 776");
    assert.ok(!balance.find((b) => b.cuenta === "676"), "no debe haber pérdida");
  });

  test("cuando el dólar bajó es una pérdida", async () => {
    const c = await venta({ moneda: "USD", tipoCambio: "3.80" });
    const r = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(c, "5900.00"),
        moneda: "USD",
        tipoCambio: "3.75",
      }),
    );
    assert.equal(r.diferenciaCambio, "-295.00");
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.ok(balance.find((b) => b.cuenta === "676"), "la pérdida va a la 676");
  });

  test("la cuenta del cliente queda en cero pese al cambio de tipo", async () => {
    const c = await venta({ moneda: "USD", tipoCambio: "3.75" });
    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(c, "5900.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );
    const [fila] = await raw<{ saldo: string }[]>`
      SELECT coalesce(sum(debe_funcional - haber_funcional), 0)::text AS saldo
      FROM asiento_lineas WHERE cuenta = '1212'`;
    assert.equal(s2(fila!.saldo), "0.00", "la deuda del cliente queda saldada por completo");
  });

  test("el asiento con diferencia de cambio cuadra en ambas monedas", async () => {
    const c = await venta({ moneda: "USD", tipoCambio: "3.75" });
    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        ...cobranzaBase(c, "5900.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
  });

  test("una venta en soles no genera diferencia", async () => {
    const c = await venta();
    const r = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "5900.00")),
    );
    assert.equal(r.diferenciaCambio, "0.00");
  });
});

// ─── Límite de crédito ────────────────────────────────────────────────────

describe("límite de crédito", () => {
  test("una venta consume el disponible", async () => {
    await venta();
    const e = await con((db) => estadoCredito(db, cliente));
    assert.equal(money.toString(e.limite, 2), "20000.00");
    assert.equal(money.toString(e.usado, 2), "5900.00");
    assert.equal(money.toString(e.disponible, 2), "14100.00");
    assert.equal(e.sinLimite, false);
  });

  test("cobrar libera el disponible", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "5900.00")));
    const e = await con((db) => estadoCredito(db, cliente));
    assert.equal(money.toString(e.usado, 2), "0.00");
    assert.equal(money.toString(e.disponible, 2), "20000.00");
  });

  test("una venta que no cabe se informa con el motivo, no se bloquea sola", async () => {
    // La decisión de vender igual es comercial; el sistema informa y quien
    // vende decide.
    await venta();
    const r = await con((db) => cabeEnElLimite(db, cliente, money.dec("20000")));
    assert.equal(r.cabe, false);
    assert.match(r.motivo!, /límite de 20000.00/);
    assert.match(r.motivo!, /le quedan 14100.00/);
  });

  test("lo que sí cabe se autoriza", async () => {
    await venta();
    assert.equal((await con((db) => cabeEnElLimite(db, cliente, money.dec("5000")))).cabe, true);
  });

  test("un cliente sin límite no tiene tope", async () => {
    const r = await con((db) => cabeEnElLimite(db, otroCliente, money.dec("999999")));
    assert.equal(r.cabe, true);
    assert.equal(r.estado.sinLimite, true);
  });

  test("lo vencido se cuenta aparte de lo usado", async () => {
    // Un cliente dentro del límite pero todo vencido es más riesgoso que uno al
    // tope y al día, así que las dos cifras se devuelven separadas.
    await venta();
    await raw`UPDATE comprobantes SET fecha_vencimiento = '2026-01-01'`;
    const e = await con((db) => estadoCredito(db, cliente));
    assert.equal(money.toString(e.usado, 2), "5900.00");
    assert.equal(money.toString(e.vencido, 2), "5900.00");
  });
});

// ─── Cartera ──────────────────────────────────────────────────────────────

describe("cartera por cliente", () => {
  test("agrupa el saldo y lo vencido por cliente", async () => {
    await venta();
    await venta({ clienteId: otroCliente });
    const cartera = await con((db) => carteraPorCliente(db));
    assert.equal(cartera.length, 2);
    assert.equal(s2(cartera[0]!.saldo), "5900.00");
  });

  test("un cliente sin saldo no aparece", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "5900.00")));
    assert.deepEqual(await con((db) => carteraPorCliente(db)), []);
  });
});

// ─── Canje por letra en la cartera de cobrar ──────────────────────────────

describe("letras por cobrar", () => {
  test("canjear una venta por letra la saca de la cartera de facturas", async () => {
    const c = await venta();
    await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, {
        numero: "LC-001",
        cartera: "cobrar",
        terceroId: cliente,
        fechaGiro: "2026-09-15",
        fechaVencimiento: "2026-12-15",
        moneda: "PEN",
        documentos: [{ documentoId: c, importe: "5900.00" }],
      }),
    );
    // La misma tabla de letras sirve a ambas carteras; el saldo del comprobante
    // baja porque el canje cuenta como cobrado a efectos del pendiente.
    const docs = await con((db) => documentosPorCobrar(db));
    assert.deepEqual(docs, [], "la factura deja de estar pendiente");
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("las cobranzas de una empresa no se ven desde otra", async () => {
    const c = await venta();
    await con((db) => registrarCobranza(db, empresaId, usuarioId, cobranzaBase(c, "1000.00")));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarCobranzas(db),
    );
    assert.deepEqual(desdeOtra, []);
    assert.deepEqual(
      await enEmpresa(app, { empresaId: otra.empresaId, usuarioId: otra.usuarioId }, (db) =>
        documentosPorCobrar(db),
      ),
      [],
    );
  });
});
