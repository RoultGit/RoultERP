/**
 * Captura manual, estados financieros y cierre de periodo.
 *
 * Lo que se comprueba: que un borrador no contamine el balance, que los estados
 * financieros salgan de los mismos asientos que el balance de comprobación, y
 * que un periodo no se pueda cerrar sobre un descuadre —cerrarlo lo haría
 * permanente.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta,
  asentar, guardarBorrador, contabilizarBorrador, eliminarBorrador, cargarAsiento, listarAsientos,
  balanceComprobacion, situacionFinanciera, estadoResultados,
  cerrarPeriodo, reabrirPeriodo, listarPeriodos,
  ajustarDiferenciaCambio, cerrarEjercicio,
  ContabilizacionInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let proveedor = "";
let cliente = "";
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

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = p!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA SAC', true) RETURNING id`;
  cliente = c!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = pr!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

const borradorBase = () => ({
  periodo: "202609",
  fecha: "2026-09-15",
  subdiario: "00",
  glosa: "Provisión de servicios de auditoría",
  moneda: "PEN",
  tipoCambio: "1",
  lineas: [
    { cuenta: "6431", glosa: "Auditoría", debe: "3000.00" },
    { cuenta: "4699", glosa: "Por pagar", haber: "3000.00", anexoId: proveedor },
  ],
});

// ─── Captura manual ───────────────────────────────────────────────────────

describe("captura manual de asientos", () => {
  test("un borrador se guarda y no entra al balance", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    assert.deepEqual(r.motivos, [], "el asiento de ejemplo es válido");

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.deepEqual(balance, [], "un borrador no es contabilidad");
  });

  test("contabilizarlo lo hace aparecer en el balance", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, r.asientoId));

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(balance.find((b) => b.cuenta === "6431")!.saldo), "3000.00");
    assert.equal(s2(balance.find((b) => b.cuenta === "4699")!.saldo), "-3000.00");
  });

  test("un borrador descuadrado se guarda igual, pero dice por qué no cuadra", async () => {
    // Es la razón de que exista el borrador: el contador escribe veinte líneas
    // y las cuadra sobre la marcha.
    const r = await con((db) =>
      guardarBorrador(db, empresaId, usuarioId, {
        ...borradorBase(),
        lineas: [
          { cuenta: "6431", debe: "3000.00" },
          { cuenta: "4699", haber: "2500.00", anexoId: proveedor },
        ],
      }),
    );
    assert.ok(r.asientoId, "se guardó");
    assert.ok(r.motivos.some((m) => /no cuadra/.test(m)));
  });

  test("no se contabiliza un borrador que no cuadra", async () => {
    const r = await con((db) =>
      guardarBorrador(db, empresaId, usuarioId, {
        ...borradorBase(),
        lineas: [
          { cuenta: "6431", debe: "3000.00" },
          { cuenta: "4699", haber: "2500.00", anexoId: proveedor },
        ],
      }),
    );
    await assert.rejects(
      () => con((db) => contabilizarBorrador(db, r.asientoId)),
      ContabilizacionInvalida,
    );
  });

  test("una cuenta que exige tercero lo exige también en la captura manual", async () => {
    const r = await con((db) =>
      guardarBorrador(db, empresaId, usuarioId, {
        ...borradorBase(),
        lineas: [
          { cuenta: "6431", debe: "3000.00" },
          { cuenta: "4699", haber: "3000.00" },
        ],
      }),
    );
    assert.ok(r.motivos.some((m) => /exige imputar un tercero/.test(m)));
  });

  test("editar un borrador reemplaza sus líneas", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) =>
      guardarBorrador(
        db, empresaId, usuarioId,
        {
          ...borradorBase(),
          glosa: "Corregido",
          lineas: [
            { cuenta: "6431", debe: "1500.00" },
            { cuenta: "4699", haber: "1500.00", anexoId: proveedor },
          ],
        },
        r.asientoId,
      ),
    );
    const { cabecera, lineas } = await con((db) => cargarAsiento(db, r.asientoId));
    assert.equal(cabecera.glosa, "Corregido");
    assert.equal(lineas.length, 2);
    assert.equal(s2(lineas[0]!.debe), "1500.00");
  });

  test("un asiento contabilizado ya no se edita", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, r.asientoId));
    await assert.rejects(
      () => con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase(), r.asientoId)),
      /ya no se edita; use un extorno/,
    );
  });

  test("un borrador se borra; lo contabilizado no", async () => {
    const a = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => eliminarBorrador(db, a.asientoId));
    assert.equal((await con((db) => listarAsientos(db, "202609"))).length, 0);

    const b = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, b.asientoId));
    await assert.rejects(
      () => con((db) => eliminarBorrador(db, b.asientoId)),
      /lo contabilizado se extorna, no se borra/,
    );
  });

  test("el trigger de la base también protege las líneas contabilizadas", async () => {
    // La regla no vive sólo en el servicio: un DELETE directo sobre las líneas
    // de un asiento contabilizado tiene que fallar igual.
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, r.asientoId));
    await assert.rejects(
      () => raw`DELETE FROM asiento_lineas WHERE asiento_id = ${r.asientoId}`,
      /sus líneas no se borran/,
    );
  });

  test("no se contabiliza dos veces", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, r.asientoId));
    await assert.rejects(
      () => con((db) => contabilizarBorrador(db, r.asientoId)),
      /ya está contabilizado/,
    );
  });

  test("la lista distingue borradores de asientos contabilizados", async () => {
    const a = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, a.asientoId));

    const lista = await con((db) => listarAsientos(db, "202609"));
    assert.equal(lista.length, 2);
    assert.equal(lista.filter((x) => x.estado === "borrador").length, 1);
    assert.equal(s2(lista.find((x) => x.estado === "contabilizado")!.importe), "3000.00");
  });
});

// ─── Estados financieros ──────────────────────────────────────────────────

describe("estados financieros", () => {
  /** Una operación completa: compra, venta y su costo. */
  async function operar() {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0000001",
        fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "100", valorUnitario: "300" }],
      }),
    );
    await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-15", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, cantidad: "40", valorUnitario: "500" }],
      }),
    );
  }

  test("el balance del estado de situación cuadra", async () => {
    await operar();
    const sf = await con((db) => situacionFinanciera(db, "202609"));
    assert.equal(sf.cuadra, true, `descuadre de ${money.toString(sf.descuadre, 2)}`);
  });

  test("las existencias reflejan lo que queda en el almacén", async () => {
    await operar();
    const sf = await con((db) => situacionFinanciera(db, "202609"));
    const existencias = sf.activo.find((l) => l.concepto === "Existencias")!;
    // 100 compradas a 300, 40 vendidas: quedan 60 × 300
    assert.equal(money.toString(existencias.importe, 2), "18000.00");
  });

  test("el resultado del ejercicio es el mismo en ambos estados", async () => {
    // Si no coincidieran, uno de los dos estaría leyendo asientos distintos.
    await operar();
    const sf = await con((db) => situacionFinanciera(db, "202609"));
    const er = await con((db) => estadoResultados(db, "202609"));

    const enBalance = sf.pasivoPatrimonio.find((l) => l.concepto === "Resultado del ejercicio")!;
    assert.equal(
      money.toString(enBalance.importe, 2),
      money.toString(er.resultado, 2),
    );
  });

  test("el estado de resultados muestra el margen real", async () => {
    await operar();
    const er = await con((db) => estadoResultados(db, "202609"));
    const ventas = er.lineas.find((l) => l.concepto === "Ventas netas")!;
    const bruta = er.lineas.find((l) => l.concepto === "Utilidad bruta")!;

    assert.equal(money.toString(ventas.importe, 2), "20000.00", "40 × 500");
    // 20 000 de venta menos 12 000 de costo (40 × 300)
    assert.equal(money.toString(bruta.importe, 2), "8000.00");
  });

  test("un periodo sin movimientos da estados en cero que igualmente cuadran", async () => {
    const sf = await con((db) => situacionFinanciera(db, "202601"));
    assert.equal(sf.cuadra, true);
    const er = await con((db) => estadoResultados(db, "202601"));
    assert.equal(money.toString(er.resultado, 2), "0.00");
  });

  test("los estados acumulan desde el inicio, no sólo el mes", async () => {
    // El balance es una foto acumulada; el resultado, del ejercicio.
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0000001",
        fechaEmision: "2026-07-01", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "50", valorUnitario: "300" }],
      }),
    );
    const sf = await con((db) => situacionFinanciera(db, "202609"));
    const existencias = sf.activo.find((l) => l.concepto === "Existencias")!;
    assert.equal(money.toString(existencias.importe, 2), "15000.00", "la compra de julio cuenta");
  });
});

