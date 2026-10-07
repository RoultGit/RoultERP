/**
 * Que no vuelva a entrar SQL construido con cadenas.
 *
 * Tres consultas armaban la lista de un `IN (...)` concatenando texto:
 *
 *     sql`${productos.id} IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)}`
 *
 * En `kits.ts` ese identificador venía de `datos.productoId`, que llega de un
 * formulario. Una comilla dentro deja de ser un valor y pasa a ser SQL. Las tres
 * pasaron a `inArray` y a `= ANY(...::uuid[])`, que parametrizan.
 *
 * Esta prueba lee el código y falla si reaparece el patrón. Es la razón por la
 * que no hace falta correr detrás de la versión de Drizzle: el aviso de
 * seguridad de la librería trata de identificadores mal escapados, y aquí no se
 * construye ninguno. Una comprobación que falla en el acto protege mejor que una
 * versión que escapa bien lo que nunca deberíamos estar escapando.
 *
 * Si algún día hace falta de verdad un identificador dinámico —un orden por una
 * columna que elija el usuario, por ejemplo— esta prueba se interpone a
 * propósito: ese día hay que subir Drizzle a una versión que escape
 * identificadores y decidirlo a conciencia, no descubrirlo en producción.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAICES = [
  join(import.meta.dirname, "..", "src"),
  join(import.meta.dirname, "..", "..", "db", "src"),
  join(import.meta.dirname, "..", "..", "..", "apps", "web", "app"),
  join(import.meta.dirname, "..", "..", "..", "apps", "web", "lib"),
];

function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      salida.push(...fuentes(ruta));
    } else if (/\.tsx?$/.test(e.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/**
 * Lo prohibido.
 *
 * `sql.raw` y `sql.unsafe` meten texto en la consulta sin pasar por un
 * parámetro. `sql.identifier` sí escapa, pero construir un nombre de tabla o
 * columna en tiempo de ejecución es justo lo que el aviso de Drizzle señala: si
 * aparece, hay que pensarlo, no colarlo.
 */
const PROHIBIDO = [
  { patron: /\bsql\s*\.\s*raw\b/, nombre: "sql.raw" },
  { patron: /\bsql\s*\.\s*unsafe\b/, nombre: "sql.unsafe" },
  { patron: /\bsql\s*\.\s*identifier\b/, nombre: "sql.identifier" },
];

test("ninguna consulta construye SQL con cadenas", () => {
  const hallazgos: string[] = [];
  for (const raiz of RAICES) {
    for (const archivo of fuentes(raiz)) {
      // La propia prueba nombra los patrones; no se audita a sí misma.
      if (archivo.endsWith("sin-sql-crudo.test.ts")) continue;
      const lineas = readFileSync(archivo, "utf8").split("\n");
      lineas.forEach((linea, i) => {
        if (linea.trimStart().startsWith("*") || linea.trimStart().startsWith("//")) return;
        for (const { patron, nombre } of PROHIBIDO) {
          if (patron.test(linea)) hallazgos.push(`${archivo}:${i + 1} usa ${nombre}`);
        }
      });
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    `SQL construido con cadenas:\n  ${hallazgos.join("\n  ")}\n\n` +
      "Use inArray/eq/and de Drizzle, o `= ANY(${valores})` en una plantilla sql`…`, " +
      "que mandan el valor como parámetro. Si de verdad hace falta un identificador " +
      "dinámico, hay que subir Drizzle a una versión que los escape y dejarlo escrito " +
      "en docs/SEGURIDAD.md.",
  );
});

test("las listas de ids van parametrizadas donde antes no lo estaban", () => {
  // Las tres que lo hacían mal, por nombre, para que el arreglo no se deshaga.
  const casos = [
    { archivo: join(import.meta.dirname, "..", "src", "kits.ts"), espera: "inArray(productos.id" },
    {
      archivo: join(import.meta.dirname, "..", "src", "requisiciones.ts"),
      espera: "inArray(cotizacionProveedorItems.cotizacionId",
    },
    {
      archivo: join(import.meta.dirname, "..", "src", "planilla-rrhh.ts"),
      espera: "= ANY(",
    },
  ];
  for (const { archivo, espera } of casos) {
    const fuente = readFileSync(archivo, "utf8");
    assert.ok(fuente.includes(espera), `${archivo} debería usar ${espera}`);
  }
});
