/**
 * Póliza (DUA): liquidación por agrupación.
 *
 * Lo que se comprueba es lo que un importador no puede hacer sin esto: que un
 * gasto que ampara varios embarques se reparta entre todos —al céntimo—, que el
 * tipo de cambio de la DUA mande sobre el de cada factura del exterior, y que
 * la deuda quede a nombre de quien de verdad hay que pagarle.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearImportacion, agregarItem, agregarGasto, cargar,
  crearPoliza, asociarImportacion, desasociarImportacion, agregarGastoPoliza,
  quitarGastoPoliza, cargarPoliza, listarPolizas, importacionesDisponibles,
  repartirGastosPoliza, previsualizarPoliza, liquidarPoliza, anularPoliza,
  existencias, balanceComprobacion, listarCxp, PolizaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let exportadorUno = "";
let exportadorDos = "";
let agente = "";
const productos: Record<string, string> = {};

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR", metodoValorizacion: "promedio" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [p1] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '0', 'CN-8891', 'NINGBO TRADING CO. LTD', 'CN', true, false)
    RETURNING id`;
  exportadorUno = p1!.id;
  const [p2] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '0', 'CN-7742', 'SHANGHAI PUMPS CO.', 'CN', true, false)
    RETURNING id`;
  exportadorDos = p2!.id;
  const [ag] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'AGENCIA DE ADUANAS DEL PACIFICO SAC', true, true, 15)
    RETURNING id`;
  agente = ag!.id;

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;

  for (const [codigo, descripcion] of [
    ["P001", "Bomba centrífuga 2HP"],
    ["P002", "Válvula de bronce"],
  ] as const) {
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
      VALUES (${empresaId}, ${codigo}, ${descripcion}, ${unidad!.id})
      RETURNING id`;
    productos[codigo] = p!.id;
  }
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);
const d = (v: string) => money.dec(v);

/**
 * Dos embarques que llegan en la misma DUA.
 *
 * El primero vale USD 6 000 de FOB y el segundo USD 2 000: tres a uno, que es
 * la proporción con la que deben repartirse los gastos de la póliza.
 */
async function dosEmbarques(db: Db) {
  const uno = await crearImportacion(db, empresaId, usuarioId, {
    numero: "IMP-2026-001", proveedorId: exportadorUno, almacenId,
    moneda: "USD", tipoCambio: "3.70", fechaOrden: "2026-08-01",
  });
  await agregarItem(db, empresaId, uno, {
    productoId: productos["P001"]!, descripcion: "Bombas", cantidad: "100", fobUnitario: "60",
  });

  const dos = await crearImportacion(db, empresaId, usuarioId, {
    numero: "IMP-2026-002", proveedorId: exportadorDos, almacenId,
    moneda: "USD", tipoCambio: "3.90", fechaOrden: "2026-08-05",
  });
  await agregarItem(db, empresaId, dos, {
    productoId: productos["P002"]!, descripcion: "Válvulas", cantidad: "200", fobUnitario: "10",
  });

  return { uno, dos };
}

async function polizaCon(db: Db, ids: string[]) {
  const polizaId = await crearPoliza(db, empresaId, usuarioId, {
    numero: "235-2026-10-123456",
    fecha: "2026-09-10",
    fechaNumeracion: "2026-09-10",
    aduana: "235",
    regimen: "Importación definitiva",
    agenteId: agente,
    tipoCambio: "3.80",
  });
  for (const id of ids) await asociarImportacion(db, polizaId, id);
  return polizaId;
}

// ─── Agrupación ───────────────────────────────────────────────────────────

