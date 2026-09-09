/**
 * Pruebas de aislamiento entre empresas.
 *
 * Son las pruebas más importantes del repositorio. Todo lo demás produce
 * números equivocados cuando falla; esto produce que una empresa vea la
 * contabilidad de otra, que es el único fallo del que un SaaS de ERP no se
 * recupera.
 *
 * Corren contra un Postgres real porque RLS es una característica del motor: un
 * doble de prueba no demostraría nada.
 *
 *   createdb roulterp_test
 *   DATABASE_URL=postgres://localhost/roulterp_test npm test -w @roulterp/db
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { conectar, enEmpresa, enAuth, type Conexion } from "../src/cliente.ts";
import { migrar } from "../src/migrate.ts";
import * as s from "../src/schema/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let auth: Conexion;

/** Empresa A y empresa B, cada una con su usuario. */
const ids = {
  empresaA: "",
  empresaB: "",
  usuarioA: "",
  usuarioB: "",
  almacenA: "",
  almacenB: "",
};

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  app = conectar({ url: URL, rol: "app", max: 4 });
  auth = conectar({ url: URL, rol: "auth", max: 2 });

  // Se siembra con privilegios plenos: crear empresas es tarea del operador del
  // SaaS, no de un usuario dentro de una empresa.
  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;

  const [ea] = await raw<{ id: string }[]>`
    INSERT INTO empresas (ruc, razon_social) VALUES ('20303051831', 'SERVIDIMAR')
    RETURNING id`;
  const [eb] = await raw<{ id: string }[]>`
    INSERT INTO empresas (ruc, razon_social) VALUES ('20100000001', 'OTRA EMPRESA')
    RETURNING id`;
  ids.empresaA = ea!.id;
  ids.empresaB = eb!.id;

  const [ua] = await raw<{ id: string }[]>`
    INSERT INTO usuarios (email, password_hash, nombre)
    VALUES ('ana@servidimar.pe', 'x', 'Ana') RETURNING id`;
  const [ub] = await raw<{ id: string }[]>`
    INSERT INTO usuarios (email, password_hash, nombre)
    VALUES ('beto@otra.pe', 'x', 'Beto') RETURNING id`;
  ids.usuarioA = ua!.id;
  ids.usuarioB = ub!.id;

  for (const [empresaId, usuarioId] of [
    [ids.empresaA, ids.usuarioA],
    [ids.empresaB, ids.usuarioB],
  ] as const) {
    const [rol] = await raw<{ id: string }[]>`
      INSERT INTO roles (empresa_id, codigo, nombre, permisos, es_sistema)
      VALUES (${empresaId}, 'admin', 'Administrador', ARRAY['maestros:ver'], true)
      RETURNING id`;
    await raw`
      INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id)
      VALUES (${usuarioId}, ${empresaId}, ${rol!.id})`;
  }

  const [aa] = await raw<{ id: string }[]>`
    INSERT INTO almacenes (empresa_id, codigo, nombre)
    VALUES (${ids.empresaA}, 'A01', 'Almacén central A') RETURNING id`;
  const [ab] = await raw<{ id: string }[]>`
    INSERT INTO almacenes (empresa_id, codigo, nombre)
    VALUES (${ids.empresaB}, 'B01', 'Almacén central B') RETURNING id`;
  ids.almacenA = aa!.id;
  ids.almacenB = ab!.id;
});

after(async () => {
  await raw?.end();
  await app?.cliente.end();
  await auth?.cliente.end();
});

const ctxA = () => ({ empresaId: ids.empresaA, usuarioId: ids.usuarioA });
const ctxB = () => ({ empresaId: ids.empresaB, usuarioId: ids.usuarioB });

