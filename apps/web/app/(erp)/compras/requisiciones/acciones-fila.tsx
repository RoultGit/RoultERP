"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  resolverRequisicionAccion, anularRequisicionAccion, crearSolicitudAccion,
  type EstadoForm,
} from "./acciones";

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

/**
 * Acciones de una requisición según su estado.
 *
 * Pendiente: se aprueba o se rechaza —y rechazar pide motivo, que es la razón
 * de ser del documento—. Aprobada: se sale a cotizar. Lo demás, nada.
 */
export function AccionesRequisicion({
  requisicionId,
  estado,
  puedeAprobar,
}: {
  requisicionId: string;
  estado: string;
  puedeAprobar: boolean;
}) {
  const [resuelto, resolver] = useActionState<EstadoForm, FormData>(resolverRequisicionAccion, {});
  const [anulado, anular] = useActionState<EstadoForm, FormData>(anularRequisicionAccion, {});
  const [cotizado, cotizar] = useActionState<EstadoForm, FormData>(crearSolicitudAccion, {});
  const [rechazando, setRechazando] = useState(false);
  const error = resuelto.error ?? anulado.error ?? cotizado.error;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {estado === "pendiente" && puedeAprobar && !rechazando && (
          <>
            <form action={resolver} className="inline">
              <input type="hidden" name="requisicionId" value={requisicionId} />
              <input type="hidden" name="estado" value="aprobada" />
              <Boton primario>Aprobar</Boton>
            </form>
            <button
              type="button" className="boton boton-secundario !py-1 !text-xs"
              onClick={() => setRechazando(true)}
            >
              Rechazar
            </button>
          </>
        )}

        {estado === "pendiente" && puedeAprobar && rechazando && (
          <form action={resolver} className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="requisicionId" value={requisicionId} />
            <input type="hidden" name="estado" value="rechazada" />
            <input
              name="motivo" required maxLength={200} autoFocus
              className="campo !py-1 !text-xs" placeholder="Motivo del rechazo"
            />
            <Boton>Confirmar</Boton>
            <button
              type="button" className="boton boton-secundario !py-1 !text-xs"
              onClick={() => setRechazando(false)}
            >
              Cancelar
            </button>
          </form>
        )}

        {estado === "aprobada" && (
          <form action={cotizar} className="inline">
            <input type="hidden" name="requisicionId" value={requisicionId} />
            <Boton primario>Salir a cotizar</Boton>
          </form>
        )}

        {(estado === "pendiente" || estado === "aprobada" || estado === "rechazada") && (
          <form action={anular} className="inline">
            <input type="hidden" name="requisicionId" value={requisicionId} />
            <Boton>Anular</Boton>
          </form>
        )}

        {(estado === "atendida" || estado === "anulada") && (
          <span className="text-xs" style={{ color: "var(--texto-suave)" }}>—</span>
        )}
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