describe("agrupar embarques en una póliza", () => {
  test("reúne varios embarques bajo una DUA", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));

    const { cabecera, embarques } = await con((db) => cargarPoliza(db, polizaId));
    assert.equal(cabecera.numero, "235-2026-10-123456");
    assert.equal(cabecera.agente, "AGENCIA DE ADUANAS DEL PACIFICO SAC");
    assert.equal(embarques.length, 2);

    const [fila] = await con((db) => listarPolizas(db));
    assert.equal(Number(fila!.embarques), 2);
  });

  test("un embarque agrupado sale de la lista de disponibles", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    assert.equal((await con((db) => importacionesDisponibles(db))).length, 2);
    await con((db) => polizaCon(db, [uno]));
    const libres = await con((db) => importacionesDisponibles(db));
    assert.deepEqual(libres.map((l) => l.id), [dos]);
  });

  test("no se agrupa en dos pólizas a la vez", async () => {
    const { uno } = await con((db) => dosEmbarques(db));
    await con((db) => polizaCon(db, [uno]));
    const otra = await con((db) =>
      crearPoliza(db, empresaId, usuarioId, {
        numero: "235-2026-10-999999", fecha: "2026-09-11", tipoCambio: "3.80",
      }),
    );
    await assert.rejects(
      () => con((db) => asociarImportacion(db, otra, uno)),
      /ya pertenece a otra póliza/,
    );
  });

  test("se puede sacar un embarque mientras la póliza siga abierta", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));
    await con((db) => desasociarImportacion(db, polizaId, dos));
    const { embarques } = await con((db) => cargarPoliza(db, polizaId));
    assert.deepEqual(embarques.map((e) => e.id), [uno]);
  });

  test("exige tipo de cambio positivo", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearPoliza(db, empresaId, usuarioId, {
            numero: "X", fecha: "2026-09-10", tipoCambio: "0",
          }),
        ),
      PolizaInvalida,
    );
  });
});

// ─── Reparto ──────────────────────────────────────────────────────────────

describe("reparto de los gastos de la DUA", () => {
  test("reparte por FOB valorizado al tipo de cambio de la póliza", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));

    // Agenciamiento de S/ 4 000: 6 000 contra 2 000 de FOB, o sea 3 a 1.
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Agenciamiento de aduana",
        importe: "4000", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "fob", afectaCosto: true, proveedorId: agente,
      }),
    );

    const vista = await con((db) => previsualizarPoliza(db, polizaId));
    assert.equal(vista.cuadra, true);
    assert.equal(vista.gastoTotal, "4000.00");
    const eUno = vista.embarques.find((e) => e.id === uno)!;
    const eDos = vista.embarques.find((e) => e.id === dos)!;
    assert.equal(eUno.gastosPoliza, "3000.00");
    assert.equal(eDos.gastosPoliza, "1000.00");
  });

  test("no pierde un céntimo cuando el reparto no es exacto", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));
    // 1 000.01 entre 3 y 1: ninguna parte es redonda.
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Almacenaje", importe: "1000.01", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "fob", afectaCosto: true,
      }),
    );
    const vista = await con((db) => previsualizarPoliza(db, polizaId));
    const suma = vista.embarques.reduce((a, e) => money.add(a, d(e.gastosPoliza)), money.ZERO);
    assert.equal(money.toString(suma, 2), "1000.01");
    assert.equal(vista.cuadra, true);
  });

  test("convierte el gasto en dólares antes de repartirlo", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Flete marítimo", importe: "1000", moneda: "USD", tipoCambio: "3.80",
        baseProrrateo: "fob", afectaCosto: true,
      }),
    );
    const vista = await con((db) => previsualizarPoliza(db, polizaId));
    assert.equal(vista.gastoTotal, "3800.00");
    assert.equal(vista.embarques.find((e) => e.id === uno)!.gastosPoliza, "2850.00");
  });

  test("reparte por cantidad cuando se pide así", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));
    // 100 unidades contra 200: un tercio y dos tercios, al revés que el FOB.
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Manipuleo por bulto", importe: "300", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "cantidad", afectaCosto: true,
      }),
    );
    const vista = await con((db) => previsualizarPoliza(db, polizaId));
    assert.equal(vista.embarques.find((e) => e.id === uno)!.gastosPoliza, "100.00");
    assert.equal(vista.embarques.find((e) => e.id === dos)!.gastosPoliza, "200.00");
  });

  test("se planta si nadie declara la base que el gasto pide", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Flete por peso", importe: "500", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "peso", afectaCosto: true,
      }),
    );
    await assert.rejects(
      () => con((db) => repartirGastosPoliza(db, polizaId)),
      /ningún embarque de la póliza lo declara/,
    );
  });

  test("un gasto directo no cabe en la póliza", async () => {
    const { uno } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno]));
    await assert.rejects(
      () =>
        con((db) =>
          agregarGastoPoliza(db, empresaId, polizaId, {
            concepto: "Repuesto puntual", importe: "10", moneda: "PEN", tipoCambio: "1",
            baseProrrateo: "directo", afectaCosto: true,
          }),
        ),
      /regístrelo en su embarque/,
    );
  });

  test("se quita un gasto mal cargado", async () => {
    const { uno } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno]));
    const gastoId = await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Error", importe: "100", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "fob", afectaCosto: true,
      }),
    );
    await con((db) => quitarGastoPoliza(db, polizaId, gastoId));
    const { gastos } = await con((db) => cargarPoliza(db, polizaId));
    assert.equal(gastos.length, 0);
  });
});

