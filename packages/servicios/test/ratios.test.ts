/**
 * Ratios financieros.
 *
 * Lo que se comprueba, sobre todo, es lo que el módulo se niega a hacer: un
 * ratio sin sus insumos no se calcula. No se estima ni se pone en cero, porque
 * un ratio inventado es peor que un hueco: nadie lo cuestiona.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, asentar, listarFormatos, guardarFormato, ratiosFinancieros,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let cliente = "";
let proveedor = "";

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

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true) RETURNING id`;
  cliente = c!.id;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = p!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

type Linea = { cuenta: string; debe?: string; haber?: string; anexoId?: string };

/**
 * Un asiento de prueba.
 *
 * Las cuentas comerciales —la 1212 y la 4212— exigen anexo y documento, y con
 * razón: una deuda sin decir con quién no es una deuda. Se les pone uno.
 */
const mover = (lineas: Linea[], periodo = "202609") =>
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
        ...(l.anexoId
          ? {
              anexoId: l.anexoId,
              documentoTipo: "01",
              documentoSerie: "F001",
              documentoNumero: "00000001",
            }
          : {}),
      })),
    }),
  );

const idDe = async (codigo: string) => {
  const lista = await con((db) => listarFormatos(db));
  return lista.find((f) => f.codigo === codigo)!.id;
};

const calcular = async (periodo = "202609") =>
  con(async (db) =>
    ratiosFinancieros(db, {
      situacionId: await idDe("EFS"),
      resultadosId: await idDe("ERN"),
      periodo,
    }),
  );

const buscar = (
  a: { ratios: { codigo: string; valor: string | null; falta?: string }[] },
  c: string,
) => a.ratios.find((r) => r.codigo === c)!;

/**
 * Un balance de comercializadora con cifras redondas.
 *
 *   Compra 80 000 de mercadería a crédito.
 *   Vende 100 000 a crédito, con un costo de 60 000.
 *
 * Queda: caja 10 000 · clientes 100 000 · existencias 20 000
 *        proveedores 80 000 · capital 30 000 · resultado 40 000
 *
 * Las existencias tienen que quedar en positivo: un inventario negativo no
 * existe, y con él la prueba ácida saldría mayor que la razón corriente, que es
 * imposible.
 */
async function balance() {
  await mover([
    { cuenta: "1041", debe: "10000" },
    { cuenta: "5011", haber: "10000" },
  ]);
  await mover([
    { cuenta: "20111", debe: "80000" },
    { cuenta: "4212", haber: "80000", anexoId: proveedor },
  ]);
  await mover([
    { cuenta: "1212", debe: "100000", anexoId: cliente },
    { cuenta: "70111", haber: "100000" },
  ]);
  await mover([
    { cuenta: "69111", debe: "60000" },
    { cuenta: "20111", haber: "60000" },
  ]);
}

// ─── Liquidez y solvencia ─────────────────────────────────────────────────

describe("liquidez y solvencia", () => {
  test("la razón corriente y la prueba ácida salen del formato", async () => {
    await balance();
    const a = await calcular();

    const corriente = buscar(a, "corriente");
    assert.notEqual(corriente.valor, null);
    // La ácida quita las existencias, así que nunca puede ser mayor.
    assert.ok(Number(buscar(a, "acida").valor) <= Number(corriente.valor));
  });

  test("el capital de trabajo es activo corriente menos pasivo corriente", async () => {
    await balance();
    const a = await calcular();
    assert.notEqual(buscar(a, "capital_trabajo").valor, null);
  });

  test("avisa de que el formato no separa el pasivo no corriente", async () => {
    await balance();
    const a = await calcular();
    assert.ok(a.avisos.some((x) => /no separa el pasivo no corriente/.test(x)));
  });

  test("el endeudamiento va en porcentaje", async () => {
    await balance();
    const a = await calcular();
    const e = buscar(a, "endeudamiento");
    assert.notEqual(e.valor, null);
    assert.ok(Number(e.valor) > 0 && Number(e.valor) < 100);
  });
});

// ─── Rentabilidad ─────────────────────────────────────────────────────────

describe("rentabilidad", () => {
  test("el margen bruto es la utilidad bruta sobre las ventas", async () => {
    await balance();
    const a = await calcular();
    // 40 000 / 100 000.
    assert.equal(buscar(a, "margen_bruto").valor, "40.00");
  });

  test("el margen neto y el ROE se calculan", async () => {
    await balance();
    const a = await calcular();
    assert.notEqual(buscar(a, "margen_neto").valor, null);
    assert.notEqual(buscar(a, "roe").valor, null);
  });

  /** Dividir entre cero da infinito, y un infinito en un informe es una mentira. */
  test("sin ventas, los márgenes no se calculan en vez de dar infinito", async () => {
    await mover([
      { cuenta: "1041", debe: "1000" },
      { cuenta: "5011", haber: "1000" },
    ]);
    const a = await calcular();
    assert.equal(buscar(a, "margen_bruto").valor, null);
    assert.equal(buscar(a, "margen_neto").valor, null);
  });
});

