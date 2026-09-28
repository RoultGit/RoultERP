/**
 * Caja y bancos: recibos, cheques y entregas a rendir.
 *
 * Lo que se comprueba es que cada documento diga la verdad sobre el dinero: que
 * el recibo mueva la caja de verdad, que un cheque girado no descuente el saldo
 * hasta que el banco lo cobre, y que una entrega a rendir sea un activo hasta
 * que alguien la justifique.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearCuenta, cuentasConSaldo, movimientosDe,
  emitirRecibo, listarRecibos, cargarRecibo,
  girarCheque, cambiarEstadoCheque, situacionCheques, chequeVoucher,
  entregarARendir, rendirEntrega, listarEntregas, cargarEntrega, anularEntrega,
  balanceComprobacion, mayorDeCuenta, CajaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let caja = "";
let banco = "";
let tercero = "";
let centroCosto = "";

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

  caja = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "CAJA", nombre: "Caja general", tipo: "caja",
      moneda: "PEN", cuentaContable: "1011",
    }),
  );
  banco = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "BCP-SOL", nombre: "BCP cuenta corriente soles", tipo: "banco",
      moneda: "PEN", cuentaContable: "1041", banco: "BCP", numeroCuenta: "191-1234567-0-11",
    }),
  );

  const [t] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  tercero = t!.id;

  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
  centroCosto = cc!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

const saldoDe = async (cuentaId: string) => {
  const cuentas = await con((db) => cuentasConSaldo(db));
  return cuentas.find((c) => c.id === cuentaId)!.saldo;
};

/** Saldo de una cuenta en el mayor: debe menos haber. */
const saldoDeCuenta = async (cuenta: string, periodo: string) => {
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

// ─── Recibos ──────────────────────────────────────────────────────────────

describe("recibos de caja", () => {
  test("un recibo de ingreso numera, mueve la caja y contabiliza", async () => {
    const r = await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "ingreso",
        fecha: "2026-09-10",
        cuentaId: caja,
        concepto: "Devolución de préstamo",
        importe: "350.00",
        cuentaContrapartida: "1673",
        terceroId: tercero,
      }),
    );
    assert.equal(r.numero, "RI2026-000001");
    assert.equal(s2(await saldoDe(caja)), "350.00");
    assert.equal(await libroCuadra("202609"), "0.00");
  });

  test("un recibo de egreso descuenta", async () => {
    await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "ingreso", fecha: "2026-09-10", cuentaId: caja,
        concepto: "Fondo inicial", importe: "1000.00", cuentaContrapartida: "759",
        aNombreDe: "Gerencia",
      }),
    );
    const r = await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "egreso", fecha: "2026-09-11", cuentaId: caja,
        concepto: "Movilidad del mes", importe: "120.00", cuentaContrapartida: "6311",
        aNombreDe: "Luis Quispe", centroCostoId: centroCosto,
      }),
    );
    assert.equal(r.numero, "RE2026-000001");
    assert.equal(s2(await saldoDe(caja)), "880.00");
  });

  test("guarda el importe en letras, que es lo que impide alterarlo", async () => {
    const r = await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "egreso", fecha: "2026-09-10", cuentaId: caja,
        concepto: "Compra de útiles", importe: "156.50", cuentaContrapartida: "639",
        aNombreDe: "Luis Quispe", centroCostoId: centroCosto,
      }),
    );
    const recibo = await con((db) => cargarRecibo(db, r.reciboId));
    assert.match(recibo.importeEnLetras ?? "", /CIENTO CINCUENTA Y SEIS/i);
    assert.match(recibo.importeEnLetras ?? "", /50\/100/);
  });

  test("exige saber a nombre de quién se emite", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirRecibo(db, empresaId, usuarioId, {
            tipo: "egreso", fecha: "2026-09-10", cuentaId: caja,
            concepto: "Algo", importe: "10", cuentaContrapartida: "639",
          }),
        ),
      /a nombre de quién/,
    );
  });

  test("rechaza importe cero", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirRecibo(db, empresaId, usuarioId, {
            tipo: "ingreso", fecha: "2026-09-10", cuentaId: caja,
            concepto: "Nada", importe: "0", cuentaContrapartida: "759",
            aNombreDe: "X",
          }),
        ),
      /mayor que cero/,
    );
  });

  test("numera por tipo y por año", async () => {
    for (const tipo of ["ingreso", "ingreso", "egreso"] as const) {
      await con((db) =>
        emitirRecibo(db, empresaId, usuarioId, {
          tipo, fecha: "2026-09-10", cuentaId: caja,
          concepto: "Prueba", importe: "10", cuentaContrapartida: tipo === "ingreso" ? "759" : "639",
          aNombreDe: "X", centroCostoId: centroCosto,
        }),
      );
    }
    const lista = await con((db) => listarRecibos(db));
    const numeros = lista.map((l) => l.numero).sort();
    assert.deepEqual(numeros, ["RE2026-000001", "RI2026-000001", "RI2026-000002"]);
  });

  test("el recibo aparece en los movimientos de su cuenta", async () => {
    await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "ingreso", fecha: "2026-09-10", cuentaId: caja,
        concepto: "Cobro de chatarra", importe: "80", cuentaContrapartida: "759",
        aNombreDe: "Reciclajes Lima",
      }),
    );
    const movs = await con((db) => movimientosDe(db, caja));
    assert.equal(movs.length, 1);
    assert.equal(movs[0]!.concepto, "Cobro de chatarra");
  });
});

