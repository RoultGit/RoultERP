/**
 * Paginación de listados.
 *
 * Es deliberadamente aritmética y sin React: así se prueba sin montar nada, y
 * la misma cuenta sirve tanto para cortar un arreglo en memoria como para
 * calcular el `OFFSET` de una consulta. La presentación vive en
 * `components/paginacion.tsx`, que sólo pinta lo que aquí se decide.
 *
 * Por qué por dirección y no con estado de cliente: la página es un parámetro
 * de la consulta, igual que el periodo o el filtro. Puesta en la dirección se
 * puede marcar, compartir, recargar y volver atrás, y la pantalla sigue siendo
 * un componente de servidor sin un byte de JavaScript.
 */

/**
 * Filas por página.
 *
 * Cincuenta es lo que cabe en dos pantallas de un portátil: suficiente para
 * recorrer con la rueda sin que la página se vuelva interminable, y bastante
 * para que buscar algo no obligue a saltar de página en página.
 */
export const POR_PAGINA = 50;

/**
 * Página pedida, saneada.
 *
 * Llega de la dirección, que es texto que escribe cualquiera: `?pagina=-3`,
 * `?pagina=abc` o `?pagina=1e9`. Todo lo que no sea un entero mayor o igual a
 * uno cae en la primera página, que es el comportamiento que no sorprende.
 */
export function paginaDe(valor: string | undefined): number {
  if (!valor) return 1;
  if (!/^[0-9]{1,6}$/.test(valor)) return 1;
  const n = Number(valor);
  return n < 1 ? 1 : n;
}

/** Cuántas páginas hacen falta para `total` filas. Nunca menos de una. */
export function totalPaginas(total: number, porPagina = POR_PAGINA): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

/**
 * La rodaja que toca mostrar.
 *
 * Si la página pedida se pasa del final —se borraron filas, o alguien escribió
 * `?pagina=99`— devuelve la última con contenido en vez de una tabla vacía:
 * una lista que existe y sale vacía se lee como un error del sistema.
 */
export function rodaja<T>(filas: readonly T[], pagina: number, porPagina = POR_PAGINA): T[] {
  const ultima = totalPaginas(filas.length, porPagina);
  const p = Math.min(Math.max(1, pagina), ultima);
  const desde = (p - 1) * porPagina;
  return filas.slice(desde, desde + porPagina);
}

/** `OFFSET` para una consulta paginada, por si el corte se hace en SQL. */
export function desplazamiento(pagina: number, porPagina = POR_PAGINA): number {
  return (Math.max(1, pagina) - 1) * porPagina;
}
