"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrar, comprobarCodigo, type EstadoEntrar } from "./acciones";

function Enviar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario w-full" disabled={pending}>
      {pending ? "Verificando…" : children}
    </button>
  );
}

export function FormularioEntrar({ siguiente }: { siguiente: string }) {
  const [estado, accion] = useActionState<EstadoEntrar, FormData>(entrar, {
    fase: "credenciales",
  });

  // El segundo factor es una fase del mismo formulario y no otra página: así el
  // reto vive en el estado del cliente y no hace falta guardarlo en la URL ni
  // en otra cookie.
  if (estado.fase === "mfa") {
    return <FormularioCodigo reto={estado.reto} siguiente={siguiente} error={estado.error} />;
  }

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="siguiente" value={siguiente} />

      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <div>
        <label className="etiqueta" htmlFor="email">
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="campo"
          placeholder="usuario@empresa.pe"
        />
      </div>

      <div>
        <label className="etiqueta" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="campo"
        />
      </div>

      <Enviar>Entrar</Enviar>

      <p className="text-center text-xs" style={{ color: "var(--texto-suave)" }}>
        <a href="/recuperar" className="underline">
          Olvidé mi contraseña
        </a>
      </p>
    </form>
  );
}

function FormularioCodigo({
  reto,
  siguiente,
  error,
}: {
  reto: string;
  siguiente: string;
  error?: string;
}) {
  const [estado, accion] = useActionState<EstadoEntrar, FormData>(comprobarCodigo, {
    fase: "mfa",
    reto,
    ...(error ? { error } : {}),
  });

  if (estado.fase === "credenciales") {
    return <FormularioEntrar siguiente={siguiente} />;
  }

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="reto" value={estado.reto} />
      <input type="hidden" name="siguiente" value={siguiente} />

      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <div>
        <label className="etiqueta" htmlFor="codigo">
          Código de verificación
        </label>
        <input
          id="codigo"
          name="codigo"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className="campo text-center text-lg tracking-[0.3em]"
          placeholder="000000"
        />
        <p className="mt-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Ingrese el código de su aplicación de autenticación, o uno de sus códigos de respaldo.
        </p>
      </div>

      <Enviar>Verificar</Enviar>
    </form>
  );
}
