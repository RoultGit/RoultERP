/**
 * Las migraciones, desde la línea de órdenes.
 *
 * Vive aparte de `migrate.ts` por una razón que costó encontrar: el módulo
 * tenía al final el idioma habitual
 *
 *   if (import.meta.url === `file://${process.argv[1]}`) { … }
 *
 * que funciona mientras el archivo se ejecute con su propio nombre. Al
 * empaquetarlo todo en un solo archivo —lo que hace el programa de alta de
 * empresas dentro del contenedor— esa igualdad se cumple por accidente, y
 * **importar el módulo lanzaba las migraciones**.
 *
 * Un módulo no debe hacer nada al importarse. El punto de entrada es esto.
 */
import { migrar } from "./migrate.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("falta DATABASE_URL");
  process.exit(1);
}
await migrar(url);
