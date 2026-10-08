"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { entregarAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

export function FormularioEntrega({
  cuentas,
  terceros,
  centrosCosto,
}: {
  cuentas: Opcion[];
  terceros: Opcion[];
  centrosCosto: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(entregarAccion, {});
  const [abierto, setAbierto] = useState(false);
  const hoy = hoyEnPeru();

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Entregar a rendir
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-4">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="bloque p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          Dinero que sale a nombre de alguien y todavía no es gasto. Se carga a la cuenta 14 y ahí
          se queda hasta que se rinda con documentos.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cuentaId">De la cuenta *</label>
            <select id="cuentaId" name="cuentaId" required className="campo" defaultValue="">
              <option value="" disabled>Elija la cuenta</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="importe">Importe *</label>
            <input
              id="importe" name="importe" required inputMode="decimal"
              className="campo cifra" placeholder="0.00" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="centroCostoId">Centro de costo</label>
            <select id="centroCostoId" name="centroCostoId" className="campo" defaultValue="">
              <option value="">—</option>
              {centrosCosto.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Lo heredan los gastos que se rindan.
            </p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="responsable">Responsable *</label>
            <input
              id="responsable" name="responsable" required maxLength={120}
              className="campo" placeholder="Luis Quispe" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="responsableId">Si está en el maestro</label>
            <select id="responsableId" name="responsableId" className="campo" defaultValue="">
              <option value="">—</option>
              {terceros.map((t) => (
                <option key={t.id} value={t.id}>{t.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="motivo">Motivo *</label>
            <input
              id="motivo" name="motivo" required maxLength={200}
              className="campo" placeholder="Viaje a Trujillo · entrega de mercadería" />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Entregar />
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Entregar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Entregando…" : "Entregar"}
    </button>
  );
}
