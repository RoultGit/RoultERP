/**
 * Piezas compartidas por todo el esquema.
 *
 * Dos convenciones que valen para cada tabla del sistema:
 *
 * - Los importes son `numeric(18,6)` y se leen y escriben como texto. El driver
 *   de Postgres convertiría un `numeric` a `number` de JavaScript, que es
 *   exactamente el error que `packages/core/money.ts` existe para evitar.
 *
 * - Toda tabla de negocio lleva `empresa_id`. No es un campo más: la migración
 *   de RLS recorre el catálogo buscando esa columna y le aplica la política de
 *   aislamiento. Una tabla de negocio sin `empresa_id` queda sin protección, y
 *   hay una prueba que lo detecta.
 */
import { sql } from "drizzle-orm";
import { numeric, timestamp, uuid, text } from "drizzle-orm/pg-core";

/** Escala de `packages/core/money.ts`. Cambiar una obliga a cambiar la otra. */
export const ESCALA = 6;

/**
 * Importe monetario o cantidad.
 *
 * `numeric` de drizzle se lee y escribe como texto, que es justo lo que hace
 * falta: convertirlo a `number` de JavaScript perdería precisión antes de que
 * `core/money.ts` pudiera hacer nada. Hay una prueba que lo verifica contra la
 * base real, porque es la clase de garantía que se rompe en silencio al subir
 * una versión del driver.
 */
export const importe = (nombre: string) =>
  numeric(nombre, { precision: 18, scale: ESCALA });

/** Importe que no puede faltar; por defecto cero, nunca nulo. */
export const importeCero = (nombre: string) => importe(nombre).notNull().default("0");

export const id = () => uuid("id").primaryKey().defaultRandom();

export const empresaId = () => uuid("empresa_id").notNull();

export const creadoEn = () =>
  timestamp("creado_en", { withTimezone: true }).notNull().defaultNow();

export const actualizadoEn = () =>
  timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow();

/** Quién creó el registro. Nulo sólo en datos sembrados por el sistema. */
export const creadoPor = () => uuid("creado_por");

/** Columnas de auditoría que lleva toda tabla transaccional. */
export const auditoria = () => ({
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
  creadoPor: creadoPor(),
});

/**
 * Empresa activa de la transacción en curso.
 *
 * La aplicación la fija con `SET LOCAL app.empresa_id`. Las políticas de RLS
 * comparan contra esto. El segundo argumento `true` hace que devuelva NULL en
 * vez de lanzar cuando no está fijada, y como `columna = NULL` es NULL —nunca
 * verdadero—, olvidar el `SET LOCAL` deja al usuario sin ver ninguna fila. El
 * fallo abierto habría sido devolverlas todas.
 */
export const empresaActual = sql`current_setting('app.empresa_id', true)::uuid`;

export const usuarioActual = sql`current_setting('app.usuario_id', true)::uuid`;

/** Moneda ISO 4217. Tres letras, siempre en mayúsculas. */
export const moneda = (nombre = "moneda") => text(nombre).notNull();
