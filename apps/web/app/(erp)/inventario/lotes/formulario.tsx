"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarLoteAccion, type EstadoForm } from "./acciones";

export type Opcion = { id: string; etiqueta: string };

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar lote"}
    </button>
  );
}

/**
 * Ficha de un lote.
 *
 * Sólo pide lo que el kardex no sabe: cuándo se fabricó y cuándo vence. Las
 * cantidades salen de los movimientos, y por eso no hay campo para ellas.
 */
export function FormularioLote({ productos }: { productos: Opcion[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarLoteAccion, {});
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Registrar lote
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-4">
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="tarjeta p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          La cantidad de cada lote sale del kardex. Aquí sólo se declara lo que el kardex no sabe.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="productoId">Producto *</label>
            <select id="productoId" name="productoId" required className="campo" defaultValue="">
              <option value="" disabled>Elija el producto</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="codigo">Lote *</label>
            <input
              id="codigo" name="codigo" required maxLength={30}
              className="campo cifra" style={{ textAlign: "left" }} placeholder="L-2609" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaFabricacion">Fabricado el</label>
            <input id="fechaFabricacion" name="fechaFabricacion" type="date" className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaVencimiento">Vence el</label>
            <input id="fechaVencimiento" name="fechaVencimiento" type="date" className="campo" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Guardar />
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
