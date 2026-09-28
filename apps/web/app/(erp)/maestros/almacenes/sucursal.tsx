"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarSucursalAccion, type EstadoForm } from "../acciones";

export type Sucursal = {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  ubigeo: string | null;
  codigoSunat: string | null;
};

function Guardar({ nueva }: { nueva: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : nueva ? "Crear sucursal" : "Guardar"}
    </button>
  );
}

/**
 * Mantenimiento de la sucursal.
 *
 * El ubigeo no es un adorno: es el punto de partida de toda guía de remisión.
 * Mientras la sucursal no lo tenga, quien despacha lo teclea a mano en cada
 * guía y lo adivina, que es como estaba antes de esta pantalla.
 */
export function FormularioSucursal({ sucursal }: { sucursal?: Sucursal }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarSucursalAccion, {});
  const [abierto, setAbierto] = useState(false);
  const nueva = !sucursal;

  if (!abierto) {
    return (
      <button type="button" className="boton boton-secundario" onClick={() => setAbierto(true)}>
        {nueva ? "Nueva sucursal" : "Editar"}
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-3">
      {sucursal && <input type="hidden" name="id" value={sucursal.id} />}
      {estado.error && (
        <div className="aviso" role="alert">
          {estado.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="etiqueta" htmlFor={`codigo-${sucursal?.id ?? "nueva"}`}>Código *</label>
          <input
            id={`codigo-${sucursal?.id ?? "nueva"}`} name="codigo" required maxLength={10}
            className="campo cifra" style={{ textAlign: "left" }}
            defaultValue={sucursal?.codigo ?? ""} readOnly={!nueva} />
        </div>
        <div>
          <label className="etiqueta" htmlFor={`nombre-${sucursal?.id ?? "nueva"}`}>Nombre *</label>
          <input
            id={`nombre-${sucursal?.id ?? "nueva"}`} name="nombre" required maxLength={120}
            className="campo" defaultValue={sucursal?.nombre ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor={`direccion-${sucursal?.id ?? "nueva"}`}>Dirección</label>
          <input
            id={`direccion-${sucursal?.id ?? "nueva"}`} name="direccion" maxLength={200}
            className="campo" defaultValue={sucursal?.direccion ?? ""} />
        </div>
        <div>
          <label className="etiqueta" htmlFor={`ubigeo-${sucursal?.id ?? "nueva"}`}>Ubigeo</label>
          <input
            id={`ubigeo-${sucursal?.id ?? "nueva"}`} name="ubigeo" maxLength={6} pattern="\d{6}"
            className="campo cifra" style={{ textAlign: "left" }} placeholder="150103"
            defaultValue={sucursal?.ubigeo ?? ""} />
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            Punto de partida de las guías.
          </p>
        </div>
        <div>
          <label className="etiqueta" htmlFor={`codigoSunat-${sucursal?.id ?? "nueva"}`}>
            Establecimiento SUNAT
          </label>
          <input
            id={`codigoSunat-${sucursal?.id ?? "nueva"}`} name="codigoSunat" maxLength={4}
            pattern="\d{4}" className="campo cifra" style={{ textAlign: "left" }}
            placeholder="0000" defaultValue={sucursal?.codigoSunat ?? ""} />
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            0000 es el domicilio fiscal.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Guardar nueva={nueva} />
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
