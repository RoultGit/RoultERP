/**
 * Aplicador de migraciones.
 *
 * Deliberadamente simple: lee los `.sql` de `migrations/` en orden alfabético,
 * aplica los que no estén registrados y anota cuáles corrió. No usa el runner
 * de drizzle-kit porque hace falta controlar dos cosas que él no expone: que
 * `9999_rls.sql` se aplique **siempre**, en cada despliegue, y que cada archivo
 * corra dentro de su propia transacción.
 *
 * Que el archivo de RLS se reaplique siempre es lo que hace que una tabla nueva
 * quede protegida sin que nadie tenga que acordarse: el DO block recorre el
 * catálogo y le pone la política.
 */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Dónde están los archivos `.sql`, calculado al usarse y no al importarse.
 *
 * Estaba como constante de módulo, y eso hacía que importar este archivo
 * ejecutara `fileURLToPath(import.meta.url)`. En un archivo empaquetado a
 * CommonJS `import.meta.url` no existe, así que el módulo reventaba nada más
 * cargarlo, sin que nadie hubiera pedido migrar nada.
 *
 * Un módulo no debe hacer trabajo que pueda fallar sólo por importarlo.
 */
const directorioMigraciones = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Se reaplica en cada despliegue en lugar de registrarse una sola vez. */
const SIEMPRE = /^9999_/;

export async function migrar(url: string, opts: { silencioso?: boolean } = {}): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const log = opts.silencioso ? () => {} : (m: string) => console.log(m);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migraciones (
        nombre      text PRIMARY KEY,
        hash        text NOT NULL,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )`;

    const DIR = directorioMigraciones();
    const archivos = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    const aplicadas = new Map(
      (await sql<{ nombre: string; hash: string }[]>`SELECT nombre, hash FROM _migraciones`)
        .map((r) => [r.nombre, r.hash]),
    );

    for (const archivo of archivos) {
      const cuerpo = await readFile(join(DIR, archivo), "utf8");
      const hash = createHash("sha256").update(cuerpo).digest("hex");
      const yaEstaba = aplicadas.get(archivo);
      const reaplicable = SIEMPRE.test(archivo);

      if (yaEstaba && !reaplicable) {
        if (yaEstaba !== hash) {
          // Editar una migración ya aplicada deja las bases de datos de cada
          // entorno con esquemas distintos y sin forma de saberlo. Se corrige
          // con una migración nueva, no editando la vieja.
          throw new Error(
            `la migración ${archivo} cambió después de aplicarse; cree una nueva en su lugar`,
          );
        }
        continue;
      }

      log(`  aplicando ${archivo}${reaplicable ? " (se reaplica siempre)" : ""}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(cuerpo);
        await tx`
          INSERT INTO _migraciones (nombre, hash) VALUES (${archivo}, ${hash})
          ON CONFLICT (nombre) DO UPDATE SET hash = ${hash}, aplicada_en = now()`;
      });
    }
    log("migraciones al día");
  } finally {
    await sql.end();
  }
}
