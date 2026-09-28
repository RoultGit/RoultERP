"use client";

/**
 * Botón de imprimir.
 *
 * Va en su propio archivo porque necesita ejecutarse en el navegador, y las
 * demás piezas de `ui.tsx` son de servidor: meterlo ahí arrastraría todas al
 * cliente sin necesidad.
 *
 * No se imprime a sí mismo —lleva la clase que lo oculta en papel— y no navega:
 * abre el diálogo del navegador sobre la misma pantalla, que es el gesto que un
 * usuario de Starsoft hace veinte veces al día.
 */
export function Imprimir({ texto = "Imprimir" }: { texto?: string }) {
  return (
    <button type="button" className="boton boton-secundario no-imprimir" onClick={() => window.print()}>
      {texto}
    </button>
  );
}
