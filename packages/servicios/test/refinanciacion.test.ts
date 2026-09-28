/**
 * Renovación y refinanciación de letras.
 *
 * Lo que se comprueba es el signo de los intereses, que es donde estaba el
 * error: renovarle una letra a un **cliente** genera ingreso financiero y
 * aumenta lo que nos deben, no gasto y pasivo. Los asientos cuadraban igual con
 * el signo cambiado, que es lo que hacía el fallo invisible.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, canjearPorLetra, renovarLetra,
  refinanciarLetra, listarLetras, mayorDeCuenta, balanceComprobacion, PagoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let cliente = "";
let proveedor = "";
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

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;

  // Stock para poder vender.
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-08-01", moneda: "PEN", tipoCambio: "1", almacenId: almacen,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "100", valorUnitario: "100" }],
    }),
  );
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

/** Saldo de una cuenta en el mayor: debe menos haber. */
const saldoCuenta = async (cuenta: string, periodo: string) => {
  const mayor = (await con((db) => mayorDeCuenta(db, cuenta, periodo))) as unknown as {
    debe: string;
    haber: string;
  }[];
  return mayor.reduce((a, l) => money.add(a, money.sub(d(l.debe), d(l.haber))), money.ZERO);
};

const libroCuadra = async (periodo: string) => {
  const b = await con((db) => balanceComprobacion(db, periodo));
  return money.toString(b.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO), 2);
};

/** Una letra por cobrar de 5 900, nacida de una factura al cliente. */
async function letraPorCobrar(): Promise<string> {
  const v = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente, tipoDocumento: "01", serie: "F001",
      fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId: almacen,
      lineas: [{ productoId: producto, cantidad: "10", valorUnitario: "500" }],
    }),
  );
  const r = await con((db) =>
    canjearPorLetra(db, empresaId, usuarioId, {
      numero: "LT-001",
      cartera: "cobrar",
      terceroId: cliente,
      fechaGiro: "2026-09-05",
      fechaVencimiento: "2026-10-05",
      moneda: "PEN",
      documentos: [{ documentoId: v.comprobanteId, importe: "5900.00" }],
    }),
  );
  return r.letraId;
}

/** Una letra por pagar de 1 180, nacida de la factura del proveedor. */
async function letraPorPagar(): Promise<string> {
  const c = await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0000002",
      fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1",
      lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario: "1000", cuenta: "6431" }],
    }),
  );
  const r = await con((db) =>
    canjearPorLetra(db, empresaId, usuarioId, {
      numero: "LP-001",
      cartera: "pagar",
      terceroId: proveedor,
      fechaGiro: "2026-09-05",
      fechaVencimiento: "2026-10-05",
      moneda: "PEN",
      documentos: [{ documentoId: c.documentoCxpId, importe: "1180.00" }],
    }),
  );
  return r.letraId;
}

// ─── Signo de los intereses ───────────────────────────────────────────────

describe("intereses de una renovación", () => {
  /** El defecto: se asentaban como gasto y pasivo en las dos carteras. */
  test("en una letra por cobrar son ingreso financiero, no gasto", async () => {
    const id = await letraPorCobrar();
    await con((db) =>
      renovarLetra(db, empresaId, usuarioId, id, {
        numero: "LT-002",
        fecha: "2026-10-05",
        fechaVencimiento: "2026-11-05",
        intereses: "200.00",
      }),
    );

    // Ingreso financiero, no gasto.
    assert.equal(money.toString(await saldoCuenta("7721", "202610"), 2), "-200.00");
    assert.equal(money.toString(await saldoCuenta("6711", "202610"), 2), "0.00");
    // Y aumenta lo que nos deben, no lo que debemos.
    assert.equal(money.toString(await saldoCuenta("1232", "202610"), 2), "200.00");
    assert.equal(money.toString(await saldoCuenta("4231", "202610"), 2), "0.00");
    assert.equal(await libroCuadra("202610"), "0.00");
  });

  test("en una letra por pagar siguen siendo gasto financiero", async () => {
    const id = await letraPorPagar();
    await con((db) =>
      renovarLetra(db, empresaId, usuarioId, id, {
        numero: "LP-002",
        fecha: "2026-10-05",
        fechaVencimiento: "2026-11-05",
        intereses: "50.00",
      }),
    );
    assert.equal(money.toString(await saldoCuenta("6711", "202610"), 2), "50.00");
    assert.equal(money.toString(await saldoCuenta("4231", "202610"), 2), "-50.00");
    assert.equal(await libroCuadra("202610"), "0.00");
  });

  test("la letra nueva recoge el saldo más los intereses", async () => {
    const id = await letraPorCobrar();
    const r = await con((db) =>
      renovarLetra(db, empresaId, usuarioId, id, {
        numero: "LT-002",
        fecha: "2026-10-05",
        fechaVencimiento: "2026-11-05",
        intereses: "200.00",
      }),
    );
    assert.equal(s2(r.importe), "6100.00");
  });
});

