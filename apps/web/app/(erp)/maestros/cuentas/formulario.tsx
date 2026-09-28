"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sincronizarAccion, type EstadoForm } from "./acciones";

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-secundario" disabled={pending}>
      {pending ? "Comprobando…" : "Poner el plan al día"}
    </button>
  );
}

export function Sincronizar() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(sincronizarAccion, {});
  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <Boton />
      {estado.error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">{estado.error}</p>
      )}
      {estado.exito && (
        <p className="max-w-md text-right text-xs" style={{ color: "var(--exito)" }}>
          {estado.exito}
        </p>
      )}
    </form>
  );
}
