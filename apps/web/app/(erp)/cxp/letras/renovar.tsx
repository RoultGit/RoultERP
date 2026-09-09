"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { renovarLetraAccion, type EstadoForm } from "../acciones";

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario !py-1 !text-xs" disabled={pending}>
      {pending ? "Renovando…" : "Renovar"}
    </button>
  );
}

/**
 * Renovación de una letra.
 *
 * Se despliega en la propia fila en vez de llevar a otra pantalla: renovar es
 * un gesto corto —número, fecha nueva y, si los hubo, intereses— y sacar al
 * usuario de la lista para tres campos le hace perder el contexto de lo que
 * estaba revisando.
 */
export function RenovarLetra({
  letraId,
  numeroActual,
  saldo,
}: {
  letraId: string;
  numeroActual: string;
  saldo: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(renovarLetraAccion, {});
  const [abierto, setAbierto] = useState(false);
  const hoy = new Date().toISOString().slice(0, 10);

  if (!abierto) {
    return (
      <button
        type="button"
        className="text-xs underline"
        onClick={() => setAbierto(true)}
      >
        Renovar
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="letraId" value={letraId} />
      <input type="hidden" name="fecha" value={hoy} />

      {estado.error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </p>
      )}
      {estado.exito && (
        <p className="text-xs" style={{ color: "var(--exito)" }} role="status">
          {estado.exito}
        </p>
      )}

      <input
        name="numero" required maxLength={40} className="campo !py-1 !text-xs"
        placeholder={`${numeroActual}-R`} aria-label="Número de la letra nueva" />
      <input
        name="fechaVencimiento" type="date" required className="campo !py-1 !text-xs"
        aria-label="Nuevo vencimiento" />
      <input
        name="intereses" inputMode="decimal" className="campo cifra !py-1 !text-xs"
        placeholder="Intereses" aria-label="Intereses de la renovación" />

      <div className="flex gap-1">
        <Boton />
        <button
          type="button" className="boton boton-secundario !py-1 !text-xs"
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        La nueva nace por {saldo} más los intereses.
      </p>
    </form>
  );
}