describe("aislamiento entre empresas", () => {
  test("cada empresa ve sólo sus propios almacenes", async () => {
    const desdeA = await enEmpresa(app, ctxA(), (db) => db.select().from(s.almacenes));
    const desdeB = await enEmpresa(app, ctxB(), (db) => db.select().from(s.almacenes));

    assert.equal(desdeA.length, 1);
    assert.equal(desdeA[0]!.codigo, "A01");
    assert.equal(desdeB.length, 1);
    assert.equal(desdeB[0]!.codigo, "B01");
  });

  test("una consulta sin filtro por empresa no devuelve filas ajenas", async () => {
    // Esto es exactamente el bug que RLS existe para neutralizar: un SELECT al
    // que se le olvidó el WHERE. Devuelve lo propio, no todo.
    const filas = await enEmpresa(app, ctxA(), (db) =>
      db.execute(sql`SELECT codigo FROM almacenes`),
    );
    assert.equal(filas.length, 1);
    assert.equal((filas[0] as { codigo: string }).codigo, "A01");
  });

  test("buscar por el id de un almacén ajeno devuelve vacío, no un error", async () => {
    const filas = await enEmpresa(app, ctxA(), (db) =>
      db.execute(sql`SELECT * FROM almacenes WHERE id = ${ids.almacenB}`),
    );
    assert.equal(filas.length, 0, "el almacén de la otra empresa no existe para A");
  });

  test("no se puede insertar una fila marcada con otra empresa", async () => {
    await assert.rejects(
      () =>
        enEmpresa(app, ctxA(), (db) =>
          db.insert(s.almacenes).values({
            empresaId: ids.empresaB,
            codigo: "INTRUSO",
            nombre: "Almacén colado",
          }),
        ),
      /row-level security|violates/i,
      "WITH CHECK debe impedir escribir en la empresa ajena",
    );
  });

  test("no se puede mover una fila propia a otra empresa", async () => {
    await assert.rejects(
      () =>
        enEmpresa(app, ctxA(), (db) =>
          db.execute(
            sql`UPDATE almacenes SET empresa_id = ${ids.empresaB} WHERE id = ${ids.almacenA}`,
          ),
        ),
      /row-level security|violates/i,
    );
  });

  test("un UPDATE sin filtro no toca las filas de la otra empresa", async () => {
    await enEmpresa(app, ctxA(), (db) =>
      db.execute(sql`UPDATE almacenes SET nombre = 'Renombrado por A'`),
    );
    const b = await enEmpresa(app, ctxB(), (db) => db.select().from(s.almacenes));
    assert.equal(b[0]!.nombre, "Almacén central B", "B no debió cambiar");
  });

  test("un DELETE sin filtro no borra las filas de la otra empresa", async () => {
    await enEmpresa(app, ctxA(), (db) => db.execute(sql`DELETE FROM almacenes`));
    const b = await enEmpresa(app, ctxB(), (db) => db.select().from(s.almacenes));
    assert.equal(b.length, 1, "el almacén de B sigue ahí");
    // Se restaura para las pruebas que siguen.
    await raw`INSERT INTO almacenes (id, empresa_id, codigo, nombre)
              VALUES (${ids.almacenA}, ${ids.empresaA}, 'A01', 'Almacén central A')`;
  });

  test("sin empresa fijada no se ve absolutamente nada", async () => {
    // El fallo seguro es hacia el cierre: `columna = NULL` es NULL, nunca
    // verdadero, así que olvidar el SET LOCAL deja al usuario a ciegas en vez
    // de mostrarle todas las empresas.
    const filas = await app.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE roulterp_app`);
      return tx.execute(sql`SELECT * FROM almacenes`);
    });
    assert.equal(filas.length, 0);
  });

  test("la empresa activa no se filtra entre transacciones del pool", async () => {
    // Con `SET` en vez de `SET LOCAL`, la conexión reutilizada heredaría la
    // empresa de la petición anterior. Se fuerza el escenario en serie sobre un
    // pool de una sola conexión.
    const solo = conectar({ url: URL, rol: "app", max: 1 });
    try {
      await enEmpresa(solo, ctxB(), (db) => db.select().from(s.almacenes));
      const filas = await solo.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE roulterp_app`);
        return tx.execute(sql`SELECT * FROM almacenes`);
      });
      assert.equal(filas.length, 0, "la empresa anterior no debe seguir fijada");
    } finally {
      await solo.cliente.end();
    }
  });

  test("la empresa sólo se ve a sí misma en la tabla de empresas", async () => {
    const desdeA = await enEmpresa(app, ctxA(), (db) => db.select().from(s.empresas));
    assert.equal(desdeA.length, 1);
    assert.equal(desdeA[0]!.ruc, "20303051831");
  });

  test("un empresaId que no es UUID se rechaza antes de tocar la base", async () => {
    await assert.rejects(
      () =>
        enEmpresa(
          app,
          { empresaId: "' OR '1'='1", usuarioId: ids.usuarioA },
          (db) => db.select().from(s.almacenes),
        ),
      TypeError,
    );
  });
});

