"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { anularPedidoAccion, type EstadoForm } from "./acciones";

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-secundario boton-chico" disabled={pending}>
      {pending ? "…" : "Anular"}
    </button>
  );
}

export function Anular({ pedidoId }: { pedidoId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(anularPedidoAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <Boton />
      {estado.error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
