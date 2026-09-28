/**
 * Numeración de los documentos internos.
 *
 * A diferencia del correlativo de un comprobante, a estos no los fiscaliza
 * nadie: un salto en la numeración de requisiciones no es una infracción. Por
 * eso basta con mirar el máximo del año en vez de mantener un contador, y no
 * hace falta el `UPDATE ... RETURNING` que sí exige una factura.
 *
 * El formato —`REQ2026-000001`— es el que usa Starsoft y el que el cliente lee
 * sin pensar: prefijo, año y seis dígitos.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@roulterp/db";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

export async function siguienteNumero(
  db: Db,
  tabla: PgTable,
  columna: PgColumn,
  prefijo: string,
  anio: string,
): Promise<string> {
  const [fila] = await db
    .select({ ultimo: sql<string | null>`max(${columna})` })
    .from(tabla)
    .where(sql`${columna} LIKE ${`${prefijo}${anio}-%`}`);
  const correlativo = fila?.ultimo ? Number(fila.ultimo.slice(-6)) + 1 : 1;
  return `${prefijo}${anio}-${String(correlativo).padStart(6, "0")}`;
}