// ─── Refinanciación ───────────────────────────────────────────────────────

describe("refinanciar una letra en cuotas", () => {
  test("reemplaza la letra por varias y la original queda renovada", async () => {
    const id = await letraPorCobrar();
    const r = await con((db) =>
      refinanciarLetra(db, empresaId, usuarioId, id, {
        fecha: "2026-10-05",
        cuotas: [
          { numero: "LT-002", fechaVencimiento: "2026-11-05", importe: "3000.00" },
          { numero: "LT-003", fechaVencimiento: "2026-12-05", importe: "2900.00" },
        ],
      }),
    );
    assert.equal(r.letras.length, 2);
    assert.equal(r.total, "5900.00");

    const cartera = await con((db) => listarLetras(db, "cobrar"));
    const original = cartera.find((l) => l.numero === "LT-001")!;
    assert.equal(original.estado, "renovada");
    assert.equal(s2(original.saldo), "0.00");
    assert.equal(cartera.filter((l) => l.estado === "girada").length, 2);
  });

  /**
   * Si las cuotas no suman, la refinanciación sería una condonación parcial
   * silenciosa: exactamente lo contrario de lo que se pretende.
   */
  test("las cuotas tienen que sumar el saldo más los intereses", async () => {
    const id = await letraPorCobrar();
    await assert.rejects(
      () =>
        con((db) =>
          refinanciarLetra(db, empresaId, usuarioId, id, {
            fecha: "2026-10-05",
            cuotas: [
              { numero: "LT-002", fechaVencimiento: "2026-11-05", importe: "3000.00" },
              { numero: "LT-003", fechaVencimiento: "2026-12-05", importe: "2000.00" },
            ],
          }),
        ),
      /suman 5000\.00 y deberían sumar 5900\.00/,
    );
  });

  test("con intereses, la suma incluye los intereses", async () => {
    const id = await letraPorCobrar();
    const r = await con((db) =>
      refinanciarLetra(db, empresaId, usuarioId, id, {
        fecha: "2026-10-05",
        intereses: "100.00",
        cuotas: [
          { numero: "LT-002", fechaVencimiento: "2026-11-05", importe: "3000.00" },
          { numero: "LT-003", fechaVencimiento: "2026-12-05", importe: "3000.00" },
        ],
      }),
    );
    assert.equal(r.total, "6000.00");
    assert.equal(money.toString(await saldoCuenta("7721", "202610"), 2), "-100.00");
    assert.equal(await libroCuadra("202610"), "0.00");
  });

  test("una sola cuota es una renovación, no una refinanciación", async () => {
    const id = await letraPorCobrar();
    await assert.rejects(
      () =>
        con((db) =>
          refinanciarLetra(db, empresaId, usuarioId, id, {
            fecha: "2026-10-05",
            cuotas: [{ numero: "LT-002", fechaVencimiento: "2026-11-05", importe: "5900.00" }],
          }),
        ),
      /dos cuotas o más/,
    );
  });

  test("las cuotas tienen que vencer después de refinanciar", async () => {
    const id = await letraPorCobrar();
    await assert.rejects(
      () =>
        con((db) =>
          refinanciarLetra(db, empresaId, usuarioId, id, {
            fecha: "2026-10-05",
            cuotas: [
              { numero: "LT-002", fechaVencimiento: "2026-10-01", importe: "3000.00" },
              { numero: "LT-003", fechaVencimiento: "2026-12-05", importe: "2900.00" },
            ],
          }),
        ),
      /debe vencer después/,
    );
  });

  test("una letra ya renovada no se refinancia", async () => {
    const id = await letraPorCobrar();
    await con((db) =>
      renovarLetra(db, empresaId, usuarioId, id, {
        numero: "LT-002", fecha: "2026-10-05", fechaVencimiento: "2026-11-05",
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          refinanciarLetra(db, empresaId, usuarioId, id, {
            fecha: "2026-10-06",
            cuotas: [
              { numero: "LT-003", fechaVencimiento: "2026-11-05", importe: "3000.00" },
              { numero: "LT-004", fechaVencimiento: "2026-12-05", importe: "2900.00" },
            ],
          }),
        ),
      /está renovada y no se refinancia/,
    );
  });

  test("también refinancia una letra por pagar", async () => {
    const id = await letraPorPagar();
    const r = await con((db) =>
      refinanciarLetra(db, empresaId, usuarioId, id, {
        fecha: "2026-10-05",
        intereses: "20.00",
        cuotas: [
          { numero: "LP-002", fechaVencimiento: "2026-11-05", importe: "600.00" },
          { numero: "LP-003", fechaVencimiento: "2026-12-05", importe: "600.00" },
        ],
      }),
    );
    assert.equal(r.total, "1200.00");
    // Por pagar: los intereses son gasto.
    assert.equal(money.toString(await saldoCuenta("6711", "202610"), 2), "20.00");
    assert.equal(await libroCuadra("202610"), "0.00");
  });
});
