/**
 * Cuentas de integración.
 *
 * Lo que se comprueba es que la configuración **llegue al asiento**: cambiar la
 * cuenta de ventas y que el asiento de la siguiente venta la use. Una pantalla
 * de configuración que no cambia nada es peor que no tenerla, porque el
 * contador cree que ajustó algo.
 *
 * Y lo segundo: que una cuenta imposible se rechace al configurar y no al
 * contabilizar. Un asiento contra una cuenta de agrupación revienta la
 * operación de un usuario que no puso nada mal.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, balanceComprobacion,
  listarParametrosContables, guardarParametrosContables, cuentasDe, PARAMETROS_CONTABLES,
  ParametroInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
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

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true) RETURNING id`;
  cliente = c!.id;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [prod] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga', ${u!.id}) RETURNING id`;
  producto = prod!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;

  await enEmpresa(app, { empresaId, usuarioId }, (db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: p!.id, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-08-01", moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "50", valorUnitario: "300" }],
    }),
  );
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

const vender = () =>
  con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-01",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "10", valorUnitario: "500" }],
    }),
  );

const saldo = async (cuenta: string) => {
  const balance = await con((db) => balanceComprobacion(db, "202609"));
  return s2(balance.find((b) => b.cuenta === cuenta)?.saldo ?? "0");
};

// ─── El valor de partida ──────────────────────────────────────────────────

describe("sin configurar nada", () => {
  /**
   * Una empresa que nunca abrió la pantalla tiene que comportarse como antes de
   * que la pantalla existiera. Por eso la tabla guarda sólo las excepciones.
   */
  test("usa las cuentas del plan general y no guarda nada", async () => {
    const lista = await con((db) => listarParametrosContables(db));
    assert.equal(lista.length, PARAMETROS_CONTABLES.length);
    assert.ok(lista.every((p) => !p.personalizada));
    assert.equal(lista.find((p) => p.clave === "ventas_mercaderia")!.cuenta, "70111");

    const [fila] = (await raw`
      SELECT count(*)::int AS n FROM parametros_contables WHERE empresa_id = ${empresaId}`) as [
      { n: number },
    ];
    assert.equal(fila.n, 0, "sin cambios no hay filas que mantener");
  });

  test("cada parámetro apunta a una cuenta que existe en el plan", async () => {
    const lista = await con((db) => listarParametrosContables(db));
    const huerfanos = lista.filter((p) => p.descripcionCuenta === null);
    assert.deepEqual(
      huerfanos.map((p) => `${p.clave} → ${p.cuenta}`),
      [],
      "un valor de partida que no está en el plan rompería el primer asiento",
    );
  });
});

// ─── El cambio llega al asiento ───────────────────────────────────────────

describe("cambiar una cuenta", () => {
  test("la venta se contabiliza contra la cuenta configurada", async () => {
    await con((db) =>
      guardarParametrosContables(db, empresaId, usuarioId, { ventas_mercaderia: "70911" }),
    );

    await vender();
    // 10 × 500 al ingreso, ahora en la cuenta elegida.
    assert.equal(await saldo("70911"), "-5000.00");
    assert.equal(await saldo("70111"), "0.00", "la cuenta de partida ya no se usa");
  });

  test("el resolvedor devuelve lo configurado y lo de partida para el resto", async () => {
    await con((db) =>
      guardarParametrosContables(db, empresaId, usuarioId, { clientes: "1232" }),
    );
    const cuentas = await con((db) => cuentasDe(db));
    assert.equal(cuentas.get("clientes"), "1232");
    assert.equal(cuentas.get("igv_ventas"), "40111");
  });

  test("volver a la cuenta de partida borra la excepción", async () => {
    await con((db) =>
      guardarParametrosContables(db, empresaId, usuarioId, { ventas_mercaderia: "70911" }),
    );
    await con((db) =>
      guardarParametrosContables(db, empresaId, usuarioId, { ventas_mercaderia: "70111" }),
    );

    const [fila] = (await raw`
      SELECT count(*)::int AS n FROM parametros_contables WHERE empresa_id = ${empresaId}`) as [
      { n: number },
    ];
    assert.equal(fila.n, 0, "si vuelve a ser la de partida, se sigue al catálogo");
  });

  test("el asiento sigue cuadrando con las cuentas cambiadas", async () => {
    await con((db) =>
      guardarParametrosContables(db, empresaId, usuarioId, {
        ventas_mercaderia: "70911",
        clientes: "1232",
      }),
    );
    await vender();

    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");
  });
});

// ─── Lo que no se acepta ──────────────────────────────────────────────────

describe("cuentas que no se aceptan", () => {
  /** Rechazar al configurar, no al contabilizar: ahí ya no está quien la puso. */
  test("una cuenta que no está en el plan se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarParametrosContables(db, empresaId, usuarioId, { ventas_mercaderia: "99999" }),
        ),
      /no está en el plan/,
    );
  });

  /**
   * Quien decide si una cuenta recibe asientos es el plan, no su largo. Con la
   * regla del número de dígitos, la pantalla rechazaba sus propios valores de
   * partida: la 759, la 776 y la 676 tienen tres y sí admiten movimiento.
   */
  test("guardar el catálogo entero tal como viene no da ningún error", async () => {
    const lista = await con((db) => listarParametrosContables(db));
    const todos = Object.fromEntries(lista.map((p) => [p.clave, p.cuenta]));
    await con((db) => guardarParametrosContables(db, empresaId, usuarioId, todos));

    const [fila] = (await raw`
      SELECT count(*)::int AS n FROM parametros_contables WHERE empresa_id = ${empresaId}`) as [
      { n: number },
    ];
    assert.equal(fila.n, 0, "guardar los valores de partida no deja excepciones");
  });

  test("una cuenta de agrupación se rechaza con su motivo", async () => {
    await assert.rejects(
      () =>
        con((db) => guardarParametrosContables(db, empresaId, usuarioId, { clientes: "121" })),
      /no admite movimiento/,
    );
  });

  test("un parámetro inventado se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarParametrosContables(db, empresaId, usuarioId, { cuenta_secreta: "70111" }),
        ),
      /no existe/,
    );
  });

  test("nada se guarda si una sola cuenta está mal", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarParametrosContables(db, empresaId, usuarioId, {
            ventas_mercaderia: "70911",
            clientes: "121",
          }),
        ),
      /no admite movimiento/,
    );
    const cuentas = await con((db) => cuentasDe(db));
    assert.equal(cuentas.get("ventas_mercaderia"), "70111", "la buena tampoco se guardó");
  });
});
