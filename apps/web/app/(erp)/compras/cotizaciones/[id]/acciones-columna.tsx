"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  elegirAccion, descartarAccion, cerrarSolicitudAccion, type EstadoForm,
} from "../acciones";

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"} !py-1 !text-xs`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function CerrarSolicitud({ solicitudId }: { solicitudId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(cerrarSolicitudAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="solicitudId" value={solicitudId} />
      <button type="submit" className="boton boton-secundario">Cerrar solicitud</button>
      {estado.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </span>
      )}
    </form>
  );
}

/**
 * Decisión sobre una oferta.
 *
 * Elegir genera la orden de compra y descarta a las demás, así que pide antes
 * el almacén de destino: no es una pulsación reversible.
 */
export function AccionesColumna({
  solicitudId,
  cotizacionId,
  estado,
  ordenCompraId,
  puedeAprobar,
  hoy,
  almacenes,
}: {
  solicitudId: string;
  cotizacionId: string;
  estado: string;
  ordenCompraId: string | null;
  puedeAprobar: boolean;
  hoy: string;
  almacenes: { id: string; etiqueta: string }[];
}) {
  const [elegido, elegir] = useActionState<EstadoForm, FormData>(elegirAccion, {});
  const [descartado, descartar] = useActionState<EstadoForm, FormData>(descartarAccion, {});
  const [confirmando, setConfirmando] = useState(false);
  const error = elegido.error ?? descartado.error;

  if (estado === "elegida") {
    return ordenCompraId ? (
      <Link href={`/compras/ordenes/${ordenCompraId}` as Route} className="text-xs underline">
        Ver la orden
      </Link>
    ) : (
      <span className="text-xs" style={{ color: "var(--exito)" }}>elegida</span>
    );
  }
  if (estado === "descartada") {
    return <span className="text-xs" style={{ color: "var(--texto-suave)" }}>descartada</span>;
  }

  return (
    <div className="space-y-1">
      {!confirmando ? (
        <div className="flex flex-wrap gap-1.5">
          {puedeAprobar && (
            <button
              type="button" className="boton boton-primario !py-1 !text-xs"
              onClick={() => setConfirmando(true)}
            >
              Elegir
            </button>
          )}
          <form action={descartar} className="inline">
            <input type="hidden" name="solicitudId" value={solicitudId} />
            <input type="hidden" name="cotizacionId" value={cotizacionId} />
            <Boton>Descartar</Boton>
          </form>
        </div>
      ) : (
        <form action={elegir} className="space-y-1">
          <input type="hidden" name="cotizacionId" value={cotizacionId} />
          <input type="hidden" name="fecha" value={hoy} />
          <select name="almacenId" className="campo !py-1 !text-xs" defaultValue={almacenes[0]?.id ?? ""}>
            <option value="">Sin almacén</option>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>{a.etiqueta}</option>
            ))}
          </select>
          <input name="fechaEntrega" type="date" className="campo !py-1 !text-xs" />
          <div className="flex gap-1.5">
            <Boton primario>Emitir orden</Boton>
            <button
              type="button" className="boton boton-secundario !py-1 !text-xs"
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
            Las demás ofertas quedarán descartadas.
          </p>
        </form>
      )}
      {error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
