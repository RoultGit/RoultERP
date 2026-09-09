/**
 * Pagos a proveedores y letras, contra Postgres real.
 *
 * Lo que se verifica: que la deuda baje exactamente por lo pagado, que la
 * retención de IGV cancele por el bruto pero salga por el neto, y que la
 * diferencia de cambio se reconozca al cancelar una factura en dólares.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, registrarPago, canjearPorLetra, renovarLetra,
  listarPagos, listarLetras, documentosPorPagar, listarCxp,
  balanceComprobacion, PagoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let proveedor = "";
let otroProveedor = "";

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
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

/** Registra una compra y devuelve el documento por pagar que genera. */
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
      lineas: [
        { descripcion: "Servicio", cantidad: "1", valorUnitario, cuenta: "6431" },
      ],
    }),
  );
  return r.documentoCxpId;
}

const pagoBase = (documentoId: string, importe: string) => ({
  numero: "PG-2026-001",
  proveedorId: proveedor,
  fecha: "2026-09-10",
  moneda: "PEN",
  tipoCambio: "1",
  medioPago: "transferencia",
  cuentaOrigen: "1041",
  aplicaciones: [{ documentoId, importe }],
});

// ─── Pagos ────────────────────────────────────────────────────────────────

describe("pagos", () => {
  test("cancelar el total deja el documento pagado y sin saldo", async () => {
    const doc = await compra("0000001", "1000");
    const r = await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1180.00")));

    assert.equal(r.importeBruto, "1180.00");
    assert.equal(r.documentosCancelados, 1);
    assert.deepEqual(await con((db) => listarCxp(db)), [], "no quedan documentos abiertos");
  });

  test("un pago parcial baja el saldo y deja el documento en parcial", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "500.00")));

    const abiertos = await con((db) => listarCxp(db));
    assert.equal(abiertos.length, 1);
    assert.equal(s2(abiertos[0]!.saldo), "680.00");
    assert.equal(abiertos[0]!.estado, "parcial");
  });

  test("varios pagos parciales terminan cancelando", async () => {
    const doc = await compra("0000001", "1000");
    for (const [i, importe] of ["500.00", "500.00", "180.00"].entries()) {
      await con((db) =>
        registrarPago(db, empresaId, usuarioId, {
          ...pagoBase(doc, importe),
          numero: `PG-2026-00${i + 1}`,
        }),
      );
    }
    assert.deepEqual(await con((db) => listarCxp(db)), []);
  });

  test("no se puede pagar más que el saldo", async () => {
    const doc = await compra("0000001", "1000");
    await assert.rejects(
      () => con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "2000.00"))),
      /tiene un saldo de 1180.00 y se intenta aplicar 2000.00/,
    );
  });

  test("tampoco después de un pago parcial", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1000.00")));
    await assert.rejects(
      () =>
        con((db) =>
          registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "500.00"), numero: "PG-2" }),
        ),
      /saldo de 180.00/,
    );
  });

  test("un documento de otro proveedor se rechaza", async () => {
    const ajeno = await compra("0000009", "1000", { proveedorId: otroProveedor });
    await assert.rejects(
      () => con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(ajeno, "100.00"))),
      /es de otro proveedor/,
    );
  });

  test("un importe cero o negativo se rechaza", async () => {
    const doc = await compra("0000001", "1000");
    for (const importe of ["0", "-100"]) {
      await assert.rejects(
        () => con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, importe))),
        /debe ser positivo/,
      );
    }
  });

  test("un pago sin aplicaciones se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          registrarPago(db, empresaId, usuarioId, {
            ...pagoBase("x", "1"),
            aplicaciones: [],
          }),
        ),
      PagoInvalido,
    );
  });

  test("un pago cubre varias facturas del mismo proveedor", async () => {
    const a = await compra("0000001", "1000");
    const b = await compra("0000002", "500");
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        ...pagoBase(a, "1180.00"),
        aplicaciones: [
          { documentoId: a, importe: "1180.00" },
          { documentoId: b, importe: "590.00" },
        ],
      }),
    );
    assert.equal(r.importeBruto, "1770.00");
    assert.equal(r.documentosCancelados, 2);
    assert.deepEqual(await con((db) => listarCxp(db)), []);
  });

  test("el asiento cuadra: se carga al proveedor y se abona el banco", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1180.00")));

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");

    assert.equal(s2(balance.find((b) => b.cuenta === "4212")!.saldo), "1180.00", "baja la deuda");
    assert.equal(s2(balance.find((b) => b.cuenta === "1041")!.saldo), "-1180.00", "sale del banco");
  });

  test("el pago aparece en la lista con su proveedor", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1180.00")));
    const lista = await con((db) => listarPagos(db));
    assert.equal(lista.length, 1);
    assert.match(lista[0]!.proveedor, /FERRETERIA/);
    assert.equal(lista[0]!.medioPago, "transferencia");
  });

  test("documentosPorPagar sólo trae los que tienen saldo", async () => {
    const a = await compra("0000001", "1000");
    await compra("0000002", "500");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(a, "1180.00")));

    const abiertos = await con((db) => documentosPorPagar(db, proveedor));
    assert.equal(abiertos.length, 1);
    assert.equal(abiertos[0]!.numero, "0000002");
  });
});

