"use client";

import { useCallback, useRef, useState } from "react";

/**
 * La tabla de líneas editable, que aparece en seis formularios.
 *
 * Una venta, una cotización, una orden de compra, una factura de compra, una
 * requisición y una guía tienen columnas distintas, pero la mecánica es la
 * misma: una lista que crece y mengua, y cada fila se edita por separado. Eso
 * estaba copiado seis veces —con su contador de claves, su `map` inmutable y
 * su `filter`—, y era el bloque más repetido de toda la aplicación.
 *
 * Es un gancho y no un componente a propósito. Lo que se repite es **el
 * estado**; lo que cambia en cada pantalla son las columnas, y encerrar eso en
 * un componente habría exigido quince propiedades de configuración para
 * describir una tabla, que es más difícil de leer que la tabla misma.
 *
 * **La clave vive en un `useRef`, no en una variable de módulo.** Copiada como
 * estaba, el contador era global al archivo: dos instancias del mismo
 * formulario en la misma página compartían la numeración, y al desmontar y
 * volver a montar seguía creciendo desde donde se quedó. Con la referencia,
 * cada formulario numera lo suyo desde cero.
 *
 * La clave **no** es el índice de la fila: al borrar la segunda de tres, React
 * reutilizaría el nodo y el texto que se estaba escribiendo saltaría de fila.
 */
export type ConClave = { clave: number };

export type Lineas<T extends ConClave> = {
  lineas: T[];
  /** Cambia unos campos de una fila y deja el resto como está. */
  actualizar: (clave: number, cambio: Partial<T>) => void;
  agregar: () => void;
  quitar: (clave: number) => void;
  /** Reemplaza la lista entera. Para cargar las líneas de otro documento. */
  reemplazar: (nuevas: Omit<T, "clave">[]) => void;
};

export function useLineas<T extends ConClave>(
  vacia: () => Omit<T, "clave">,
  iniciales?: readonly Omit<T, "clave">[],
): Lineas<T> {
  const siguiente = useRef(0);
  const conClave = useCallback(
    (l: Omit<T, "clave">) => ({ ...l, clave: siguiente.current++ }) as T,
    [],
  );

  // El estado inicial se calcula una sola vez: pasarlo como valor y no como
  // función volvería a numerar en cada repintado.
  const [lineas, setLineas] = useState<T[]>(() =>
    (iniciales?.length ? iniciales : [vacia()]).map(conClave),
  );

  const actualizar = useCallback(
    (clave: number, cambio: Partial<T>) =>
      setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l))),
    [],
  );

  const agregar = useCallback(
    () => setLineas((ls) => [...ls, conClave(vacia())]),
    [conClave, vacia],
  );

  /*
   * Nunca se queda sin filas.
   *
   * Una tabla vacía no deja escribir nada y obliga a buscar el botón de
   * añadir para empezar. Al quitar la última, entra una en blanco.
   */
  const quitar = useCallback(
    (clave: number) =>
      setLineas((ls) => {
        const resto = ls.filter((l) => l.clave !== clave);
        return resto.length ? resto : [conClave(vacia())];
      }),
    [conClave, vacia],
  );

  const reemplazar = useCallback(
    (nuevas: Omit<T, "clave">[]) =>
      setLineas((nuevas.length ? nuevas : [vacia()]).map(conClave)),
    [conClave, vacia],
  );

  return { lineas, actualizar, agregar, quitar, reemplazar };
}
