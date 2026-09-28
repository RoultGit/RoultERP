/**
 * Presupuesto y análisis presupuestal.
 *
 * Lo que se comprueba es que la vara de medir sea honesta: que lo ejecutado
 * salga del mayor, que el reparto anual no pierda céntimos, que ingresos y
 * gastos se midan en el mismo sentido, y —sobre todo— que lo gastado fuera de
 * presupuesto se denuncie en vez de quedarse fuera del informe.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, asentar,
  guardarPresupuesto, aprobarPresupuesto, reabrirPresupuesto, cerrarPresupuesto,
  eliminarPresupuesto, listarPresupuestos, cargarPresupuesto, ejecucionPresupuestal,
  doceavas, PresupuestoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
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

  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
  centroUno = cc!.id;
  const [cc2] = await raw<{ id: string }[]>`
    INSERT INTO centros_costo (empresa_id, codigo, nombre)
    VALUES (${empresaId}, '900', 'Obra San Miguel') RETURNING id`;
  centroDos = cc2!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

/** Un asiento de gasto o de ingreso, con su centro de costo. */
const mover = (
  lineas: { cuenta: string; debe?: string; haber?: string; centroCostoId?: string }[],
  periodo = "202603",
) =>
  con((db) =>
    asentar(db, empresaId, usuarioId, {
      periodo,
      fecha: `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-15`,
      subdiario: "01",
      glosa: "Movimiento de prueba",
      moneda: "PEN",
      tipoCambio: "1",
      lineas: lineas.map((l) => ({
        cuenta: l.cuenta,
        glosa: "Prueba",
        ...(l.debe ? { debe: l.debe } : {}),
        ...(l.haber ? { haber: l.haber } : {}),
        ...(l.centroCostoId ? { centroCostoId: l.centroCostoId } : {}),
      })),
    }),
  );

const idDe = async (codigo: string) => {
  const lista = await con((db) => listarPresupuestos(db));
  return lista.find((p) => p.codigo === codigo)!.id;
};

const buscar = (lineas: { cuenta: string; centroCostoId: string | null }[], cuenta: string, centro?: string) =>
  lineas.find((l) => l.cuenta === cuenta && (centro === undefined || l.centroCostoId === centro));

// ─── Reparto anual ────────────────────────────────────────────────────────

describe("reparto en doceavas", () => {
  /** Repartir por redondeo deja el año descuadrado respecto del total aprobado. */
  test("no pierde un céntimo cuando no es redondo", () => {
    const partes = doceavas(d("10000"));
    assert.equal(partes.length, 12);
    assert.equal(
      money.toString(partes.reduce((a, p) => money.add(a, p), money.ZERO), 2),
      "10000.00",
    );
  });

  test("reparte exacto cuando sí lo es", () => {
    const partes = doceavas(d("1200"));
    assert.ok(partes.every((p) => money.toString(p, 2) === "100.00"));
  });
});

// ─── Mantenimiento ────────────────────────────────────────────────────────

