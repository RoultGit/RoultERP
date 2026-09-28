"use client";

import { useEffect, useState } from "react";

const CLAVE = "roulterp-tema";

/**
 * Interruptor de modo claro y oscuro.
 *
 * El valor inicial se lee del atributo que el script del `head` ya dejó puesto,
 * no de `localStorage` otra vez: así el botón nace diciendo lo mismo que se está
 * viendo, sin un fotograma en el que muestre lo contrario.
 *
 * Toda lectura y escritura del almacenamiento va en `try`: en una ventana
 * privada lanza, y un fallo al guardar una preferencia no puede tumbar la barra
 * lateral entera.
 */
export function InterruptorTema() {
  const [oscuro, setOscuro] = useState(false);

  useEffect(() => {
    setOscuro(document.documentElement.dataset["tema"] === "oscuro");
  }, []);

  const cambiar = () => {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    document.documentElement.dataset["tema"] = nuevo ? "oscuro" : "claro";
    try {
      localStorage.setItem(CLAVE, nuevo ? "oscuro" : "claro");
    } catch {
      /* Ventana privada: la preferencia dura lo que dure la pestaña. */
    }
  };

  return (
    <button
      type="button"
      onClick={cambiar}
      className="boton boton-secundario !px-2 !py-1.5 !text-[13px]"
      aria-pressed={oscuro}
    >
      {oscuro ? "Modo claro" : "Modo oscuro"}
    </button>
  );
}
