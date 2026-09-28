/**
 * Conexión a la base de datos y contexto de la petición.
 *
 * Dos pools con dos roles distintos, y esa separación es parte de la seguridad,
 * no una comodidad:
 *
 *   `auth`  Sólo alcanza las tablas de identidad. Es el que usa el login, que
 *           por definición trabaja antes de saber a qué empresa entra nadie.
 *           No tiene permiso sobre ninguna tabla de negocio.
 *
 *   `app`   Todo lo demás, siempre con RLS aplicado. Cada operación pasa por
 *           `enEmpresa`, que abre una transacción y fija el contexto con
 *           `SET LOCAL`. No hay forma de consultar datos de negocio sin haber
 *           declarado en nombre de qué empresa y de qué usuario se hace.
 *
 * `SET LOCAL` y no `SET`: el valor muere con la transacción. Con un pool de
 * conexiones, un `SET` a secas dejaría la empresa pegada a la conexión y la
 * siguiente petición que la reutilice heredaría el contexto de la anterior.
 * Es la forma más silenciosa que existe de filtrar datos entre empresas.
 *
 * Cada transacción empieza además con `SET LOCAL ROLE`, que degrada los
 * privilegios sea cual sea el rol con el que se conectó el pool. Importa porque
 * en Supabase se conecta uno como `postgres`, que tiene BYPASSRLS: sin este
 * paso, RLS no se aplicaría y todas las políticas de este esquema serían
 * decorativas. Al hacerlo aquí, la seguridad no depende de que alguien
 * aprovisione bien las credenciales.
 */
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export type Db = PostgresJsDatabase<typeof schema>;

export type Contexto = {
  empresaId: string;
  usuarioId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirUuid(v: string, campo: string): string {
  // Estos valores acaban dentro de `set_config`. Validarlos antes de llegar ahí
  // es la diferencia entre un parámetro y una inyección.
  if (!UUID.test(v)) throw new TypeError(`${campo} no es un UUID válido`);
  return v;
}

export type OpcionesConexion = {
  url: string;
  /** Rol con el que conectarse. Determina qué puede ver esta conexión. */
  rol: "app" | "auth";
  max?: number;
};

/**
 * La zona horaria de la empresa. **No es negociable y no se hereda del servidor.**
 *
 * Perú es UTC−5 todo el año: no hay horario de verano, así que no hay salto que
 * gestionar. Lo que sí hay es un servidor en la nube que corre en UTC, y
 * entonces `current_date` devuelve el día siguiente desde las 19:00 hora de
 * Lima. Eso fecha las facturas de la tarde del 30 en el mes siguiente: periodo
 * tributario equivocado y correlativo fuera de orden cronológico, que es lo que
 * SUNAT rechaza.
 *
 * Fijarla en la conexión resuelve de una vez los `current_date`, los `now()` y
 * todas las conversiones a `date` de las consultas, sin que cada una tenga que
 * acordarse.
 */
export const ZONA_HORARIA = "America/Lima";

/**
 * Abre un pool.
 *
 * `transform: undefined` a propósito: los `numeric` llegan como texto y así
 * deben quedarse. El driver los convertiría a `number` de JavaScript, que es
 * exactamente lo que `core/money.ts` existe para evitar.
 */
export function conectar(opts: OpcionesConexion) {
  const rol = opts.rol === "app" ? "roulterp_app" : "roulterp_auth";
  const cliente = postgres(opts.url, {
    max: opts.max ?? 10,
    prepare: false, // compatible con los pooler en modo transacción
    connection: { application_name: `roulterp_${opts.rol}`, TimeZone: ZONA_HORARIA },
    onnotice: () => {},
  });
  const db = drizzle(cliente, { schema });
  return { cliente, db, rol };
}

export type Conexion = ReturnType<typeof conectar>;

/**
 * Ejecuta trabajo dentro de una transacción con el contexto de empresa fijado.
 *
 * Es el único camino por el que la aplicación debe tocar datos de negocio. Todo
 * lo que ocurra dentro ve exactamente las filas de esa empresa; el resto del
 * sistema, para esta transacción, no existe.
 */
export async function enEmpresa<T>(
  conexion: Conexion,
  ctx: Contexto,
  trabajo: (db: Db) => Promise<T>,
): Promise<T> {
  if (conexion.rol !== "roulterp_app") {
    throw new Error("enEmpresa exige el rol de aplicación, no el de autenticación");
  }
  const empresaId = exigirUuid(ctx.empresaId, "empresaId");
  const usuarioId = exigirUuid(ctx.usuarioId, "usuarioId");

  return conexion.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roulterp_app`);
    // `true` en el tercer argumento de set_config = local a la transacción.
    await tx.execute(sql`
      SELECT set_config('app.empresa_id', ${empresaId}, true),
             set_config('app.usuario_id', ${usuarioId}, true)`);
    return trabajo(tx as unknown as Db);
  });
}

/**
 * Transacción del camino de autenticación, sin empresa activa.
 *
 * Fija `app.usuario_id` cuando ya se sabe quién es, para que la bitácora pueda
 * atribuir el evento, pero nunca una empresa: en este punto todavía no se ha
 * elegido ninguna.
 */
export async function enAuth<T>(
  conexion: Conexion,
  trabajo: (db: Db) => Promise<T>,
  usuarioId?: string,
): Promise<T> {
  if (conexion.rol !== "roulterp_auth") {
    throw new Error("enAuth exige el rol de autenticación");
  }
  return conexion.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roulterp_auth`);
    if (usuarioId) {
      await tx.execute(
        sql`SELECT set_config('app.usuario_id', ${exigirUuid(usuarioId, "usuarioId")}, true)`,
      );
    }
    return trabajo(tx as unknown as Db);
  });
}

export { schema };
