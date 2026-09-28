/**
 * Caja y bancos, contra Postgres real.
 *
 * El centro de las pruebas es la conciliación: que las parejas se propongan por
 * orden de confianza, que nada se concilie solo, y que la diferencia entre el
 * saldo del banco y el del libro quede explicada por lo que está en tránsito y
 * lo que el banco cobró sin avisar.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearCuenta, cuentasConSaldo, registrarMovimientoEfectivo,
  movimientosDe, libroBancos, importarExtracto, proponerConciliacion, confirmarConciliacion,
  estadoConciliacion, registrarArqueo, listarArqueos,
  registrarCompra, emitirVenta, registrarCobranza, registrarPago,
  documentosPorPagar,
  balanceComprobacion, TesoreriaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let banco = "";
let cajaChica = "";
let cliente = "";
let proveedor = "";
let producto = "";
let almacenId = "";

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

  banco = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "BCP-SOL",
      nombre: "BCP cuenta corriente soles",
      tipo: "banco",
      moneda: "PEN",
      cuentaContable: "1041",
      banco: "BCP",
      numeroCuenta: "193-1234567-0-88",
    }),
  );

  cajaChica = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "CCH-01",
      nombre: "Caja chica administración",
      tipo: "caja_chica",
      moneda: "PEN",
      cuentaContable: "1012",
      fondoFijo: "1000",
    }),
  );

  // Un cliente, un proveedor y algo que vender: lo mínimo para comprobar que
  // una cobranza y un pago llegan a la tesorería.
  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR S.A.C.', true) RETURNING id`;
  cliente = c!.id;

  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
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
});

/** Una compra al crédito, que deja un documento por pagar. */
async function compraAlCredito() {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero: String(Date.now()).slice(-7),
      fechaEmision: "2026-09-02",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [
        { productoId: producto, descripcion: "Bomba", cantidad: "10", valorUnitario: "300" },
      ],
    }),
  );
  const docs = await con((db) => documentosPorPagar(db, proveedor));
  return docs.at(-1)!;
}

/** Una venta al crédito, que deja un comprobante por cobrar. */
async function ventaAlCredito() {
  await compraAlCredito();
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-10",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "5", valorUnitario: "500" }],
    }),
  );
  return { comprobanteId: r.comprobanteId, total: r.total };
}

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

const movimiento = (over: Partial<Parameters<typeof registrarMovimientoEfectivo>[3]> = {}) => ({
  cuentaId: banco,
  fecha: "2026-09-05",
  sentido: "egreso" as const,
  concepto: "Comisión de mantenimiento",
  importe: "15.00",
  cuentaContrapartida: "6373",
  ...over,
});

// ─── Cuentas ──────────────────────────────────────────────────────────────

describe("cuentas de efectivo", () => {
  test("se listan con su saldo derivado de los movimientos", async () => {
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento({ sentido: "ingreso", importe: "5000.00" })),
    );
    await con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento()));

    const cuentas = await con((db) => cuentasConSaldo(db));
    const bcp = cuentas.find((c) => c.codigo === "BCP-SOL")!;
    assert.equal(s2(bcp.saldo), "4985.00", "5000 de ingreso menos 15 de comisión");
    assert.equal(bcp.sin_conciliar, 2);
  });

  test("una cuenta bancaria sin número se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearCuenta(db, empresaId, usuarioId, {
            codigo: "X", nombre: "X", tipo: "banco", moneda: "PEN", cuentaContable: "1041",
          }),
        ),
      /necesita su número/,
    );
  });

  test("el fondo fijo sólo aplica a una caja chica", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearCuenta(db, empresaId, usuarioId, {
            codigo: "X", nombre: "X", tipo: "banco", moneda: "PEN",
            cuentaContable: "1041", numeroCuenta: "1", fondoFijo: "500",
          }),
        ),
      /sólo aplica a una caja chica/,
    );
  });
});

// ─── Movimientos ──────────────────────────────────────────────────────────