describe("mantenimiento del presupuesto", () => {
  const anual = () =>
    con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026",
        nombre: "Presupuesto 2026",
        ejercicio: 2026,
        partidas: [
          { centroCostoId: centroUno, cuenta: "63", importe: "12000" },
          { centroCostoId: centroDos, cuenta: "63", mes: 3, importe: "500" },
        ],
      }),
    );

  test("una partida sin mes se reparte en doce", async () => {
    await anual();
    const { partidas } = await con(async (db) => cargarPresupuesto(db, await idDe("P2026")));
    const delUno = partidas.filter((p) => p.centroCostoId === centroUno);
    assert.equal(delUno.length, 12);
    assert.equal(s2(delUno[0]!.importe), "1000.00");
    // Y la del mes concreto queda sola.
    assert.equal(partidas.filter((p) => p.centroCostoId === centroDos).length, 1);
  });

  test("dos partidas de la misma cuenta y centro se suman", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026",
        nombre: "Presupuesto 2026",
        ejercicio: 2026,
        partidas: [
          { centroCostoId: centroUno, cuenta: "63", mes: 1, importe: "100" },
          { centroCostoId: centroUno, cuenta: "63", mes: 1, importe: "250" },
        ],
      }),
    );
    const { partidas } = await con(async (db) => cargarPresupuesto(db, await idDe("P2026")));
    assert.equal(partidas.length, 1);
    assert.equal(s2(partidas[0]!.importe), "350.00");
  });

  test("admite partidas sin centro de costo", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026",
        nombre: "General",
        ejercicio: 2026,
        partidas: [{ cuenta: "6373", mes: 1, importe: "120" }],
      }),
    );
    const { partidas } = await con(async (db) => cargarPresupuesto(db, await idDe("P2026")));
    assert.equal(partidas[0]!.centroCostoId, null);
  });

  test("guardar dos veces reemplaza las partidas enteras", async () => {
    await anual();
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026",
        nombre: "Presupuesto 2026",
        ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "63", mes: 1, importe: "50" }],
      }),
    );
    const { partidas } = await con(async (db) => cargarPresupuesto(db, await idDe("P2026")));
    assert.equal(partidas.length, 1);
  });

  test("rechaza una cuenta que no es un prefijo", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarPresupuesto(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Mal",
            ejercicio: 2026,
            partidas: [{ cuenta: "gastos varios", mes: 1, importe: "10" }],
          }),
        ),
      /no es un prefijo numérico/,
    );
  });

  test("rechaza un mes imposible", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarPresupuesto(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Mal",
            ejercicio: 2026,
            partidas: [{ cuenta: "63", mes: 13, importe: "10" }],
          }),
        ),
      /entre 1 y 12/,
    );
  });

  test("un presupuesto aprobado ya no se edita", async () => {
    await anual();
    const id = await idDe("P2026");
    await con((db) => aprobarPresupuesto(db, id, usuarioId));
    await assert.rejects(() => anual(), /está aprobado y ya no se edita/);

    // Reabrirlo lo devuelve a borrador y entonces sí.
    await con((db) => reabrirPresupuesto(db, id));
    await assert.doesNotReject(() => anual());
  });

  test("un cerrado no se reabre ni se elimina", async () => {
    await anual();
    const id = await idDe("P2026");
    await con((db) => aprobarPresupuesto(db, id, usuarioId));
    await con((db) => cerrarPresupuesto(db, id));
    await assert.rejects(() => con((db) => reabrirPresupuesto(db, id)), /no se reabre/);
    await assert.rejects(() => con((db) => eliminarPresupuesto(db, id)), /reábralo antes/);
  });

  test("el listado cuenta partidas y suma el total", async () => {
    await anual();
    const [fila] = await con((db) => listarPresupuestos(db, 2026));
    assert.equal(Number(fila!.partidas), 13);
    assert.equal(s2(fila!.total), "12500.00");
  });
});

// ─── Análisis ─────────────────────────────────────────────────────────────

