/**
 * Datos de la propia empresa.
 *
 * Lo que se fija aquí es el freno: el método de valorización no se cambia con
 * movimientos en el kardex. Sin él, un desplegable reescribiría el costo de
 * ventas de meses ya declarados.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, ajustesDeEmpresa, guardarAjustesEmpresa, EmpresaInvalida,
  registrarMovimiento,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let productoId = "";

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR S.A.C." },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;
  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga 2HP', ${unidad!.id})
    RETURNING id`;
  productoId = p!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

describe("ajustes de la empresa", () => {
  test("guarda lo que el cliente respondió en el cuestionario", async () => {
    await con((db) =>
      guardarAjustesEmpresa(db, empresaId, {
        direccion: "AV. PRINCIPAL 263, URB. LOS JARDINES",
        ubigeo: "180101",
        cuentaDetracciones: "00-000-000000",
        esAgenteRetencion: false,
        esAgentePercepcion: false,
        metodoValorizacion: "promedio",
      }),
    );
    const e = await con((db) => ajustesDeEmpresa(db, empresaId));
    assert.equal(e.cuentaDetracciones, "00-000-000000");
    assert.equal(e.ubigeo, "180101");
    assert.equal(e.esAgenteRetencion, false);
    assert.equal(e.metodoValorizacion, "promedio");
  });

  test("un ubigeo corto se rechaza aquí y no en la GRE", async () => {
    // La API de la guía electrónica lo rebota con un error que no dice qué
    // campo está mal, y para entonces la mercadería ya está en el camión.
    await assert.rejects(
      () => con((db) => guardarAjustesEmpresa(db, empresaId, { ubigeo: "18010" })),
      EmpresaInvalida,
    );
  });

  test("el método de valorización se congela en cuanto hay kardex", async () => {
    // Antes del primer movimiento sí se puede elegir.
    await con((db) => guardarAjustesEmpresa(db, empresaId, { metodoValorizacion: "peps" }));
    assert.equal((await con((db) => ajustesDeEmpresa(db, empresaId))).metodoValorizacion, "peps");

    await con((db) =>
      registrarMovimiento(db, empresaId, {
        almacenId, productoId, fecha: "2026-09-01", sentido: "ingreso",
        tipoOperacion: "ajuste_inicial",
        cantidad: money.dec("10"), costoUnitario: money.dec("100"),
      }),
    );

    await assert.rejects(
      () => con((db) => guardarAjustesEmpresa(db, empresaId, { metodoValorizacion: "promedio" })),
      (e: unknown) =>
        e instanceof EmpresaInvalida && /costo de ventas de periodos ya declarados/.test(e.message),
      "cambiarlo recostearía salidas ya declaradas",
    );

    // Guardar lo demás sigue funcionando, y reenviar el mismo método no es un
    // cambio: el formulario manda el desplegable entero en cada envío.
    await con((db) =>
      guardarAjustesEmpresa(db, empresaId, {
        metodoValorizacion: "peps",
        cuentaDetracciones: "00-000-000000",
      }),
    );
    assert.equal(
      (await con((db) => ajustesDeEmpresa(db, empresaId))).cuentaDetracciones,
      "00-000-000000",
    );
  });

  test("una cuenta de detracciones con letras se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarAjustesEmpresa(db, empresaId, { cuentaDetracciones: "cuenta del banco" }),
        ),
      EmpresaInvalida,
    );
  });
});