describe("movimientos", () => {
  test("un egreso contabiliza contra su contrapartida y cuadra", async () => {
    await con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento()));

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "1041")!.saldo), "-15.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "6373")!.saldo), "15.00");
  });

  test("un ingreso invierte los lados", async () => {
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, {
        ...movimiento(),
        sentido: "ingreso",
        concepto: "Intereses ganados",
        importe: "80.00",
        cuentaContrapartida: "759",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(balance.find((b) => b.cuenta === "1041")!.saldo), "80.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "759")!.saldo), "-80.00");
  });

  test("un importe cero o negativo se rechaza", async () => {
    for (const importe of ["0", "-10"]) {
      await assert.rejects(
        () => con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento({ importe }))),
        /mayor que cero/,
      );
    }
  });

  test("una cuenta inactiva no recibe movimientos", async () => {
    await raw`UPDATE cuentas_efectivo SET activa = false WHERE id = ${banco}`;
    await assert.rejects(
      () => con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento())),
      /está inactiva/,
    );
  });

  test("los movimientos se listan por cuenta y fecha", async () => {
    await con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento()));
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento({ cuentaId: cajaChica })),
    );
    assert.equal((await con((db) => movimientosDe(db, banco))).length, 1);
    assert.equal((await con((db) => movimientosDe(db, cajaChica))).length, 1);
  });
});

// ─── Libro de bancos ──────────────────────────────────────────────────────

describe("libro de bancos", () => {
  test("arrastra el saldo anterior y cierra con el del periodo", async () => {
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, {
        ...movimiento(), fecha: "2026-08-20", sentido: "ingreso",
        concepto: "Aporte", importe: "1000.00", cuentaContrapartida: "5011",
      }),
    );
    await con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento()));

    const l = (await con((db) =>
      libroBancos(db, banco, { desde: "2026-09-01", hasta: "2026-09-30" }),
    ))!;

    assert.equal(l.saldoInicial, "1000.00", "el aporte de agosto no es movimiento de septiembre");
    assert.equal(l.egresos, "15.00");
    assert.equal(l.ingresos, "0.00");
    assert.equal(l.saldoFinal, "985.00");
    assert.equal(l.lineas.length, 1);
  });

  /**
   * La razón de ser del cuadro: el libro sale de los movimientos y el mayor de
   * los asientos. Sólo coinciden si todos los módulos anotan las dos cosas.
   */
  test("cuadra contra la cuenta contable", async () => {
    await con((db) => registrarMovimientoEfectivo(db, empresaId, usuarioId, movimiento()));
    const l = (await con((db) =>
      libroBancos(db, banco, { desde: "2026-09-01", hasta: "2026-09-30" }),
    ))!;
    assert.equal(l.saldoContable, l.saldoFinal);
    assert.equal(l.cuadra, true);
    assert.ok(!l.avisos.some((a) => /difieren/.test(a)), l.avisos.join(" | "));
  });

  test("denuncia un movimiento que no llegó a la contabilidad", async () => {
    // Un movimiento anotado a mano, sin su asiento: es lo que pasaría si un
    // módulo apuntara el movimiento y se olvidara de contabilizarlo. El asiento
    // contabilizado no se puede borrar —eso está bien—, así que la divergencia
    // se provoca por el otro lado.
    await raw`
      INSERT INTO movimientos_efectivo
        (empresa_id, cuenta_id, fecha, sentido, concepto, importe, moneda)
      VALUES (${empresaId}, ${banco}, '2026-09-05', 'egreso', 'Comisión sin asiento', '15.00', 'PEN')`;

    const l = (await con((db) =>
      libroBancos(db, banco, { desde: "2026-09-01", hasta: "2026-09-30" }),
    ))!;
    assert.equal(l.cuadra, false);
    assert.equal(l.diferencia, "-15.00");
    assert.ok(l.avisos.some((a) => /difieren/.test(a)), l.avisos.join(" | "));
  });

  /**
   * Dos cuentas corrientes en la 1041 es lo normal. Comparar una sola contra el
   * total daría una diferencia falsa, así que se dice y no se afirma nada.
   */
  test("con la cuenta contable compartida avisa en vez de inventar una diferencia", async () => {
    await con((db) =>
      crearCuenta(db, empresaId, usuarioId, {
        codigo: "BCO-002",
        nombre: "Segunda cuenta corriente",
        tipo: "banco",
        moneda: "PEN",
        cuentaContable: "1041",
        banco: "BCP",
        numeroCuenta: "0011-0234-0100056789",
      }),
    );
    const l = (await con((db) =>
      libroBancos(db, banco, { desde: "2026-09-01", hasta: "2026-09-30" }),
    ))!;
    assert.ok(l.avisos.some((a) => /la comparten 2 cuentas/.test(a)), l.avisos.join(" | "));
    assert.equal(l.cuadra, true, "no se puede afirmar que no cuadre");
  });

  test("una cuenta que no existe devuelve nulo en vez de un libro vacío", async () => {
    const l = await con((db) =>
      libroBancos(db, "00000000-0000-0000-0000-000000000000", {
        desde: "2026-09-01", hasta: "2026-09-30",
      }),
    );
    assert.equal(l, null);
  });
});

