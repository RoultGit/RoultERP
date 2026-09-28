"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarCentroAccion, type EstadoForm } from "./acciones";

function Boton({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <p
      className="mt-2 text-xs"
      style={{ color: estado.error ? "var(--peligro)" : "var(--exito)" }}
      role={estado.error ? "alert" : undefined}
    >
      {estado.error ?? estado.exito}
    </p>
  );
}

export function NuevoCentro() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarCentroAccion, {});
  return (
    <form action={accion} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="etiqueta" htmlFor="codigo">Código *</label>
        <input
          id="codigo" name="codigo" required maxLength={20}
          className="campo uppercase" style={{ width: "8rem" }} placeholder="VTA"
        />
      </div>
      <div className="min-w-[16rem] flex-1">
        <label className="etiqueta" htmlFor="nombre">Nombre *</label>
        <input id="nombre" name="nombre" required maxLength={80} className="campo" placeholder="Ventas" />
      </div>
      <Boton texto="Crear centro de costo" />
      <Resultado estado={estado} />
    </form>
  );
}

/** Activa o desactiva. No se borra: aparece en asientos ya contabilizados. */
export function CambiarEstado({
  id,
  codigo,
  nombre,
  activo,
}: {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarCentroAccion, {});
  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="codigo" value={codigo} />
      <input type="hidden" name="nombre" value={nombre} />
      <input type="hidden" name="activo" value={activo ? "0" : "1"} />
      <button
        type="submit"
        className="boton boton-secundario !py-1 !text-xs"
        style={activo ? { color: "var(--peligro)" } : undefined}
      >
        {activo ? "Desactivar" : "Reactivar"}
      </button>
      <Resultado estado={estado} />
    </form>
  );
}
