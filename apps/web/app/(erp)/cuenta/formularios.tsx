"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  cambiarPasswordAccion, prepararMfaAccion, activarMfaAccion, desactivarMfaAccion,
  cerrarSesionesAccion, type EstadoForm,
} from "./acciones";

function Enviar({ texto, tono = "secundario" }: { texto: string; tono?: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${tono}`} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <div className="mt-2 text-xs">
      {estado.error && <p style={{ color: "var(--peligro)" }} role="alert">{estado.error}</p>}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
    </div>
  );
}

export function CambiarPassword() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(cambiarPasswordAccion, {});
  return (
    <form action={accion} className="space-y-3">
      <div>
        <label className="etiqueta" htmlFor="actual">Contraseña actual *</label>
        <input
          id="actual" name="actual" type="password" required className="campo"
          autoComplete="current-password"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta" htmlFor="nueva">Nueva contraseña *</label>
          <input
            id="nueva" name="nueva" type="password" required minLength={12} className="campo"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="repetir">Repítala *</label>
          <input
            id="repetir" name="repetir" type="password" required minLength={12} className="campo"
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Al cambiarla se cierran todas las sesiones, incluida ésta: tendrá que volver a entrar.
      </p>
      <Enviar texto="Cambiar contraseña" tono="primario" />
      <Resultado estado={estado} />
    </form>
  );
}

/**
 * Alta del segundo factor, en dos pasos.
 *
 * Se activa sólo después de que la persona escriba un código de su app: si se
 * activara al generar el secreto, un error al escanear la dejaría fuera de su
 * propia cuenta.
 */
export function ActivarMfa() {
  const [preparado, accionPreparar] = useActionState<EstadoForm, FormData>(prepararMfaAccion, {});
  const [activado, accionActivar] = useActionState<EstadoForm, FormData>(activarMfaAccion, {});

  if (activado.respaldos) {
    return (
      <div>
        <p className="text-sm" style={{ color: "var(--exito)" }}>
          Segundo factor activado.
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--texto-suave)" }}>
          Códigos de respaldo. Cada uno sirve una sola vez y no vuelven a mostrarse: guárdelos
          donde no estén junto a su contraseña.
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {activado.respaldos.map((c) => (
            <li
              key={c}
              className="cifra rounded p-1.5 text-center text-sm"
              style={{ background: "var(--superficie-2)" }}
            >
              {c}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!preparado.mfa) {
    return (
      <form action={accionPreparar}>
        <Enviar texto="Activar segundo factor" tono="primario" />
        <Resultado estado={preparado} />
      </form>
    );
  }

  return (
    <form action={accionActivar} className="space-y-3">
      <p className="text-sm">
        Añada esta clave en su app de autenticación y escriba el código que muestre.
      </p>
      <code
        className="block break-all rounded p-2 text-sm"
        style={{ background: "var(--superficie-2)" }}
      >
        {preparado.mfa.secreto}
      </code>
      <p className="break-all text-xs" style={{ color: "var(--texto-suave)" }}>
        {preparado.mfa.uri}
      </p>
      <div>
        <label className="etiqueta" htmlFor="codigo">Código de seis dígitos *</label>
        <input
          id="codigo" name="codigo" required inputMode="numeric" pattern="\d{6}"
          className="campo cifra" style={{ width: "10rem", textAlign: "left" }}
          autoComplete="one-time-code"
        />
      </div>
      <Enviar texto="Confirmar y activar" tono="primario" />
      <Resultado estado={activado} />
    </form>
  );
}

export function DesactivarMfa() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(desactivarMfaAccion, {});
  return (
    <form action={accion} className="space-y-3">
      <div>
        <label className="etiqueta" htmlFor="password">Su contraseña *</label>
        <input
          id="password" name="password" type="password" required className="campo"
          autoComplete="current-password"
        />
      </div>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Se pide la contraseña para que una sesión robada no pueda quitarle la protección.
      </p>
      <button type="submit" className="boton boton-secundario" style={{ color: "var(--peligro)" }}>
        Desactivar segundo factor
      </button>
      <Resultado estado={estado} />
    </form>
  );
}

export function CerrarSesiones() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(cerrarSesionesAccion, {});
  return (
    <form action={accion}>
      <Enviar texto="Cerrar todas las sesiones" />
      <Resultado estado={estado} />
    </form>
  );
}