// ─── Conciliación bancaria ────────────────────────────────────────────────

describe("conciliación bancaria", () => {
  /** Un movimiento propio con referencia, para poder aparearlo. */
  async function movConRef(fecha: string, importe: string, referencia: string, sentido: "ingreso" | "egreso" = "egreso") {
    const r = await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, {
        ...movimiento(),
        fecha,
        importe,
        referencia,
        sentido,
        concepto: `Operación ${referencia}`,
      }),
    );
    return r.movimientoId;
  }

  test("la referencia es el criterio de más confianza", async () => {
    await movConRef("2026-09-05", "500.00", "OP-9001");
    // El banco lo informa con otra fecha, pero con la misma referencia.
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-08", descripcion: "TRANSFERENCIA", importe: "-500.00", referencia: "OP-9001" },
      ]),
    );

    const propuestas = await con((db) => proponerConciliacion(db, banco));
    assert.equal(propuestas.length, 1);
    assert.equal(propuestas[0]!.motivo, "referencia");
  });

  test("sin referencia, casa por fecha e importe exactos", async () => {
    await movConRef("2026-09-05", "500.00", "");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-05", descripcion: "CARGO", importe: "-500.00" },
      ]),
    );
    const propuestas = await con((db) => proponerConciliacion(db, banco));
    assert.equal(propuestas[0]!.motivo, "exacta");
  });

  test("un cheque cobrado días después se propone como aproximado", async () => {
    // Es el caso más común: el cheque se emite un día y lo cobran al siguiente.
    await movConRef("2026-09-05", "1200.00", "");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-07", descripcion: "CHEQUE 001234", importe: "-1200.00" },
      ]),
    );
    const propuestas = await con((db) => proponerConciliacion(db, banco));
    assert.equal(propuestas.length, 1);
    assert.equal(propuestas[0]!.motivo, "aproximada");
  });

  test("más de tres días de diferencia ya no se propone", async () => {
    await movConRef("2026-09-05", "1200.00", "");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-20", descripcion: "CHEQUE", importe: "-1200.00" },
      ]),
    );
    assert.deepEqual(await con((db) => proponerConciliacion(db, banco)), []);
  });

  test("el signo importa: un ingreso no casa con un cargo", async () => {
    await movConRef("2026-09-05", "500.00", "", "ingreso");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-05", descripcion: "CARGO", importe: "-500.00" },
      ]),
    );
    assert.deepEqual(await con((db) => proponerConciliacion(db, banco)), []);
  });

  test("un movimiento no se propone para dos líneas del extracto", async () => {
    await movConRef("2026-09-05", "500.00", "");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-05", descripcion: "CARGO A", importe: "-500.00" },
        { fecha: "2026-09-05", descripcion: "CARGO B", importe: "-500.00" },
      ]),
    );
    const propuestas = await con((db) => proponerConciliacion(db, banco));
    assert.equal(propuestas.length, 1, "sólo hay un movimiento propio que aparear");
  });

  test("proponer no concilia: hace falta confirmarlo", async () => {
    const mov = await movConRef("2026-09-05", "500.00", "OP-1");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-05", descripcion: "X", importe: "-500.00", referencia: "OP-1" },
      ]),
    );
    await con((db) => proponerConciliacion(db, banco));

    const [antes] = await raw<{ conciliado_en: string | null }[]>`
      SELECT conciliado_en FROM movimientos_efectivo WHERE id = ${mov}`;
    assert.equal(antes!.conciliado_en, null, "aparear automático escondería los errores");
  });

  test("confirmar marca ambos lados y deja de proponerlos", async () => {
    await movConRef("2026-09-05", "500.00", "OP-1");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-05", descripcion: "X", importe: "-500.00", referencia: "OP-1" },
      ]),
    );
    const propuestas = await con((db) => proponerConciliacion(db, banco));
    const r = await con((db) => confirmarConciliacion(db, propuestas, "2026-09-30"));
    assert.equal(r.conciliados, 1);

    assert.deepEqual(
      await con((db) => proponerConciliacion(db, banco)),
      [],
      "lo conciliado ya no se propone",
    );
  });

  test("el estado explica la diferencia entre el banco y el libro", async () => {
    // Un cheque girado que el banco aún no cobró, y una comisión que el banco
    // cargó y nadie registró: entre los dos explican toda la diferencia.
    await movConRef("2026-09-28", "800.00", "CHQ-77");
    await con((db) =>
      importarExtracto(db, empresaId, usuarioId, banco, [
        { fecha: "2026-09-30", descripcion: "PORTES", importe: "-12.00", saldo: "-12.00" },
      ]),
    );

    const estado = await con((db) => estadoConciliacion(db, banco));
    assert.equal(money.toString(estado.saldoLibro, 2), "-800.00");
    assert.equal(money.toString(estado.saldoBanco, 2), "-12.00");
    assert.equal(estado.enTransito.length, 1, "el cheque sin cobrar");
    assert.equal(estado.noRegistrados.length, 1, "los portes que nadie registró");

    // La diferencia tiene que quedar explicada por esas dos partidas.
    const explicada = money.sub(
      estado.enTransito.reduce(
        (a, m) => money.add(a, m.sentido === "ingreso" ? money.dec(m.importe) : money.neg(money.dec(m.importe))),
        money.ZERO,
      ),
      estado.noRegistrados.reduce((a, l) => money.add(a, money.dec(l.importe)), money.ZERO),
    );
    assert.equal(
      money.toString(money.neg(explicada), 2),
      money.toString(estado.diferencia, 2),
      "lo que sobre después de esto sería un error real",
    );
  });

  test("un extracto vacío se rechaza", async () => {
    await assert.rejects(
      () => con((db) => importarExtracto(db, empresaId, usuarioId, banco, [])),
      TesoreriaInvalida,
    );
  });
});

