"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { avanzar, type EstadoAccion } from "./acciones";
import { EstadoDoc } from "@/components/ui";

/** Estados en orden. El siguiente es siempre el que va después en esta lista. */
const SECUENCIA = [
  "borrador",
  "aprobada",
  "en_transito",
  "en_aduana",
  "nacionalizada",
  "liquidada",
] as const;

const ETIQUETA: Record<string, string> = {
  aprobada: "Aprobar",
  en_transito: "Marcar embarcada",
  en_aduana: "Marcar en aduana",
  nacionalizada: "Nacionalizar",
};

function Boton({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

export function AvanzarEstado({ id, estado }: { id: string; estado: string }) {
  const [resultado, accion] = useActionState<EstadoAccion, FormData>(avanzar, {});
  const [pidiendoDua, setPidiendoDua] = useState(false);

  const i = SECUENCIA.indexOf(estado as (typeof SECUENCIA)[number]);
  const siguiente = i >= 0 ? SECUENCIA[i + 1] : undefined;

  // La liquidación no es un botón de estado: se confirma desde su panel, que es
  // donde se ve el cálculo que se está aprobando.
  if (!siguiente || siguiente === "liquidada") {
    return (
      <div className="flex items-center gap-2">
        {resultado.error && <span className="text-xs" style={{ color: "var(--peligro)" }}>{resultado.error}</span>}
        <EstadoDoc estado={estado} />
      </div>
    );
  }

  // Al pasar a «en aduana» conviene capturar la DUA en el mismo gesto: es el
  // dato que después sustenta el crédito fiscal de la importación.
  const necesitaDua = siguiente === "en_aduana";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <EstadoDoc estado={estado} />
        <form action={accion} className="flex items-center gap-2">
          <input type="hidden" name="importacionId" value={id} />
          <input type="hidden" name="estado" value={siguiente} />

          {necesitaDua && pidiendoDua && (
            <>
              <input
                name="duaNumero"
                className="campo w-48"
                placeholder="235-2026-10-000000"
                aria-label="Número de DUA"
              />
              <input
                name="duaFecha"
                type="date"
                className="campo w-40"
                aria-label="Fecha de la DUA"
              />
            </>
          )}

          {necesitaDua && !pidiendoDua ? (
            <button
              type="button"
              className="boton boton-primario"
              onClick={() => setPidiendoDua(true)}
            >
              {ETIQUETA[siguiente] ?? siguiente}
            </button>
          ) : (
            <Boton texto={ETIQUETA[siguiente] ?? siguiente} />
          )}
        </form>
      </div>

      {resultado.error && (
        <span className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {resultado.error}
        </span>
      )}
    </div>
  );
}