// ─── Retención del IGV ────────────────────────────────────────────────────

describe("retención del IGV", () => {
  beforeEach(async () => {
    await raw`UPDATE empresas SET es_agente_retencion = true WHERE id = ${empresaId}`;
  });

  test("se retiene el 3 %: la deuda se cancela por el bruto y sale el neto", async () => {
    const doc = await compra("0000001", "1000");
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "1180.00"), retenerIgv: true }),
    );

    assert.equal(r.importeBruto, "1180.00");
    assert.equal(r.retencion, "35.40", "3 % de 1180");
    assert.equal(r.importeNeto, "1144.60");
    assert.deepEqual(await con((db) => listarCxp(db)), [], "la deuda queda cancelada entera");
  });

  test("el asiento separa la retención y sigue cuadrando", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "1180.00"), retenerIgv: true }),
    );

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");

    assert.equal(s2(balance.find((b) => b.cuenta === "4212")!.saldo), "1180.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "1041")!.saldo), "-1144.60");
    assert.equal(
      s2(balance.find((b) => b.cuenta === "40114")!.saldo),
      "-35.40",
      "la retención queda por entregar al fisco",
    );
  });

  test("no se retiene por debajo del mínimo de S/ 700", async () => {
    const doc = await compra("0000001", "500");
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "590.00"), retenerIgv: true }),
    );
    assert.equal(r.retencion, "0.00");
  });

  test("si la empresa no es agente de retención, no retiene aunque se pida", async () => {
    await raw`UPDATE empresas SET es_agente_retencion = false WHERE id = ${empresaId}`;
    const doc = await compra("0000001", "1000");
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "1180.00"), retenerIgv: true }),
    );
    assert.equal(r.retencion, "0.00");
  });

  test("no se retiene a otro agente de retención", async () => {
    await raw`UPDATE terceros SET es_agente_retencion = true WHERE id = ${proveedor}`;
    const doc = await compra("0000001", "1000");
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, { ...pagoBase(doc, "1180.00"), retenerIgv: true }),
    );
    assert.equal(r.retencion, "0.00");
  });
});

// ─── Diferencia de cambio ─────────────────────────────────────────────────

describe("diferencia de cambio", () => {
  test("pagar una factura en dólares cuando el dólar subió es una pérdida", async () => {
    // La deuda se registró a 3.75 y se paga a 3.80: hay que dar más soles por
    // los mismos dólares.
    const doc = await compra("0000001", "1000", { moneda: "USD", tipoCambio: "3.75" });
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        ...pagoBase(doc, "1180.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );
    // 1180 USD × (3.80 − 3.75) = 59, en contra
    assert.equal(r.diferenciaCambio, "-59.00");

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.ok(balance.find((b) => b.cuenta === "676"), "la pérdida va a la 676");
  });

  test("cuando el dólar bajó es una ganancia", async () => {
    const doc = await compra("0000001", "1000", { moneda: "USD", tipoCambio: "3.80" });
    const r = await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        ...pagoBase(doc, "1180.00"),
        moneda: "USD",
        tipoCambio: "3.75",
      }),
    );
    assert.equal(r.diferenciaCambio, "59.00");

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.ok(balance.find((b) => b.cuenta === "776"), "la ganancia va a la 776");
  });

  test("una factura en soles no genera diferencia de cambio", async () => {
    const doc = await compra("0000001", "1000");
    const r = await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1180.00")));
    assert.equal(r.diferenciaCambio, "0.00");
  });

  test("la cuenta del proveedor queda en cero pese al cambio de tipo", async () => {
    // Es el punto de todo el mecanismo: la deuda se registró a 3.75 y se pagó a
    // 3.80. Si el asiento cancelara al tipo de hoy, quedaría un saldo residual
    // en la 4212 que nadie sabría explicar meses después.
    const doc = await compra("0000001", "1000", { moneda: "USD", tipoCambio: "3.75" });
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        ...pagoBase(doc, "1180.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );

    // El registro de la compra está en agosto y el pago en setiembre; el saldo
    // de la cuenta es la suma de ambos periodos.
    const [fila] = await raw<{ saldo: string }[]>`
      SELECT coalesce(sum(debe_funcional - haber_funcional), 0)::text AS saldo
      FROM asiento_lineas WHERE cuenta = '4212'`;
    assert.equal(s2(fila!.saldo), "0.00", "la deuda queda cancelada por completo");
  });

  test("el asiento con diferencia de cambio también cuadra", async () => {
    const doc = await compra("0000001", "1000", { moneda: "USD", tipoCambio: "3.75" });
    await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        ...pagoBase(doc, "1180.00"),
        moneda: "USD",
        tipoCambio: "3.80",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
  });
});