// ─── Cierre de periodo ────────────────────────────────────────────────────

describe("cierre de periodo", () => {
  test("cerrar impide contabilizar en ese periodo", async () => {
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await con((db) => contabilizarBorrador(db, r.asientoId));
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609"));

    await assert.rejects(
      () => con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase())),
      /está cerrado y no admite asientos nuevos/,
    );
  });

  test("no se cierra si quedan borradores sin resolver", async () => {
    await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await assert.rejects(
      () => con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609")),
      /queda 1 asiento en borrador/,
    );
  });

  test("no se cierra sobre un descuadre", async () => {
    // Cerrar un periodo descuadrado lo hace permanente: después ya no se puede
    // corregir sin reabrirlo.
    await raw`
      INSERT INTO asientos (empresa_id, periodo, numero, fecha, subdiario, glosa, moneda, estado)
      VALUES (${empresaId}, '202609', '999999', '2026-09-01', '00', 'Roto', 'PEN', 'contabilizado')`;
    const [a] = await raw<{ id: string }[]>`SELECT id FROM asientos WHERE numero = '999999'`;
    await raw`
      INSERT INTO asiento_lineas (empresa_id, asiento_id, linea, cuenta, debe, haber,
                                  debe_funcional, haber_funcional)
      VALUES (${empresaId}, ${a!.id}, 1, '1011', '500', '0', '500', '0')`;

    await assert.rejects(
      () => con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609")),
      /no cuadra por 500.00; cerrar lo haría permanente/,
    );
  });

  test("un periodo cerrado se puede reabrir", async () => {
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609"));
    await con((db) => reabrirPeriodo(db, empresaId, usuarioId, "202609"));
    const r = await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    assert.ok(r.asientoId, "vuelve a admitir asientos");
  });

  test("los periodos se listan con su estado", async () => {
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202608"));
    const lista = await con((db) => listarPeriodos(db));
    assert.equal(lista.find((p) => p.periodo === "202608")!.estado, "cerrado");
  });

  test("un periodo vacío se cierra sin problema", async () => {
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202601"));
    const lista = await con((db) => listarPeriodos(db));
    assert.equal(lista.find((p) => p.periodo === "202601")!.estado, "cerrado");
  });
});