describe("separación de privilegios entre roles", () => {
  test("el rol de autenticación no puede leer datos de negocio", async () => {
    await assert.rejects(
      () => enAuth(auth, (db) => db.execute(sql`SELECT * FROM almacenes`)),
      /permission denied|permiso denegado/i,
      "una falla en el login no debe alcanzar ni una factura",
    );
  });

  test("el rol de autenticación tampoco alcanza los asientos contables", async () => {
    await assert.rejects(
      () => enAuth(auth, (db) => db.execute(sql`SELECT * FROM asientos`)),
      /permission denied|permiso denegado/i,
    );
  });

  test("el rol de aplicación no puede tocar el contador de intentos de login", async () => {
    await assert.rejects(
      () => enEmpresa(app, ctxA(), (db) => db.execute(sql`SELECT * FROM intentos_login`)),
      /permission denied|permiso denegado/i,
    );
  });

  test("enEmpresa rechaza una conexión con el rol equivocado", async () => {
    await assert.rejects(() => enEmpresa(auth, ctxA(), async () => null), /rol de aplicación/);
    await assert.rejects(() => enAuth(app, async () => null), /rol de autenticación/);
  });

  test("ninguno de los dos roles tiene BYPASSRLS", async () => {
    const filas = await raw<{ rolname: string; rolbypassrls: boolean }[]>`
      SELECT rolname, rolbypassrls FROM pg_roles
      WHERE rolname IN ('roulterp_app', 'roulterp_auth')`;
    assert.equal(filas.length, 2);
    for (const r of filas) {
      assert.equal(r.rolbypassrls, false, `${r.rolname} no debe poder saltarse RLS`);
    }
  });
});

describe("cobertura de las políticas", () => {
  test("toda tabla con empresa_id tiene RLS habilitado y forzado", async () => {
    const sinProteger = await raw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'empresa_id'
        AND NOT a.attisdropped
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`;
    assert.deepEqual(
      sinProteger.map((r) => r.relname),
      [],
      "hay tablas de negocio sin aislamiento; vuelva a aplicar 9999_rls.sql",
    );
  });

  test("toda tabla con empresa_id tiene al menos una política", async () => {
    const sinPolitica = await raw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND a.attname = 'empresa_id' AND NOT a.attisdropped
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`;
    assert.deepEqual(sinPolitica.map((r) => r.relname), []);
  });

  test("las tablas de identidad también están protegidas", async () => {
    const filas = await raw<{ relname: string; rls: boolean; forzado: boolean }[]>`
      SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forzado
      FROM pg_class
      WHERE relname IN ('usuarios','sesiones','usuario_empresa','tokens_un_uso',
                        'intentos_login','empresas','auditoria','tipo_cambio')`;
    assert.equal(filas.length, 8);
    for (const f of filas) {
      assert.equal(f.rls, true, `${f.relname} sin RLS`);
      assert.equal(f.forzado, true, `${f.relname} sin FORCE`);
    }
  });
});