// ─── Cheques ──────────────────────────────────────────────────────────────

describe("cheques", () => {
  const girar = (extra?: Partial<Parameters<typeof girarCheque>[3]>) =>
    con((db) =>
      girarCheque(db, empresaId, usuarioId, {
        cuentaId: banco,
        numero: "00012345",
        fechaGiro: "2026-09-10",
        beneficiarioId: tercero,
        importe: "2500.00",
        ...extra,
      }),
    );

  test("girar no toca el saldo del banco", async () => {
    await girar();
    // El dinero sigue en el banco hasta que el cheque se cobra: eso es lo que
    // permite que el libro cuadre después contra el extracto.
    assert.equal(s2(await saldoDe(banco)), "0.00");
  });

  test("toma el nombre del beneficiario del maestro", async () => {
    const id = await girar();
    const v = await con((db) => chequeVoucher(db, id));
    assert.equal(v.cheque.beneficiario, "FERRETERIA SA");
    assert.match(v.importeEnLetras, /DOS MIL QUINIENTOS/i);
  });

  test("recorre girado → entregado → cobrado", async () => {
    const id = await girar();
    await con((db) => cambiarEstadoCheque(db, id, "entregado"));
    await con((db) => cambiarEstadoCheque(db, id, "cobrado", { fechaCobrado: "2026-09-18" }));
    const { cheques } = await con((db) => situacionCheques(db, "2026-09-20"));
    assert.equal(cheques[0]!.estado, "cobrado");
    assert.equal(cheques[0]!.fechaCobrado, "2026-09-18");
  });

  test("cobrar exige la fecha en que el banco lo cargó", async () => {
    const id = await girar();
    await assert.rejects(
      () => con((db) => cambiarEstadoCheque(db, id, "cobrado")),
      /fecha en que el banco/,
    );
  });

  test("un cheque cobrado ya no cambia", async () => {
    const id = await girar();
    await con((db) => cambiarEstadoCheque(db, id, "cobrado", { fechaCobrado: "2026-09-18" }));
    await assert.rejects(
      () => con((db) => cambiarEstadoCheque(db, id, "anulado")),
      /un cheque cobrado no pasa a anulado/,
    );
  });

  test("la situación suma lo que sigue en el aire", async () => {
    await girar();
    await girar({ numero: "00012346", importe: "1500.00" });
    const cobrado = await girar({ numero: "00012347", importe: "999.00" });
    await con((db) => cambiarEstadoCheque(db, cobrado, "cobrado", { fechaCobrado: "2026-09-15" }));

    const sit = await con((db) => situacionCheques(db, "2026-09-20"));
    // 2 500 + 1 500: el cobrado ya no compromete nada.
    assert.deepEqual(sit.enCirculacion, [{ moneda: "PEN", importe: "4000.00" }]);
  });

  test("marca el diferido y el añejo", async () => {
    await girar({ numero: "00012350", fechaCobro: "2026-10-15" });
    await girar({ numero: "00012351", fechaGiro: "2026-07-01" });

    const sit = await con((db) => situacionCheques(db, "2026-09-20"));
    const diferido = sit.cheques.find((c) => c.numero === "00012350")!;
    const viejo = sit.cheques.find((c) => c.numero === "00012351")!;
    assert.equal(diferido.diferido, true);
    assert.equal(viejo.aniejo, true);
  });

  test("no repite número dentro de la misma cuenta", async () => {
    await girar();
    await assert.rejects(() => girar(), /cheques_uk|duplicate key/);
  });

  test("rechaza fecha de cobro anterior a la de giro", async () => {
    await assert.rejects(
      () => girar({ numero: "00099999", fechaCobro: "2026-09-01" }),
      /anterior a la de giro/,
    );
  });

  test("el voucher muestra el banco y la cuenta de donde sale", async () => {
    const id = await girar();
    const v = await con((db) => chequeVoucher(db, id));
    assert.equal(v.cheque.banco, "BCP");
    assert.equal(v.cheque.numeroCuenta, "191-1234567-0-11");
    // Sin pago detrás no hay documentos que mostrar, y eso no es un error.
    assert.deepEqual(v.documentos, []);
  });
});

// ─── Entregas a rendir ────────────────────────────────────────────────────