// ─── Letras ───────────────────────────────────────────────────────────────

describe("letras", () => {
  const canje = (documentoId: string, importe: string) => ({
    numero: "LT-001",
    cartera: "pagar" as const,
    terceroId: proveedor,
    fechaGiro: "2026-09-01",
    fechaVencimiento: "2026-11-30",
    moneda: "PEN",
    documentos: [{ documentoId, importe }],
  });

  test("el canje cambia la deuda de forma, no la cancela", async () => {
    const doc = await compra("0000001", "1000");
    const r = await con((db) => canjearPorLetra(db, empresaId, usuarioId, canje(doc, "1180.00")));
    assert.equal(r.importe, "1180.00");

    // La factura deja de estar pendiente…
    assert.deepEqual(await con((db) => listarCxp(db)), []);
    // …y en su lugar hay una letra por el mismo importe.
    const cartera = await con((db) => listarLetras(db, "pagar"));
    assert.equal(cartera.length, 1);
    assert.equal(s2(cartera[0]!.saldo), "1180.00");
    assert.equal(cartera[0]!.fechaVencimiento, "2026-11-30");
  });

  test("el asiento traslada de la 4212 a la 4231 y cuadra", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => canjearPorLetra(db, empresaId, usuarioId, canje(doc, "1180.00")));

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "4231")!.saldo), "-1180.00");
  });

  test("no se canjea más de lo que se debe", async () => {
    const doc = await compra("0000001", "1000");
    await assert.rejects(
      () => con((db) => canjearPorLetra(db, empresaId, usuarioId, canje(doc, "5000.00"))),
      /se intenta canjear 5000.00/,
    );
  });

  test("una letra que vence antes de girarse se rechaza", async () => {
    const doc = await compra("0000001", "1000");
    await assert.rejects(
      () =>
        con((db) =>
          canjearPorLetra(db, empresaId, usuarioId, {
            ...canje(doc, "1180.00"),
            fechaVencimiento: "2026-08-01",
          }),
        ),
      /debe vencer después de su fecha de giro/,
    );
  });

  test("renovar crea una letra nueva y marca la anterior", async () => {
    const doc = await compra("0000001", "1000");
    const { letraId } = await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, canje(doc, "1180.00")),
    );

    const r = await con((db) =>
      renovarLetra(db, empresaId, usuarioId, letraId, {
        numero: "LT-002",
        fecha: "2026-11-30",
        fechaVencimiento: "2027-01-31",
        intereses: "50.00",
      }),
    );
    assert.equal(r.importe, "1230.00", "el saldo más los intereses");

    const cartera = await con((db) => listarLetras(db, "pagar"));
    const original = cartera.find((l) => l.numero === "LT-001")!;
    const nueva = cartera.find((l) => l.numero === "LT-002")!;
    assert.equal(original.estado, "renovada");
    assert.equal(s2(original.saldo), "0.00");
    assert.equal(s2(nueva.saldo), "1230.00");
  });

  test("los intereses de la renovación son un gasto financiero, no más deuda original", async () => {
    const doc = await compra("0000001", "1000");
    const { letraId } = await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, canje(doc, "1180.00")),
    );
    await con((db) =>
      renovarLetra(db, empresaId, usuarioId, letraId, {
        numero: "LT-002",
        fecha: "2026-11-30",
        fechaVencimiento: "2027-01-31",
        intereses: "50.00",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202611"));
    assert.equal(s2(balance.find((b) => b.cuenta === "6711")!.saldo), "50.00");
  });

  test("una letra ya renovada no se renueva otra vez", async () => {
    const doc = await compra("0000001", "1000");
    const { letraId } = await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, canje(doc, "1180.00")),
    );
    const datos = {
      numero: "LT-002",
      fecha: "2026-11-30",
      fechaVencimiento: "2027-01-31",
    };
    await con((db) => renovarLetra(db, empresaId, usuarioId, letraId, datos));
    await assert.rejects(
      () => con((db) => renovarLetra(db, empresaId, usuarioId, letraId, { ...datos, numero: "LT-003" })),
      /está renovada y no se renueva/,
    );
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("los pagos y las letras de una empresa no se ven desde otra", async () => {
    const doc = await compra("0000001", "1000");
    await con((db) => registrarPago(db, empresaId, usuarioId, pagoBase(doc, "1180.00")));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarPagos(db),
    );
    assert.deepEqual(desdeOtra, []);
  });
});