describe("libros inmutables", () => {
  let asientoId = "";

  before(async () => {
    const [a] = await raw<{ id: string }[]>`
      INSERT INTO asientos (empresa_id, periodo, numero, fecha, subdiario, glosa, moneda, estado)
      VALUES (${ids.empresaA}, '202609', '0001', '2026-09-09', '08', 'Compra', 'PEN', 'contabilizado')
      RETURNING id`;
    asientoId = a!.id;
  });

  test("un asiento contabilizado no se puede borrar", async () => {
    await assert.rejects(
      () => enEmpresa(app, ctxA(), (db) => db.execute(sql`DELETE FROM asientos WHERE id = ${asientoId}`)),
      /no se borran/,
    );
  });

  test("un asiento contabilizado no se puede editar", async () => {
    await assert.rejects(
      () =>
        enEmpresa(app, ctxA(), (db) =>
          db.execute(sql`UPDATE asientos SET glosa = 'alterada' WHERE id = ${asientoId}`),
        ),
      /ya está contabilizado/,
    );
  });

  test("sí se puede pasar a extornado, y sólo el estado cambia", async () => {
    await enEmpresa(app, ctxA(), (db) =>
      db.execute(sql`UPDATE asientos SET estado = 'extornado' WHERE id = ${asientoId}`),
    );
    const [fila] = await raw<{ estado: string; glosa: string }[]>`
      SELECT estado, glosa FROM asientos WHERE id = ${asientoId}`;
    assert.equal(fila!.estado, "extornado");
    assert.equal(fila!.glosa, "Compra", "la glosa no debió tocarse");
  });

  test("un borrador sí se puede corregir", async () => {
    const [b] = await raw<{ id: string }[]>`
      INSERT INTO asientos (empresa_id, periodo, numero, fecha, subdiario, glosa, moneda, estado)
      VALUES (${ids.empresaA}, '202609', '0002', '2026-09-09', '08', 'Borrador', 'PEN', 'borrador')
      RETURNING id`;
    await enEmpresa(app, ctxA(), (db) =>
      db.execute(sql`UPDATE asientos SET glosa = 'Corregida' WHERE id = ${b!.id}`),
    );
    const [fila] = await raw<{ glosa: string }[]>`SELECT glosa FROM asientos WHERE id = ${b!.id}`;
    assert.equal(fila!.glosa, "Corregida");
  });

  test("los movimientos de inventario no se borran", async () => {
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO unidades_medida (empresa_id, codigo, nombre)
      VALUES (${ids.empresaA}, 'NIU', 'Unidad') RETURNING id`;
    const [prod] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
      VALUES (${ids.empresaA}, 'P001', 'Producto', ${p!.id}) RETURNING id`;
    const [mov] = await raw<{ id: string }[]>`
      INSERT INTO movimientos_inventario
        (empresa_id, almacen_id, producto_id, fecha, orden, sentido, tipo_operacion,
         cantidad, costo_unitario, importe_total)
      VALUES (${ids.empresaA}, ${ids.almacenA}, ${prod!.id}, '2026-09-09', 1, 'ingreso', '02',
              '10', '5', '50')
      RETURNING id`;
    await assert.rejects(
      () =>
        enEmpresa(app, ctxA(), (db) =>
          db.execute(sql`DELETE FROM movimientos_inventario WHERE id = ${mov!.id}`),
        ),
      /no se borran/,
    );
  });
});

describe("bitácora de auditoría", () => {
  test("se puede insertar y leer, pero no modificar ni borrar", async () => {
    await enEmpresa(app, ctxA(), (db) =>
      db.insert(s.auditoriaLog).values({
        empresaId: ids.empresaA,
        usuarioId: ids.usuarioA,
        tabla: "almacenes",
        accion: "insertar",
      }),
    );

    const propias = await enEmpresa(app, ctxA(), (db) => db.select().from(s.auditoriaLog));
    assert.ok(propias.length >= 1);

    await assert.rejects(
      () => enEmpresa(app, ctxA(), (db) => db.execute(sql`UPDATE auditoria SET accion = 'x'`)),
      /permission denied|permiso denegado/i,
      "una bitácora que se puede editar no prueba nada",
    );
    await assert.rejects(
      () => enEmpresa(app, ctxA(), (db) => db.execute(sql`DELETE FROM auditoria`)),
      /permission denied|permiso denegado/i,
    );
  });

  test("la bitácora de una empresa no es visible desde la otra", async () => {
    const desdeB = await enEmpresa(app, ctxB(), (db) => db.select().from(s.auditoriaLog));
    assert.equal(desdeB.length, 0);
  });
});
