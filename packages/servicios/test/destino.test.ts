/**
 * Asiento de destino y estado de resultados por función.
 *
 * Lo que se comprueba son las tres propiedades que hacen seguro reclasificar:
 * que no cambie el resultado, que correrlo dos veces no duplique nada, y que el
 * gasto sin regla se denuncie en vez de repartirse por una regla inventada.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, asentar, balanceComprobacion, estadoResultados,
  guardarReglas, listarReglas, elegirRegla,
  previsualizarDestino, contabilizarDestino, estadoResultadosPorFuncion,
  DestinoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let admin = "";
let ventas = "";

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
    INSERT INTO centros_costo (empresa_id, codigo, nombre)
    VALUES (${empresaId}, 'ADM', 'Administración') RETURNING id`;
  admin = a!.id;
  const [v] = await raw<{ id: string }[]>`
    INSERT INTO centros_costo (empresa_id, codigo, nombre)
    VALUES (${empresaId}, 'VEN', 'Ventas') RETURNING id`;
  ventas = v!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

const mover = (
  lineas: { cuenta: string; debe?: string; haber?: string; centroCostoId?: string }[],
  periodo = "202609",
) =>
  con((db) =>
    asentar(db, empresaId, usuarioId, {
      periodo,
      fecha: `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-15`,
      subdiario: "08",
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

const libroCuadra = async (periodo: string) => {
  const b = await con((db) => balanceComprobacion(db, periodo));
  return money.toString(b.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO), 2);
};

const reglasBase = () =>
  con((db) =>
    guardarReglas(db, empresaId, usuarioId, [
      { centroCostoId: admin, cuentaDestino: "94" },
      { centroCostoId: ventas, cuentaDestino: "95" },
      { cuenta: "67", cuentaDestino: "97" },
    ]),
  );

/** Gasto de administración y de ventas en el mismo periodo. */
const gastos = () =>
  mover([
    { cuenta: "6351", debe: "1000", centroCostoId: admin },
    { cuenta: "6311", debe: "600", centroCostoId: ventas },
    { cuenta: "1041", haber: "1600" },
  ]);

// ─── Elección de regla ────────────────────────────────────────────────────

describe("elegir la regla que se aplica", () => {
  const reglas = [
    { cuenta: null, centroCostoId: null, cuentaDestino: "94" },
    { cuenta: "63", centroCostoId: null, cuentaDestino: "95" },
    { cuenta: "6351", centroCostoId: null, cuentaDestino: "92" },
    { cuenta: null, centroCostoId: "C1", cuentaDestino: "97" },
  ];

  test("gana el prefijo más largo", () => {
    assert.equal(elegirRegla(reglas, "6351", null)?.cuentaDestino, "92");
    assert.equal(elegirRegla(reglas, "6361", null)?.cuentaDestino, "95");
    assert.equal(elegirRegla(reglas, "6591", null)?.cuentaDestino, "94");
  });

  /** El centro pesa más que cualquier prefijo: es la regla del negocio. */
  test("el centro de costo manda sobre la cuenta", () => {
    assert.equal(elegirRegla(reglas, "6351", "C1")?.cuentaDestino, "97");
  });

  test("sin regla aplicable devuelve nada", () => {
    assert.equal(elegirRegla([{ cuenta: "63", centroCostoId: null, cuentaDestino: "95" }], "70", null), null);
  });
});

// ─── Reglas ───────────────────────────────────────────────────────────────

describe("reglas de destino", () => {
  test("se guardan y se leen", async () => {
    await reglasBase();
    const lista = await con((db) => listarReglas(db));
    assert.equal(lista.length, 3);
    assert.ok(lista.some((r) => r.cuentaDestino === "94" && r.centroCostoId === admin));
  });

  test("guardar dos veces reemplaza las anteriores", async () => {
    await reglasBase();
    await con((db) =>
      guardarReglas(db, empresaId, usuarioId, [{ cuenta: "6", cuentaDestino: "94" }]),
    );
    assert.equal((await con((db) => listarReglas(db))).length, 1);
  });

  test("el destino tiene que ser de la clase 9", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarReglas(db, empresaId, usuarioId, [{ cuenta: "63", cuentaDestino: "6351" }]),
        ),
      /no es una cuenta de la clase 9/,
    );
  });

  test("el origen tiene que ser de la clase 6", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarReglas(db, empresaId, usuarioId, [{ cuenta: "70", cuentaDestino: "95" }]),
        ),
      /no es de la clase 6/,
    );
  });
});

// ─── Asiento de destino ───────────────────────────────────────────────────