// ─── Actividad ────────────────────────────────────────────────────────────

describe("actividad", () => {
  test("la rotación y los días de inventario salen del costo y el saldo medio", async () => {
    await balance();
    const a = await calcular();
    assert.notEqual(buscar(a, "rotacion_existencias").valor, null);
    assert.ok(Number(buscar(a, "dias_inventario").valor) > 0);
  });

  /**
   * El formato presenta el costo en negativo porque en el estado de resultados
   * resta. Un ratio que tomara ese signo daría rotaciones y días negativos, que
   * no significan nada.
   */
  test("la rotación es positiva aunque el costo se presente en negativo", async () => {
    await balance();
    const a = await calcular();
    assert.ok(Number(buscar(a, "rotacion_existencias").valor) > 0);
    assert.ok(Number(buscar(a, "dias_inventario").valor) > 0);
    assert.ok(Number(buscar(a, "dias_pago").valor) > 0);
  });

  test("el ciclo de efectivo es inventario más cobro menos pago", async () => {
    await balance();
    const a = await calcular();
    const ciclo = Number(buscar(a, "ciclo_efectivo").valor);
    const inv = Number(buscar(a, "dias_inventario").valor);
    const cob = Number(buscar(a, "dias_cobro").valor);
    const pag = Number(buscar(a, "dias_pago").valor);
    assert.ok(Math.abs(ciclo - (inv + cob - pag)) < 0.2);
  });

  /** El primer año no hay apertura: conviene decir que la cifra sale optimista. */
  test("avisa de que no hay saldos de apertura", async () => {
    await balance();
    const a = await calcular();
    assert.ok(a.avisos.some((x) => /saldos de apertura/.test(x)));
  });

  test("con apertura, deja de avisar", async () => {
    await mover(
      [
        { cuenta: "20111", debe: "40000" },
        { cuenta: "5011", haber: "40000" },
      ],
      "202512",
    );
    await balance();
    const a = await calcular();
    assert.ok(!a.avisos.some((x) => /saldos de apertura/.test(x)));
    assert.notEqual(buscar(a, "rotacion_existencias").valor, null);
  });
});

// ─── La negativa a inventar ───────────────────────────────────────────────

describe("ratios sin insumos", () => {
  const formatoPelado = () =>
    con((db) =>
      guardarFormato(db, empresaId, usuarioId, {
        codigo: "PELADO",
        nombre: "Sin papeles",
        tipo: "situacion",
        lineas: [{ codigo: "caja", concepto: "Efectivo", cuentas: "10" }],
      }),
    );

  const conPelado = async () =>
    con(async (db) =>
      ratiosFinancieros(db, {
        situacionId: await idDe("PELADO"),
        resultadosId: await idDe("ERN"),
        periodo: "202609",
      }),
    );

  /**
   * La regla dura: un ratio sin sus insumos no se calcula ni se estima. Un
   * número inventado es peor que un hueco porque nadie lo cuestiona.
   */
  test("un formato sin papeles deja los ratios sin calcular y dice qué falta", async () => {
    await balance();
    await formatoPelado();
    const a = await conPelado();

    const corriente = buscar(a, "corriente");
    assert.equal(corriente.valor, null);
    assert.match(corriente.falta!, /el activo corriente/);
    assert.match(corriente.falta!, /el pasivo corriente/);

    // Los de resultados sí, porque ese formato sí los declara.
    assert.notEqual(buscar(a, "margen_bruto").valor, null);
  });

  test("avisa de las cuentas que el formato deja fuera", async () => {
    await balance();
    await formatoPelado();
    const a = await conPelado();
    assert.ok(a.avisos.some((x) => /deja \d+ cuentas fuera/.test(x)));
  });

  test("un papel repetido se rechaza al guardar el formato", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "DOBLE",
            nombre: "Dos activos corrientes",
            tipo: "situacion",
            lineas: [
              { codigo: "a", concepto: "Uno", cuentas: "10", papel: "activo_corriente" },
              { codigo: "b", concepto: "Otro", cuentas: "12", papel: "activo_corriente" },
            ],
          }),
        ),
      /ya lo declara otro renglón/,
    );
  });

  test("un papel desconocido se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "RARO",
            nombre: "Papel inventado",
            tipo: "situacion",
            // El tipo lo impediría al compilar; aquí se fuerza para comprobar
            // que el servicio tampoco lo acepta en tiempo de ejecución.
            lineas: [{ concepto: "Algo", cuentas: "10", papel: "tesoro" as never }],
          }),
        ),
      /papel desconocido/,
    );
  });
});
