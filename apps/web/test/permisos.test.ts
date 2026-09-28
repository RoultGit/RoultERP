/**
 * Que ninguna acción hacia fuera se quede sin comprobar el permiso.
 *
 * Las acciones que hablan con SUNAT no pueden usar `conEmpresa` —una llamada
 * que tarda un minuto no debe retener una conexión del pool—, así que reciben
 * la conexión y abren sus propias transacciones. Al hacerlo se saltan la
 * comprobación de permiso que `conEmpresa` hace por dentro, y durante un tiempo
 * se quedaron sólo con `exigirEmpresa()`: protegidas por RLS, pero disparables
 * por cualquiera con sesión, incluido el rol de sólo consulta.
 *
 * Informar a SUNAT no se deshace: una vez aceptado, está declarado. Esta prueba
 * lee el código y falla si vuelve a aparecer una acción sin permiso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "app");

function archivosDeAcciones(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosDeAcciones(ruta));
    else if (e.name === "acciones.ts") salida.push(ruta);
  }
  return salida;
}

test("toda acción que abre la conexión a mano comprueba el permiso", () => {
  const sinPermiso: string[] = [];

  for (const ruta of archivosDeAcciones(RAIZ)) {
    const src = readFileSync(ruta, "utf8");
    // Sólo interesan las que esquivan `conEmpresa` usando la conexión directa.
    if (!src.includes("conexionApp")) continue;

    for (const m of src.matchAll(/export async function (\w+)\(/g)) {
      const desde = m.index!;
      const hasta = src.indexOf("\nexport ", desde + 1);
      const cuerpo = src.slice(desde, hasta === -1 ? undefined : hasta);
      if (!cuerpo.includes("conexionApp")) continue;

      const protegida =
        cuerpo.includes("exigirEmpresaCon(") || /conEmpresa\([\s\S]*?"[a-z_]+:[a-z]+"/.test(cuerpo);
      if (!protegida) {
        sinPermiso.push(`${ruta.slice(RAIZ.length + 1)} → ${m[1]}`);
      }
    }
  }

  assert.deepEqual(
    sinPermiso,
    [],
    `estas acciones tocan la conexión sin comprobar permiso:\n  ${sinPermiso.join("\n  ")}`,
  );
});

test("exigirEmpresa a secas no basta donde se usa la conexión directa", () => {
  // La comprobación de arriba podría pasar si alguien vuelve a escribir
  // `exigirEmpresa()`; esto lo caza por el nombre.
  const culpables: string[] = [];
  for (const ruta of archivosDeAcciones(RAIZ)) {
    const src = readFileSync(ruta, "utf8");
    if (!src.includes("conexionApp")) continue;
    if (/await exigirEmpresa\(\)/.test(src)) culpables.push(ruta.slice(RAIZ.length + 1));
  }
  assert.deepEqual(culpables, []);
});