// ─── Cierre de ejercicio ──────────────────────────────────────────────────

/** Compra en dólares: deja un saldo en 4212 que revaluar. */
async function compraEnDolares(tipoCambio: string, importe: string) {
  return con((db) =>
    guardarBorrador(db, empresaId, usuarioId, {
      periodo: "202609",
      fecha: "2026-09-10",
      subdiario: "08",
      glosa: "Factura del exterior",
      moneda: "USD",
      tipoCambio,
      lineas: [
        { cuenta: "6011", debe: importe },
        { cuenta: "4212", haber: importe, anexoId: proveedor },
      ],
    }).then(async (r) => {
      await contabilizarBorrador(db, r.asientoId);
      return r.asientoId;
    }),
  );
}

describe("ajuste por diferencia de cambio", () => {
  test("una deuda en dólares se revalúa al tipo de cambio de cierre", async () => {
    await compraEnDolares("3.700", "1000.00");

    const { ajustes } = await con((db) =>
      ajustarDiferenciaCambio(db, empresaId, usuarioId, {
        periodo: "202609",
        fecha: "2026-09-30",
        tipoCambio: "3.800",
      }),
    );

    const deuda = ajustes.find((a) => a.cuenta === "4212");
    // −1000 USD a 3.80 son −3800 soles; había −3700. Faltan 100 de pérdida.
    assert.equal(money.toString(deuda!.saldoMe, 2), "-1000.00");
    assert.equal(money.toString(deuda!.saldoFuncional, 2), "-3700.00");
    assert.equal(money.toString(deuda!.ajuste, 2), "-100.00");
  });

  test("el ajuste deja el balance cuadrado y va contra la 676", async () => {
    await compraEnDolares("3.700", "1000.00");
    await con((db) =>
      ajustarDiferenciaCambio(db, empresaId, usuarioId, {
        periodo: "202609", fecha: "2026-09-30", tipoCambio: "3.800",
      }),
    );

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(s2(money.toString(total)), "0.00", "el asiento de ajuste cuadra");

    const perdida = balance.find((b) => b.cuenta === "676");
    assert.equal(s2(perdida!.saldo), "100.00");
  });

  test("no ajusta las existencias: su costo en soles quedó fijado al comprarlas", async () => {
    await compraEnDolares("3.700", "1000.00");
    const { ajustes } = await con((db) =>
      ajustarDiferenciaCambio(db, empresaId, usuarioId, {
        periodo: "202609", fecha: "2026-09-30", tipoCambio: "3.800",
      }),
    );
    assert.deepEqual(ajustes.map((a) => a.cuenta), ["4212"], "sólo la partida monetaria");
  });

  test("repetir el ajuste al mismo tipo de cambio no mueve nada", async () => {
    await compraEnDolares("3.700", "1000.00");
    const opciones = { periodo: "202609", fecha: "2026-09-30", tipoCambio: "3.800" };
    await con((db) => ajustarDiferenciaCambio(db, empresaId, usuarioId, opciones));

    // El segundo ajuste ve el saldo funcional ya corregido: no queda diferencia.
    const segundo = await con((db) => ajustarDiferenciaCambio(db, empresaId, usuarioId, opciones));
    assert.equal(segundo.asientoId, null);
    assert.equal(segundo.ajustes.length, 0);
  });

  test("un segundo ajuste sólo registra el movimiento del tipo de cambio", async () => {
    await compraEnDolares("3.700", "1000.00");
    await con((db) =>
      ajustarDiferenciaCambio(db, empresaId, usuarioId, {
        periodo: "202609", fecha: "2026-09-30", tipoCambio: "3.800",
      }),
    );
    const segundo = await con((db) =>
      ajustarDiferenciaCambio(db, empresaId, usuarioId, {
        periodo: "202609", fecha: "2026-09-30", tipoCambio: "3.750",
      }),
    );
    // De 3.80 a 3.75 la deuda baja 50 soles: ganancia, no la diferencia contra
    // el tipo de cambio original.
    assert.equal(money.toString(segundo.ajustes[0]!.ajuste, 2), "50.00");
  });
});

