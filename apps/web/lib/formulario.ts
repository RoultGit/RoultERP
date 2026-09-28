/**
 * Lectura de líneas repetidas de un formulario.
 *
 * Un asiento tiene tantas líneas como decida quien lo escribe, así que el
 * navegador las manda como `linea[0][cuenta]`, `linea[1][cuenta]`… Esto vive
 * fuera de "use server" para poder probarlo: un módulo de acciones sólo puede
 * exportar funciones asíncronas, y este parser no lo es.
 */
export type LineaFormulario = {
  cuenta: string;
  debe: string;
  haber: string;
  glosa?: string;
  centroCostoId?: string;
  anexoId?: string;
};

export function leerLineasAsiento(form: FormData): LineaFormulario[] {
  const porIndice = new Map<number, Record<string, string>>();
  for (const [clave, valor] of form.entries()) {
    const m = /^linea\[(\d+)]\[(\w+)]$/.exec(clave);
    if (!m) continue;
    const i = Number(m[1]);
    const fila = porIndice.get(i) ?? {};
    fila[m[2]!] = String(valor).trim();
    porIndice.set(i, fila);
  }

  return (
    [...porIndice.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, f]) => f)
      // Una fila sin cuenta es una fila que el usuario añadió y no llenó. No es
      // un error: se descarta en silencio, como hace cualquier hoja de cálculo.
      .filter((f) => f["cuenta"])
      .map((f) => ({
        cuenta: f["cuenta"]!,
        debe: f["debe"] || "0",
        haber: f["haber"] || "0",
        ...(f["glosa"] ? { glosa: f["glosa"] } : {}),
        ...(f["centroCostoId"] ? { centroCostoId: f["centroCostoId"] } : {}),
        ...(f["anexoId"] ? { anexoId: f["anexoId"] } : {}),
      }))
  );
}

/**
 * Lo que una acción de formulario devuelve a la pantalla.
 *
 * Estaba declarado igual en treinta y cinco archivos. Vive aquí —fuera de
 * cualquier módulo `"use server"`— porque también lo importan los componentes
 * de cliente para tipar `useActionState`.
 */
export type EstadoForm = {
  error?: string;
  exito?: string;
  /** Todas las razones cuando hay más de una. La pantalla las lista. */
  motivos?: string[];
  /** Campo al que saltar cuando el error es de uno concreto. */
  campo?: string;
};

/** Un campo de texto del formulario, ya recortado. */
export const texto = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();

/** Una casilla de verificación. El navegador manda `on`; un `select`, `true`. */
export const marcado = (f: FormData, k: string): boolean =>
  f.get(k) === "on" || f.get(k) === "true";

/**
 * Recorre las filas repetidas `lineas[0].x`, `lineas[1].x`… del formulario.
 *
 * Cada módulo escribía su propio bucle con el índice a mano y la plantilla
 * `` `lineas[${i}].campo` `` repetida diez veces por función: ahí es donde vive
 * la errata que deja un campo sin leer y nadie descubre hasta producción.
 *
 * `marca` es el campo que decide dónde se acaba la tabla: cuando el formulario
 * deja de mandarlo, no hay más filas. Se emite un lector por fila, y la forma
 * de cada línea la decide quien llama, que es lo único que de verdad cambia
 * entre un asiento, una guía y una rendición.
 */
export function* filas(
  form: FormData,
  marca: string,
  prefijo = "lineas",
): Generator<(campo: string) => string> {
  for (let i = 0; ; i++) {
    if (form.get(`${prefijo}[${i}].${marca}`) === null) return;
    const indice = i;
    yield (campo) => String(form.get(`${prefijo}[${indice}].${campo}`) ?? "").trim();
  }
}
