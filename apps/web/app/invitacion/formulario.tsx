"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { aceptarInvitacionAccion, type EstadoForm } from "./acciones";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario w-full" disabled={pending}>
      {pending ? "Activando…" : "Activar mi cuenta"}
    </button>
  );
}

export function FormularioInvitacion({ token }: { token: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(aceptarInvitacionAccion, {});
  return (
    <form action={accion} className="space-y-3 text-left">
      <input type="hidden" name="token" value={token} />
      {estado.error && <p className="aviso" role="alert">{estado.error}</p>}
      <div>
        <label className="etiqueta" htmlFor="password">Elija su contraseña *</label>
        <input
          id="password" name="password" type="password" required minLength={12}
          className="campo" autoComplete="new-password"
        />
      </div>
      <div>
        <label className="etiqueta" htmlFor="repetir">Repítala *</label>
        <input
          id="repetir" name="repetir" type="password" required minLength={12}
          className="campo" autoComplete="new-password"
        />
      </div>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Doce caracteres o más. No use una que ya utilice en otro sitio.
      </p>
      <Enviar />
    </form>
  );
}