describe("cierre de ejercicio", () => {
  /** Un ejercicio con utilidad: una venta con su costo. */
  async function ejercicioConUtilidad() {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor,
        tipoDocumento: "01",
        serie: "F001",
        numero: "100",
        fechaEmision: "2026-03-02",
        moneda: "PEN",
        tipoCambio: "1",
        almacenId,
        lineas: [
          { productoId: producto, descripcion: "Bomba", cantidad: "10", valorUnitario: "100.00", afectacionIgv: "10" },
        ],
      }),
    );
    await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente,
        tipoDocumento: "01",
        serie: "F001",
        fechaEmision: "2026-04-05",
        moneda: "PEN",
        tipoCambio: "1",
        almacenId,
        lineas: [
          { productoId: producto, descripcion: "Bomba", cantidad: "5", valorUnitario: "300.00", afectacionIgv: "10" },
        ],
      }),
    );
  }

  test("el resultado del cierre es el mismo que informa el estado de resultados", async () => {
    await ejercicioConUtilidad();
    const antes = await con((db) => estadoResultados(db, "202612"));
    const cierre = await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));
    assert.equal(
      money.toString(cierre.utilidad, 2),
      money.toString(antes.resultado, 2),
      "el cierre no puede inventar un resultado distinto del que ya se informaba",
    );
  });

  test("después de cerrar, las cuentas de resultado quedan en cero", async () => {
    await ejercicioConUtilidad();
    await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));

    const despues = await con((db) => estadoResultados(db, "202613"));
    assert.equal(money.toString(despues.resultado, 2), "0.00");
  });

  test("la utilidad aterriza en resultados acumulados y la 89 queda saldada", async () => {
    await ejercicioConUtilidad();
    const cierre = await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));

    const balance = await con((db) => balanceComprobacion(db, "202613"));
    const acumulados = balance.find((b) => b.cuenta === "5911");
    assert.equal(s2(acumulados!.saldo), `-${money.toString(cierre.utilidad, 2)}`);

    const resultado = balance.find((b) => b.cuenta === "891");
    assert.equal(s2(resultado!.saldo), "0.00", "la 89 es de paso, no se queda con nada");
  });

  test("el balance general sigue cuadrando después del cierre", async () => {
    await ejercicioConUtilidad();
    await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));
    const situacion = await con((db) => situacionFinanciera(db, "202613"));
    assert.ok(situacion.cuadra, `descuadre de ${money.toString(situacion.descuadre, 2)}`);
  });

  test("cerrar el ejercicio cierra sus doce meses y el periodo 13", async () => {
    await ejercicioConUtilidad();
    await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));
    const lista = await con((db) => listarPeriodos(db));
    const cerrados = lista.filter((p) => p.estado === "cerrado").map((p) => p.periodo);
    assert.equal(cerrados.length, 13);
    assert.ok(cerrados.includes("202601"));
    assert.ok(cerrados.includes("202613"));
  });

  test("no se cierra dos veces", async () => {
    await ejercicioConUtilidad();
    await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));
    await con((db) => reabrirPeriodo(db, empresaId, usuarioId, "202613"));
    await assert.rejects(
      () => con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026")),
      /ya está cerrado/,
    );
  });

  test("no se cierra con borradores pendientes", async () => {
    await ejercicioConUtilidad();
    await con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase()));
    await assert.rejects(
      () => con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026")),
      /borrador/,
    );
  });

  test("un ejercicio sin movimiento no se cierra", async () => {
    await assert.rejects(
      () => con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2025")),
      /no hay cuentas de resultado/,
    );
  });

  test("cerrado el ejercicio, no entra un asiento más en ninguno de sus meses", async () => {
    await ejercicioConUtilidad();
    await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));
    await assert.rejects(
      () => con((db) => guardarBorrador(db, empresaId, usuarioId, borradorBase())),
      /cerrado/,
    );
  });
});