// ─── Arqueo ───────────────────────────────────────────────────────────────

describe("arqueo de caja", () => {
  async function cargarCaja(importe: string) {
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, {
        cuentaId: cajaChica,
        fecha: "2026-09-01",
        sentido: "ingreso",
        concepto: "Apertura del fondo fijo",
        importe,
        cuentaContrapartida: "1041",
      }),
    );
  }

  test("sin diferencia no genera asiento", async () => {
    await cargarCaja("1000.00");
    const r = await con((db) =>
      registrarArqueo(db, empresaId, usuarioId, {
        cuentaId: cajaChica, fecha: "2026-09-30", saldoContado: "1000.00",
      }),
    );
    assert.equal(r.saldoLibro, "1000.00");
    assert.equal(r.diferencia, "0.00");
    assert.equal(r.asientoId, null);
  });

  test("un faltante se contabiliza como pérdida y ajusta el libro", async () => {
    await cargarCaja("1000.00");
    const r = await con((db) =>
      registrarArqueo(db, empresaId, usuarioId, {
        cuentaId: cajaChica, fecha: "2026-09-30", saldoContado: "970.00",
        observaciones: "Faltan 30 soles",
      }),
    );
    assert.equal(r.diferencia, "-30.00");
    assert.ok(r.asientoId);

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(balance.find((b) => b.cuenta === "6592")!.saldo), "30.00", "faltante a pérdida");

    // El libro auxiliar también se ajusta; si no, el próximo arqueo encontraría
    // la misma diferencia otra vez.
    const cuentas = await con((db) => cuentasConSaldo(db));
    assert.equal(s2(cuentas.find((c) => c.codigo === "CCH-01")!.saldo), "970.00");
  });

  test("un sobrante se contabiliza como ingreso", async () => {
    await cargarCaja("1000.00");
    const r = await con((db) =>
      registrarArqueo(db, empresaId, usuarioId, {
        cuentaId: cajaChica, fecha: "2026-09-30", saldoContado: "1025.00",
      }),
    );
    assert.equal(r.diferencia, "25.00");
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(balance.find((b) => b.cuenta === "759")!.saldo), "-25.00");
  });

  test("el asiento del ajuste cuadra", async () => {
    await cargarCaja("1000.00");
    await con((db) =>
      registrarArqueo(db, empresaId, usuarioId, {
        cuentaId: cajaChica, fecha: "2026-09-30", saldoContado: "970.00",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
  });

  test("los arqueos quedan registrados aunque no haya diferencia", async () => {
    await cargarCaja("1000.00");
    await con((db) =>
      registrarArqueo(db, empresaId, usuarioId, {
        cuentaId: cajaChica, fecha: "2026-09-30", saldoContado: "1000.00",
      }),
    );
    const lista = await con((db) => listarArqueos(db));
    assert.equal(lista.length, 1, "un arqueo sin rastro no sirve como control");
    assert.equal(s2(lista[0]!.diferencia), "0.00");
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("las cuentas de una empresa no se ven desde otra", async () => {
    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => cuentasConSaldo(db),
    );
    assert.deepEqual(desdeOtra, []);
  });
});

// ─── Tesorería y contabilidad cuentan lo mismo ────────────────────────────

describe("cobranzas y pagos llegan a la tesorería", () => {
  /**
   * El fallo que motivó estas pruebas: la contabilidad decía que el banco se
   * había movido y la pantalla de Caja y Bancos seguía marcando cero. Con dos
   * verdades sobre el mismo dinero la conciliación bancaria no sirve de nada.
   */
  async function cuentaBanco() {
    return con((db) =>
      crearCuenta(db, empresaId, usuarioId, {
        codigo: `BCO-${Date.now().toString().slice(-5)}`,
        nombre: "Banco de pruebas",
        tipo: "banco",
        moneda: "PEN",
        cuentaContable: "1041",
        banco: "BBVA",
        numeroCuenta: `0011-${Date.now().toString().slice(-10)}`,
      }),
    );
  }

  test("una cobranza con cuenta de efectivo mueve el saldo del banco", async () => {
    const cuentaId = await cuentaBanco();
    const { comprobanteId, total } = await ventaAlCredito();

    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: `CB-${Date.now().toString().slice(-6)}`,
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "transferencia",
        cuentaDestino: "1041",
        cuentaEfectivoId: cuentaId,
        aplicaciones: [{ comprobanteId, importe: total }],
      }),
    );

    const cuentas = await con((db) => cuentasConSaldo(db));
    const banco = cuentas.find((c) => c.id === cuentaId)!;
    assert.equal(
      money.toString(money.dec(banco.saldo), 2),
      money.toString(money.dec(total), 2),
      "el tesorero tiene que ver el ingreso que la contabilidad ya registró",
    );
  });

  test("un pago sale del banco por el neto, no por el bruto", async () => {
    const cuentaId = await cuentaBanco();
    const doc = await compraAlCredito();

    const pago = await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        numero: `PG-${Date.now().toString().slice(-6)}`,
        proveedorId: proveedor,
        fecha: "2026-09-21",
        moneda: "PEN",
        tipoCambio: "1",
        medioPago: "transferencia",
        cuentaOrigen: "1041",
        cuentaEfectivoId: cuentaId,
        aplicaciones: [{ documentoId: doc.id, importe: doc.saldo }],
      }),
    );

    const cuentas = await con((db) => cuentasConSaldo(db));
    const banco = cuentas.find((c) => c.id === cuentaId)!;
    // La retención no cruza la cuenta del banco: se entrega al fisco aparte.
    assert.equal(
      money.toString(money.dec(banco.saldo), 2),
      `-${money.toString(money.dec(pago.importeNeto), 2)}`,
    );
  });

  test("sin cuenta de efectivo la operación se registra igual", async () => {
    // Es el estado de una empresa que todavía no dio de alta sus cuentas: la
    // contabilidad no puede quedarse esperando a que configure la tesorería.
    const { comprobanteId, total } = await ventaAlCredito();
    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: `CB-SIN-${Date.now().toString().slice(-6)}`,
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "efectivo",
        cuentaDestino: "1011",
        aplicaciones: [{ comprobanteId, importe: total }],
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const suma = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(suma, 2), "0.00");
  });

  test("el movimiento anotado queda ligado a su origen y a su asiento", async () => {
    const cuentaId = await cuentaBanco();
    const { comprobanteId, total } = await ventaAlCredito();
    const cob = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: `CB-LIG-${Date.now().toString().slice(-6)}`,
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "transferencia",
        cuentaDestino: "1041",
        cuentaEfectivoId: cuentaId,
        aplicaciones: [{ comprobanteId, importe: total }],
      }),
    );

    const movs = await con((db) => movimientosDe(db, cuentaId));
    const mov = movs.find((m) => m.origenId === cob.cobranzaId)!;
    assert.ok(mov, "el movimiento debe poder rastrearse hasta la cobranza");
    assert.equal(mov.origenModulo, "cobranzas");
    assert.equal(mov.asientoId, cob.asientoId, "y hasta el asiento que lo contabilizó");
  });

  test("el asiento no se duplica: la cobranza contabiliza una sola vez", async () => {
    const cuentaId = await cuentaBanco();
    const { comprobanteId, total } = await ventaAlCredito();
    const antes = (await con((db) => balanceComprobacion(db, "202609"))).length;
    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: `CB-DUP-${Date.now().toString().slice(-6)}`,
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "transferencia",
        cuentaDestino: "1041",
        cuentaEfectivoId: cuentaId,
        aplicaciones: [{ comprobanteId, importe: total }],
      }),
    );
    void antes;
    const [fila] = (await raw`
      SELECT count(*)::int AS n FROM asientos
      WHERE empresa_id = ${empresaId} AND origen_modulo = 'tesoreria'`) as [{ n: number }];
    assert.equal(fila.n, 0, "la cobranza no debe generar además un asiento de tesorería");
  });
});
