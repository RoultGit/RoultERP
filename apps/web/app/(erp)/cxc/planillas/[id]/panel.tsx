"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cerrarAccion, anularAccion, type EstadoForm } from "../acciones";

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"}`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}

function Error({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p className="mt-1 text-sm" style={{ color: "var(--peligro)" }} role="alert">
      {mensaje}
    </p>
  );
}

/**
 * Cerrar y anular.
 *
 * Cerrar no cobra: libera. Mientras la planilla está abierta sus documentos no
 * se pueden entregar a otro cobrador; al cerrarla, lo que quedó sin cobrar
 * vuelve a estar disponible para la siguiente salida.
 */
export function Panel({ planillaId }: { planillaId: string }) {
  const [cierre, cerrar] = useActionState<EstadoForm, FormData>(cerrarAccion, {});
  const [anulacion, anular] = useActionState<EstadoForm, FormData>(anularAccion, {});
  const [anulando, setAnulando] = useState(false);

  if (anulando) {
    return (
      <form action={anular} className="space-y-2 p-4">
        <input type="hidden" name="planillaId" value={planillaId} />
        <label className="etiqueta" htmlFor="motivo">Motivo de la anulación *</label>
        <input
          id="motivo" name="motivo" required maxLength={200} autoFocus
          className="campo" placeholder="El cobrador no salió" />
        <div className="flex gap-2">
          <Boton>Confirmar anulación</Boton>
          <button type="button" className="boton boton-secundario" onClick={() => setAnulando(false)}>
            Cancelar
          </button>
        </div>
        <Error mensaje={anulacion.error} />
      </form>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <form action={cerrar}>
        <input type="hidden" name="planillaId" value={planillaId} />
        <Boton primario>Cerrar planilla</Boton>
      </form>
      <button type="button" className="boton boton-secundario w-full" onClick={() => setAnulando(true)}>
        Anular
      </button>
      <Error mensaje={cierre.error} />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Al cerrarla, lo que no se cobró vuelve a quedar libre para la siguiente salida.
      </p>
    </div>
  );
}
