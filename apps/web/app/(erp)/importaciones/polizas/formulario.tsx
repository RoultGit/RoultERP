"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearPolizaAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

/** Las intendencias que usa un importador de Lima. Se puede escribir otra. */
const ADUANAS = [
  ["235", "235 — Marítima del Callao"],
  ["118", "118 — Aérea del Callao"],
  ["046", "046 — Tacna"],
  ["172", "172 — Paita"],
] as const;

const REGIMENES = [
  "Importación definitiva",
  "Admisión temporal",
  "Depósito aduanero",
  "Reimportación",
] as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Abriendo…" : "Abrir póliza"}
    </button>
  );
}

export function FormularioPoliza({ agentes }: { agentes: Opcion[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearPolizaAccion, {});
  const [abierto, setAbierto] = useState(false);
  const hoy = hoyEnPeru();

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Nueva póliza
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
        <h2 className="mb-3 text-sm font-semibold">Declaración aduanera</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="numero">Número de DUA *</label>
            <input
              id="numero" name="numero" required maxLength={40}
              className="campo cifra" style={{ textAlign: "left" }}
              placeholder="235-2026-10-123456" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaNumeracion">Numeración</label>
            <input id="fechaNumeracion" name="fechaNumeracion" type="date" className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="aduana">Aduana</label>
            <select id="aduana" name="aduana" className="campo" defaultValue="235">
              {ADUANAS.map(([c, t]) => (
                <option key={c} value={c}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="regimen">Régimen</label>
            <select id="regimen" name="regimen" className="campo" defaultValue={REGIMENES[0]}>
              {REGIMENES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="agenteId">Agente de aduanas</label>
            <select id="agenteId" name="agenteId" className="campo" defaultValue="">
              <option value="">—</option>
              {agentes.map((a) => (
                <option key={a.id} value={a.id}>{a.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoCambio">Tipo de cambio *</label>
            <input
              id="tipoCambio" name="tipoCambio" required inputMode="decimal"
              className="campo cifra" defaultValue="3.80" />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              El de la fecha de numeración. Manda sobre el de cada factura.
            </p>
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