describe("entregas a rendir", () => {
  const entregar = (importe = "500.00") =>
    con((db) =>
      entregarARendir(db, empresaId, usuarioId, {
        fecha: "2026-09-10",
        cuentaId: caja,
        responsable: "Luis Quispe",
        motivo: "Viaje a Trujillo",
        importe,
        centroCostoId: centroCosto,
      }),
    );

  async function conFondo() {
    await con((db) =>
      emitirRecibo(db, empresaId, usuarioId, {
        tipo: "ingreso", fecha: "2026-09-01", cuentaId: caja,
        concepto: "Fondo de caja", importe: "2000.00", cuentaContrapartida: "759",
        aNombreDe: "Gerencia",
      }),
    );
  }

  test("sale de caja como activo, no como gasto", async () => {
    await conFondo();
    const e = await entregar();
    assert.equal(e.numero, "ER2026-000001");
    assert.equal(s2(await saldoDe(caja)), "1500.00");

    // El gasto todavía no existe: el dinero está en la 1412.
    const saldo = await saldoDeCuenta("1412", "202609");
    assert.equal(money.toString(saldo, 2), "500.00");
    assert.equal(await libroCuadra("202609"), "0.00");
  });

  test("rendir con documentos descarga la 1412 y crea el gasto", async () => {
    await conFondo();
    const e = await entregar();
    const r = await con((db) =>
      rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
        fecha: "2026-09-20",
        lineas: [
          { fecha: "2026-09-15", concepto: "Pasajes", cuenta: "6311", importe: "300.00" },
          { fecha: "2026-09-16", concepto: "Hospedaje", cuenta: "6351", importe: "150.00" },
        ],
        devuelve: "50.00",
      }),
    );
    assert.equal(r.rendido, "450.00");
    assert.equal(r.devuelto, "50.00");
    assert.equal(r.saldo, "0.00");

    // El vuelto regresa a la caja.
    assert.equal(s2(await saldoDe(caja)), "1550.00");

    // Y la 1412 queda en cero.
    const saldo = await saldoDeCuenta("1412", "202609");
    assert.equal(money.toString(saldo, 2), "0.00");
    assert.equal(await libroCuadra("202609"), "0.00");

    const { cabecera, items } = await con((db) => cargarEntrega(db, e.entregaId));
    assert.equal(cabecera.estado, "rendida");
    assert.equal(items.length, 2);
  });

  test("una rendición parcial deja el saldo a la vista", async () => {
    await conFondo();
    const e = await entregar();
    const r = await con((db) =>
      rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
        fecha: "2026-09-20",
        lineas: [{ fecha: "2026-09-15", concepto: "Pasajes", cuenta: "6311", importe: "200.00" }],
      }),
    );
    assert.equal(r.saldo, "300.00");
    const { cabecera, saldo } = await con((db) => cargarEntrega(db, e.entregaId));
    assert.equal(cabecera.estado, "parcial");
    assert.equal(saldo, "300.00");

    // Y se puede seguir rindiendo después.
    const segunda = await con((db) =>
      rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
        fecha: "2026-09-25",
        lineas: [{ fecha: "2026-09-22", concepto: "Taxi", cuenta: "6311", importe: "300.00" }],
      }),
    );
    assert.equal(segunda.saldo, "0.00");
  });

  test("no deja rendir más de lo entregado", async () => {
    await conFondo();
    const e = await entregar();
    await assert.rejects(
      () =>
        con((db) =>
          rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
            fecha: "2026-09-20",
            lineas: [{ fecha: "2026-09-15", concepto: "Pasajes", cuenta: "6311", importe: "900.00" }],
          }),
        ),
      /sólo quedan 500\.00 por rendir/,
    );
  });

  test("una entrega rendida no se rinde otra vez", async () => {
    await conFondo();
    const e = await entregar();
    await con((db) =>
      rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
        fecha: "2026-09-20",
        lineas: [{ fecha: "2026-09-15", concepto: "Todo", cuenta: "6311", importe: "500.00" }],
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
            fecha: "2026-09-21",
            lineas: [{ fecha: "2026-09-21", concepto: "Más", cuenta: "6311", importe: "1.00" }],
          }),
        ),
      /ya está rendida/,
    );
  });

  test("se anula mientras nadie rindió nada", async () => {
    await conFondo();
    const e = await entregar();
    await con((db) => anularEntrega(db, e.entregaId));
    const [fila] = await con((db) => listarEntregas(db, "anulada"));
    assert.equal(fila!.numero, e.numero);
  });

  test("con rendiciones hechas, anular manda a extornar", async () => {
    await conFondo();
    const e = await entregar();
    await con((db) =>
      rendirEntrega(db, empresaId, usuarioId, e.entregaId, {
        fecha: "2026-09-20",
        lineas: [{ fecha: "2026-09-15", concepto: "Pasajes", cuenta: "6311", importe: "100.00" }],
      }),
    );
    await assert.rejects(() => con((db) => anularEntrega(db, e.entregaId)), /extorne el asiento/);
  });

  test("exige responsable y motivo", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          entregarARendir(db, empresaId, usuarioId, {
            fecha: "2026-09-10", cuentaId: caja, responsable: "", motivo: "", importe: "100",
          }),
        ),
      CajaInvalida,
    );
  });
});
