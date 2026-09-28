"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { resolverCotizacionAccion, convertirAccion, type EstadoForm } from "./acciones";

/**
 * Botones de una fila del listado.
 *
 * El error se muestra dentro de la fila y no arriba, porque una cotización
 * rechazada por su estado sólo tiene sentido junto a la cotización de la que
 * habla.
 */
function Boton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-secundario !py-1 !text-xs" disabled={pending}>
      {pending ? "…" : children}
    </button>
  );
}

export function Acciones({
  cotizacionId,
  estado,
  hoy,
  almacenes,
}: {
  cotizacionId: string;
  estado: string;
  hoy: string;
  almacenes: { id: string; etiqueta: string }[];
}) {
  const [resuelto, resolver] = useActionState<EstadoForm, FormData>(resolverCotizacionAccion, {});
  const [convertido, convertir] = useActionState<EstadoForm, FormData>(convertirAccion, {});
  const error = resuelto.error ?? convertido.error;

  if (estado === "convertida" || estado === "rechazada") {
    return <span className="text-xs" style={{ color: "var(--texto-suave)" }}>—</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {estado === "pendiente" && (
          <>
            <form action={resolver} className="inline">
              <input type="hidden" name="cotizacionId" value={cotizacionId} />
              <input type="hidden" name="estado" value="aceptada" />
              <Boton>Aceptar</Boton>
            </form>
            <form action={resolver} className="inline">
              <input type="hidden" name="cotizacionId" value={cotizacionId} />
              <input type="hidden" name="estado" value="rechazada" />
              <Boton>Rechazar</Boton>
            </form>
          </>
        )}
        <form action={convertir} className="flex items-center gap-1.5">
          <input type="hidden" name="cotizacionId" value={cotizacionId} />
          <input type="hidden" name="fecha" value={hoy} />
          <select name="almacenId" className="campo !py-1 !text-xs" defaultValue={almacenes[0]?.id ?? ""}>
            <option value="">Sin almacén</option>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>{a.etiqueta}</option>
            ))}
          </select>
          <Boton>Generar pedido</Boton>
        </form>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