describe("asiento de destino", () => {
  test("reparte el gasto entre funciones según las reglas", async () => {
    await reglasBase();
    await gastos();

    const vista = await con((db) => previsualizarDestino(db, "202609"));
    const porFuncion = new Map(vista.porFuncion.map((f) => [f.cuenta, f.importe]));
    assert.equal(s2(porFuncion.get("94")!), "1000.00");
    assert.equal(s2(porFuncion.get("95")!), "600.00");
    assert.equal(vista.pendiente, "1600.00");
    assert.deepEqual(vista.sinDestino, []);
  });

  /** La clase 9 y la 79 se anulan: el resultado no puede cambiar. */
  test("no cambia el resultado del ejercicio ni descuadra el libro", async () => {
    await reglasBase();
    await gastos();
    const antes = await con((db) => estadoResultados(db, "202609"));

    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));

    const despues = await con((db) => estadoResultados(db, "202609"));
    assert.equal(money.toString(despues.resultado, 2), money.toString(antes.resultado, 2));
    assert.equal(await libroCuadra("202609"), "0.00");
  });

  /** Correrlo dos veces el mismo mes no puede duplicar nada. */
  test("la segunda corrida no destina otra vez lo mismo", async () => {
    await reglasBase();
    await gastos();
    const primera = await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    assert.equal(primera.importe, "1600.00");

    const segunda = await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    assert.equal(segunda.asientoId, null);
    assert.equal(segunda.importe, "0.00");
    assert.equal(await libroCuadra("202609"), "0.00");
  });

  test("un gasto añadido después se destina en la siguiente corrida", async () => {
    await reglasBase();
    await gastos();
    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));

    await mover([
      { cuenta: "6361", debe: "250", centroCostoId: admin },
      { cuenta: "1041", haber: "250" },
    ]);
    const segunda = await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    assert.equal(segunda.importe, "250.00");
    assert.equal(await libroCuadra("202609"), "0.00");
  });

  /**
   * Un gasto sin regla no se reparte por una regla inventada: se denuncia. Un
   * estado por función al que le faltan gastos es peor que no tenerlo.
   */
  test("el gasto sin regla se queda fuera y se avisa", async () => {
    await con((db) =>
      guardarReglas(db, empresaId, usuarioId, [{ centroCostoId: admin, cuentaDestino: "94" }]),
    );
    await gastos();

    const vista = await con((db) => previsualizarDestino(db, "202609"));
    assert.equal(vista.pendiente, "1000.00");
    assert.equal(vista.sinDestino.length, 1);
    assert.equal(vista.sinDestino[0]!.cuenta, "6311");
    assert.equal(vista.totalSinDestino, "600.00");

    const r = await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    assert.equal(r.sinDestino, 1);
    assert.equal(r.importe, "1000.00");
  });

  test("sin gasto no asienta nada", async () => {
    await reglasBase();
    const r = await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    assert.equal(r.asientoId, null);
  });

  test("exige el formato del periodo", async () => {
    await assert.rejects(
      () => con((db) => previsualizarDestino(db, "2026-09")),
      /AAAAMM/,
    );
  });
});

// ─── Estado por función ───────────────────────────────────────────────────

describe("estado de resultados por función", () => {
  async function mesCompleto() {
    await reglasBase();
    // Venta de 5 000 con costo de 3 000, y 1 600 de gastos.
    // La 1212 exige tercero y documento: es una cuenta por cobrar y sin eso no
    // se sabe quién debe. Se usa la 1041 para no montar un cliente sólo por esto.
    await mover([
      { cuenta: "1041", debe: "5000" },
      { cuenta: "70111", haber: "5000" },
    ]);
    await mover([
      { cuenta: "69111", debe: "3000" },
      { cuenta: "20111", haber: "3000" },
    ]);
    await gastos();
    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
  }

  test("presenta los gastos por función y cuadra con el de naturaleza", async () => {
    await mesCompleto();
    const funcion = await con((db) => estadoResultadosPorFuncion(db, "202609"));
    const naturaleza = await con((db) => estadoResultados(db, "202609"));

    const buscar = (c: string) => funcion.lineas.find((l) => l.concepto === c)!.importe;
    assert.equal(s2(buscar("Ventas netas")), "5000.00");
    assert.equal(s2(buscar("Utilidad bruta")), "2000.00");
    assert.equal(s2(buscar("Gastos de administración")), "-1000.00");
    assert.equal(s2(buscar("Gastos de ventas")), "-600.00");
    assert.equal(s2(buscar("Utilidad operativa")), "400.00");

    // Las dos vistas tienen que dar el mismo resultado: es el mismo mayor.
    assert.equal(
      s2(buscar("RESULTADO DEL EJERCICIO")),
      money.toString(naturaleza.resultado, 2),
    );
    assert.equal(funcion.completo, true);
  });

  /** Presentar un estado por función al que le faltan gastos es peor que no tenerlo. */
  test("dice que está incompleto mientras quede gasto sin destinar", async () => {
    await reglasBase();
    await gastos();
    const antes = await con((db) => estadoResultadosPorFuncion(db, "202609"));
    assert.equal(antes.completo, false);
    assert.equal(s2(antes.sinDestinar), "1600.00");

    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    const despues = await con((db) => estadoResultadosPorFuncion(db, "202609"));
    assert.equal(despues.completo, true);
    assert.equal(s2(despues.sinDestinar), "0.00");
  });

  test("lleva los gastos financieros a su propia línea", async () => {
    await reglasBase();
    await mover([
      { cuenta: "6711", debe: "120", centroCostoId: admin },
      { cuenta: "1041", haber: "120" },
    ]);
    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    const funcion = await con((db) => estadoResultadosPorFuncion(db, "202609"));
    // El centro manda sobre la cuenta: va a administración, no a financieros.
    assert.equal(
      s2(funcion.lineas.find((l) => l.concepto === "Gastos de administración")!.importe),
      "-120.00",
    );
  });

  test("una cuenta 67 sin centro sí va a financieros", async () => {
    await reglasBase();
    await mover([
      { cuenta: "6711", debe: "90" },
      { cuenta: "1041", haber: "90" },
    ]);
    await con((db) => contabilizarDestino(db, empresaId, usuarioId, "202609"));
    const funcion = await con((db) => estadoResultadosPorFuncion(db, "202609"));
    assert.equal(
      s2(funcion.lineas.find((l) => l.concepto === "Gastos financieros")!.importe),
      "-90.00",
    );
  });
});
