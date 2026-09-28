"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { restablecerAccion, type EstadoForm } from "./acciones";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario w-full" disabled={pending}>
      {pending ? "Guardando…" : "Guardar la contraseña"}
    </button>
  );
}

export function FormularioRestablecer({ token }: { token: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(restablecerAccion, {});
  return (
    <form action={accion} className="space-y-3 text-left">
      <input type="hidden" name="token" value={token} />
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}
      <div>
        <label className="etiqueta" htmlFor="password">Contraseña nueva *</label>
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
        Doce caracteres o más. Al guardarla se cerrarán sus otras sesiones.
      </p>
      <Enviar />
    </form>
  );
}