// ─── Liquidación ──────────────────────────────────────────────────────────

describe("liquidar la póliza entera", () => {
  async function polizaLista(db: Db) {
    const { uno, dos } = await dosEmbarques(db);
    const polizaId = await polizaCon(db, [uno, dos]);
    await agregarGastoPoliza(db, empresaId, polizaId, {
      concepto: "Agenciamiento de aduana", importe: "4000", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", afectaCosto: true, proveedorId: agente,
    });
    await agregarGastoPoliza(db, empresaId, polizaId, {
      concepto: "IGV de importación", importe: "6080", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", afectaCosto: false, proveedorId: agente,
    });
    return { uno, dos, polizaId };
  }

  test("liquida los dos embarques con su parte de la DUA", async () => {
    const { uno, dos, polizaId } = await con((db) => polizaLista(db));
    const r = await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    assert.equal(r.liquidaciones.length, 2);

    /*
     * Con el tipo de cambio de la DUA (3.80), no con el de cada factura:
     *   embarque 1: 6 000 × 3.80 = 22 800 + 3 000 de agenciamiento = 25 800
     *   embarque 2: 2 000 × 3.80 =  7 600 + 1 000                  =  8 600
     */
    const porId = new Map(r.liquidaciones.map((l) => [l.importacionId, l]));
    assert.equal(s2(porId.get(uno)!.costoTotal), "25800.00");
    assert.equal(s2(porId.get(dos)!.costoTotal), "8600.00");
    assert.equal(r.costoTotal, "34400.00");

    const { cabecera } = await con((db) => cargarPoliza(db, polizaId));
    assert.equal(cabecera.estado, "liquidada");
  });

  test("el kardex recibe la mercadería al costo de la DUA", async () => {
    const { polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    const saldos = await con((db) => existencias(db, almacenId));
    const bombas = saldos.find((s) => s.codigo === "P001")!;
    // 25 800 / 100 unidades = 258.00 cada una.
    assert.equal(money.toString(d(bombas.cantidad), 2), "100.00");
    assert.equal(money.toString(d(bombas.valor), 2), "25800.00");
  });

  test("el libro cuadra después de liquidar", async () => {
    const { polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const suma = balance.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO);
    assert.equal(money.toString(suma, 2), "0.00");
  });

  /**
   * El defecto que esto arregla: la factura del agente iba a la cuenta del
   * exportador. El agente quedaba con saldo cero y el exportador con la deuda
   * de todos, así que ningún pago cuadraba después.
   */
  test("la deuda queda a nombre de quien hay que pagarle", async () => {
    const { polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );

    const docs = await raw<{ proveedor_id: string; total: string }[]>`
      SELECT proveedor_id, total FROM documentos_cxp WHERE empresa_id = ${empresaId}`;
    const porProveedor = new Map<string, money.Dec>();
    for (const doc of docs) {
      porProveedor.set(
        doc.proveedor_id,
        money.add(porProveedor.get(doc.proveedor_id) ?? money.ZERO, d(doc.total)),
      );
    }

    // Al agente: 4 000 de agenciamiento + 6 080 de IGV = 10 080.
    assert.equal(money.toString(porProveedor.get(agente)!, 2), "10080.00");
    // A cada exportador, sólo su FOB al cambio de la DUA.
    assert.equal(money.toString(porProveedor.get(exportadorUno)!, 2), "22800.00");
    assert.equal(money.toString(porProveedor.get(exportadorDos)!, 2), "7600.00");
  });

  test("la antigüedad de saldos ve la deuda del agente", async () => {
    const { polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    const aging = await con((db) => listarCxp(db, agente));
    const delAgente = aging.filter((a) => a.proveedorId === agente);
    assert.ok(delAgente.length > 0, "el agente de aduanas no aparece en cuentas por pagar");
  });

  test("el gasto de la DUA queda anotado en cada embarque", async () => {
    const { uno, polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    const { gastos } = await con((db) => cargar(db, uno));
    // Con el número de DUA en el concepto: dentro de un año hay que poder
    // contestar de dónde salieron esos 3 000 soles.
    assert.ok(gastos.some((g) => g.concepto.includes("235-2026-10-123456")));
  });

  test("no se liquida dos veces", async () => {
    const { polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          liquidarPoliza(db, empresaId, usuarioId, polizaId, {
            fecha: "2026-09-16", periodo: "202609",
          }),
        ),
      /está liquidada/,
    );
  });

  test("una póliza sin embarques no se liquida", async () => {
    const polizaId = await con((db) =>
      crearPoliza(db, empresaId, usuarioId, {
        numero: "235-2026-10-000001", fecha: "2026-09-10", tipoCambio: "3.80",
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          liquidarPoliza(db, empresaId, usuarioId, polizaId, {
            fecha: "2026-09-15", periodo: "202609",
          }),
        ),
      /no tiene embarques/,
    );
  });

  test("exige almacén en cada embarque antes de liquidar", async () => {
    const { uno, polizaId } = await con((db) => polizaLista(db));
    await raw`UPDATE importaciones SET almacen_id = NULL WHERE id = ${uno}`;
    await assert.rejects(
      () =>
        con((db) =>
          liquidarPoliza(db, empresaId, usuarioId, polizaId, {
            fecha: "2026-09-15", periodo: "202609",
          }),
        ),
      /no tiene almacén de ingreso/,
    );
  });

  test("liquidada, la póliza ya no admite cambios", async () => {
    const { uno, polizaId } = await con((db) => polizaLista(db));
    await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    await assert.rejects(
      () => con((db) => desasociarImportacion(db, polizaId, uno)),
      /ya no admite cambios/,
    );
  });

  test("anular la póliza libera sus embarques", async () => {
    const { uno, dos, polizaId } = await con((db) => polizaLista(db));
    await con((db) => anularPoliza(db, polizaId));
    const libres = await con((db) => importacionesDisponibles(db));
    assert.deepEqual(libres.map((l) => l.id).sort(), [uno, dos].sort());
  });
});

// ─── Gastos propios y de póliza conviviendo ───────────────────────────────

describe("gastos propios del embarque y de la póliza", () => {
  test("se suman sin pisarse", async () => {
    const { uno, dos } = await con((db) => dosEmbarques(db));
    const polizaId = await con((db) => polizaCon(db, [uno, dos]));

    // Uno propio del primer embarque y otro de la póliza entera.
    await con((db) =>
      agregarGasto(db, empresaId, uno, {
        concepto: "Inspección del proveedor", importe: "500", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "fob", afectaCosto: true,
      }),
    );
    await con((db) =>
      agregarGastoPoliza(db, empresaId, polizaId, {
        concepto: "Agenciamiento", importe: "4000", moneda: "PEN", tipoCambio: "1",
        baseProrrateo: "fob", afectaCosto: true, proveedorId: agente,
      }),
    );

    const r = await con((db) =>
      liquidarPoliza(db, empresaId, usuarioId, polizaId, {
        fecha: "2026-09-15", periodo: "202609",
      }),
    );
    const porId = new Map(r.liquidaciones.map((l) => [l.importacionId, l]));
    // 22 800 de FOB + 3 000 de la DUA + 500 propios.
    assert.equal(s2(porId.get(uno)!.costoTotal), "26300.00");
    // El segundo no carga la inspección del primero.
    assert.equal(s2(porId.get(dos)!.costoTotal), "8600.00");
  });
});