describe("análisis presupuestal", () => {
  async function planYGasto() {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026",
        nombre: "Presupuesto 2026",
        ejercicio: 2026,
        partidas: [
          { centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" },
          { centroCostoId: centroDos, cuenta: "63", mes: 3, importe: "1000" },
        ],
      }),
    );
    // El primero gasta 800 (holgura) y el segundo 1 400 (exceso).
    await mover([
      { cuenta: "6351", debe: "800", centroCostoId: centroUno },
      { cuenta: "6351", debe: "1400", centroCostoId: centroDos },
      { cuenta: "1041", haber: "2200" },
    ]);
  }

  test("compara el plan con lo que dice el mayor", async () => {
    await planYGasto();
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));

    const uno = buscar(e.lineas, "63", centroUno)!;
    assert.equal(s2(uno.presupuestado), "1000.00");
    assert.equal(s2(uno.ejecutado), "800.00");
    assert.equal(s2(uno.desviacion), "200.00");
    assert.equal(uno.avance, "80.00");
    assert.equal(uno.excedido, false);

    const dos = buscar(e.lineas, "63", centroDos)!;
    assert.equal(s2(dos.ejecutado), "1400.00");
    assert.equal(s2(dos.desviacion), "-400.00");
    assert.equal(dos.excedido, true);

    assert.equal(e.totales.presupuestado, "2000.00");
    assert.equal(e.totales.ejecutado, "2200.00");
    assert.equal(e.totales.desviacion, "-200.00");
  });

  test("una partida recoge todas las cuentas bajo su prefijo", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" }],
      }),
    );
    await mover([
      { cuenta: "6351", debe: "300", centroCostoId: centroUno },
      { cuenta: "6361", debe: "200", centroCostoId: centroUno },
      { cuenta: "1041", haber: "500" },
    ]);
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    assert.equal(s2(buscar(e.lineas, "63", centroUno)!.ejecutado), "500.00");
  });

  /**
   * Un ingreso presupuestado en 10 000 y cobrado en 12 000 tiene que salir con
   * avance del 120 %, no negativo: los dos lados se miden en positivo.
   */
  test("mide ingresos y gastos en el mismo sentido", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "70", mes: 3, importe: "10000" }],
      }),
    );
    await mover([
      { cuenta: "1041", debe: "12000" },
      { cuenta: "70111", haber: "12000", centroCostoId: centroUno },
    ]);
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    const linea = buscar(e.lineas, "70", centroUno)!;
    assert.equal(s2(linea.ejecutado), "12000.00");
    assert.equal(linea.avance, "120.00");
    assert.equal(linea.excedido, true);
  });

  test("el corte por mes deja fuera lo posterior", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [
          { centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" },
          { centroCostoId: centroUno, cuenta: "63", mes: 6, importe: "1000" },
        ],
      }),
    );
    await mover([
      { cuenta: "6351", debe: "400", centroCostoId: centroUno },
      { cuenta: "1041", haber: "400" },
    ]);
    await mover(
      [
        { cuenta: "6351", debe: "900", centroCostoId: centroUno },
        { cuenta: "1041", haber: "900" },
      ],
      "202606",
    );

    const marzo = await con(async (db) =>
      ejecucionPresupuestal(db, await idDe("P2026"), { hastaMes: 3 }),
    );
    assert.equal(marzo.totales.presupuestado, "1000.00");
    assert.equal(marzo.totales.ejecutado, "400.00");

    const junio = await con(async (db) =>
      ejecucionPresupuestal(db, await idDe("P2026"), { hastaMes: 6 }),
    );
    assert.equal(junio.totales.presupuestado, "2000.00");
    assert.equal(junio.totales.ejecutado, "1300.00");
  });

  test("otro ejercicio no entra", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" }],
      }),
    );
    await mover(
      [
        { cuenta: "6351", debe: "700", centroCostoId: centroUno },
        { cuenta: "1041", haber: "700" },
      ],
      "202503",
    );
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    assert.equal(e.totales.ejecutado, "0.00");
  });

  test("filtra por centro de costo", async () => {
    await planYGasto();
    const e = await con(async (db) =>
      ejecucionPresupuestal(db, await idDe("P2026"), { centroCostoId: centroDos }),
    );
    assert.equal(e.lineas.length, 1);
    assert.equal(e.lineas[0]!.centroCostoId, centroDos);
  });
});

// ─── La salvaguarda ───────────────────────────────────────────────────────

describe("gasto fuera de presupuesto", () => {
  /**
   * Un análisis que sólo mira lo presupuestado deja fuera justo lo que nadie
   * planeó, que suele ser lo que más duele.
   */
  test("lo que nadie presupuestó sale a la luz", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" }],
      }),
    );
    await mover([
      { cuenta: "6351", debe: "500", centroCostoId: centroUno },
      // Nadie presupuestó multas, y menos en la otra obra.
      { cuenta: "6592", debe: "3000", centroCostoId: centroDos },
      { cuenta: "1041", haber: "3500" },
    ]);

    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    assert.equal(e.totales.ejecutado, "500.00");
    assert.equal(e.sinPresupuestar.length, 1);
    assert.equal(e.sinPresupuestar[0]!.cuenta, "6592");
    assert.equal(e.sinPresupuestar[0]!.centro, "Obra San Miguel");
    assert.equal(e.totalSinPresupuestar, "3000.00");
  });

  test("el mismo gasto en un centro presupuestado y en otro no", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "6351", mes: 3, importe: "1000" }],
      }),
    );
    await mover([
      { cuenta: "6351", debe: "400", centroCostoId: centroUno },
      { cuenta: "6351", debe: "900", centroCostoId: centroDos },
      { cuenta: "1041", haber: "1300" },
    ]);
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    assert.equal(e.totales.ejecutado, "400.00");
    assert.equal(e.totalSinPresupuestar, "900.00");
  });

  test("sin gasto suelto, la lista va vacía", async () => {
    await con((db) =>
      guardarPresupuesto(db, empresaId, usuarioId, {
        codigo: "P2026", nombre: "P", ejercicio: 2026,
        partidas: [{ centroCostoId: centroUno, cuenta: "63", mes: 3, importe: "1000" }],
      }),
    );
    await mover([
      { cuenta: "6351", debe: "500", centroCostoId: centroUno },
      { cuenta: "1041", haber: "500" },
    ]);
    const e = await con(async (db) => ejecucionPresupuestal(db, await idDe("P2026")));
    assert.deepEqual(e.sinPresupuestar, []);
  });
});