// ─── El estado de resultados no puede dejarse nada fuera ──────────────────

describe("el estado de resultados recoge todas las cuentas de resultado", () => {
  /**
   * Antes enumeraba tres grupos de gasto —63, 64 y 65— y cualquier otro
   * quedaba fuera. La planilla del 62 y la depreciación del 68 no aparecían, y
   * la utilidad operativa salía inflada por el importe de la planilla del mes,
   * que es el gasto más grande de casi cualquier empresa.
   */
  async function asentarGasto(cuenta: string, importe: string, centro?: string) {
    const [cc] = centro
      ? await raw<{ id: string }[]>`
          SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} AND codigo = ${centro}`
      : [];
    await con((db) =>
      asentar(db, empresaId, usuarioId, {
        periodo: "202609",
        fecha: "2026-09-30",
        subdiario: "08",
        glosa: `Gasto en ${cuenta}`,
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          {
            cuenta,
            debe: importe,
            ...(cc ? { centroCostoId: cc.id } : {}),
          },
          { cuenta: "4699", haber: importe, anexoId: proveedor },
        ],
      }),
    );
  }

  test("la planilla aparece como gasto de personal y baja la utilidad", async () => {
    await raw`
      INSERT INTO centros_costo (empresa_id, codigo, nombre)
      VALUES (${empresaId}, 'ADM', 'Administración')`;
    await asentarGasto("6211", "8500.00", "ADM");

    const r = await con((db) => estadoResultados(db, "202609"));
    const personal = r.lineas.find((l) => l.concepto === "Gastos de personal");
    assert.ok(personal, "la planilla tiene que tener su renglón");
    assert.equal(money.toString(personal!.importe, 2), "-8500.00");
    assert.equal(money.toString(r.resultado, 2), "-8500.00");
  });

  test("la depreciación también entra", async () => {
    await raw`
      INSERT INTO centros_costo (empresa_id, codigo, nombre)
      VALUES (${empresaId}, 'ADM', 'Administración')`;
    await asentarGasto("68142", "1200.00", "ADM");

    const r = await con((db) => estadoResultados(db, "202609"));
    assert.ok(
      r.lineas.some((l) => /Depreciación/.test(l.concepto)),
      "la depreciación tiene que aparecer",
    );
    assert.equal(money.toString(r.resultado, 2), "-1200.00");
  });

  test("el resultado coincide con el del balance, gaste en lo que gaste", async () => {
    // Es la invariante que hace inútil enumerar grupos a mano: si el estado de
    // resultados se deja algo fuera, deja de cuadrar con el balance.
    await raw`
      INSERT INTO centros_costo (empresa_id, codigo, nombre)
      VALUES (${empresaId}, 'ADM', 'Administración')`;
    await asentarGasto("6211", "8500.00", "ADM");
    await asentarGasto("6271", "765.00", "ADM");
    await asentarGasto("68142", "1200.00", "ADM");
    await asentarGasto("6431", "300.00");

    const resultados = await con((db) => estadoResultados(db, "202609"));
    const situacion = await con((db) => situacionFinanciera(db, "202609"));
    const enBalance = situacion.pasivoPatrimonio.find(
      (l) => l.concepto === "Resultado del ejercicio",
    )!;
    assert.equal(
      money.toString(resultados.resultado, 2),
      money.toString(enBalance.importe, 2),
    );
    assert.ok(situacion.cuadra);
  });
});
