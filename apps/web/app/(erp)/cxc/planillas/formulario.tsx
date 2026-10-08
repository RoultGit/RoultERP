"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearAccion, type EstadoForm } from "./acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Cobrable = {
  /** "comprobante:<id>" o "letra:<id>". */
  marca: string;
  clase: "comprobante" | "letra";
  documento: string;
  cliente: string;
  vencimiento: string | null;
  moneda: string;
  libre: string;
};

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Creando…" : "Crear planilla"}
    </button>
  );
}

/**
 * Arma la planilla marcando documentos.
 *
 * Se ofrece el saldo **libre**: lo que ya salió en otra planilla no aparece.
 * Dos cobradores con la misma factura acaban en que nadie la cobra, porque cada
 * uno cree que la tiene el otro.
 */
export function FormularioPlanilla({ cobrables }: { cobrables: Cobrable[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearAccion, {});
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [importes, setImportes] = useState<Record<string, string>>({});
  const hoy = hoyEnPeru();

  const total = cobrables
    .filter((c) => marcados[c.marca])
    .reduce((a, c) => a + (Number(importes[c.marca] || c.libre) || 0), 0);

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipo">Se entrega a</label>
            <select id="tipo" name="tipo" className="campo" defaultValue="cobrador">
              <option value="cobrador">Un cobrador</option>
              <option value="banco">Un banco</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="responsable">Responsable *</label>
            <input
              id="responsable" name="responsable" required maxLength={120} className="campo"
              placeholder="Nombre del cobrador o del banco" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
      </section>

      <section className="bloque overflow-x-auto">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
          Documentos por cobrar
        </h2>
        {cobrables.length === 0 ? (
          <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
            No hay saldo libre que entregar. Lo que está pendiente puede estar ya en otra planilla
            abierta.
          </p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-10" />
                <th>Documento</th>
                <th>Cliente</th>
                <th>Vence</th>
                <th className="text-right">Libre</th>
                <th className="w-32 text-right">A entregar</th>
              </tr>
            </thead>
            <tbody>
              {cobrables.map((c) => (
                <tr key={c.marca}>
                  <td>
                    <input
                      type="checkbox" name="documento" value={c.marca}
                      checked={marcados[c.marca] ?? false}
                      onChange={(e) => setMarcados((m) => ({ ...m, [c.marca]: e.target.checked }))}
                      aria-label={`Incluir ${c.documento}`}
                    />
                  </td>
                  <td className="cifra" style={{ textAlign: "left" }}>{c.documento}</td>
                  <td className="max-w-[220px] truncate">{c.cliente}</td>
                  <td className="cifra">{c.vencimiento ?? "—"}</td>
                  <td className="cifra">{formatearImporte(c.libre)}</td>
                  <td>
                    <input
                      name={`importe-${c.marca}`} inputMode="decimal"
                      value={importes[c.marca] ?? ""}
                      placeholder={c.libre}
                      disabled={!marcados[c.marca]}
                      onChange={(e) => setImportes((i) => ({ ...i, [c.marca]: e.target.value }))}
                      className="campo campo-chico cifra"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "var(--superficie-2)" }}>
                <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  Total de la planilla
                </td>
                <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(total))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <Guardar />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        La planilla no cobra nada: dice quién tiene qué. Lo cobrado se sigue registrando como
        cobranza, con su asiento y su ingreso a caja, y la planilla lo refleja sola.
      </p>
    </form>
  );
}
