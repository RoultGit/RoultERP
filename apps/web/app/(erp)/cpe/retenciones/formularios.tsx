"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  emitirRetencionAccion, emitirPercepcionAccion, enviarRetencionAccion, type EstadoForm,
} from "./acciones";
import { formatearImporte } from "@/components/ui";

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
    <div className="mt-1 text-xs">
      {(estado.motivos ?? (estado.error ? [estado.error] : [])).map((m) => (
        <p key={m} style={{ color: "var(--peligro)" }} role="alert">{m}</p>
      ))}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
    </div>
  );
}

export type Pendiente = {
  id: string;
  etiqueta: string;
  detalle: string;
  importe: string;
};

/**
 * Pagos o cobranzas pendientes de documentar, en un solo formulario.
 *
 * No hay captura de importes: el importe no se escribe, se toma del hecho que
 * ya ocurrió. Lo único que elige el usuario es la serie.
 *
 * Un formulario por fila haría desaparecer el mensaje de confirmación junto con
 * la fila que lo produjo, y el usuario se quedaría sin saber qué pasó. Con uno
 * solo para la sección, el mensaje sobrevive.
 */
export function EmitirDesde({
  tipo,
  pendientes,
  series,
}: {
  tipo: "retencion" | "percepcion";
  pendientes: Pendiente[];
  series: string[];
}) {
  const accionBase = tipo === "retencion" ? emitirRetencionAccion : emitirPercepcionAccion;
  const [estado, accion] = useActionState<EstadoForm, FormData>(accionBase, {});
  const campo = tipo === "retencion" ? "pagoId" : "cobranzaId";

  return (
    <form action={accion}>
      {series.length > 1 ? (
        <div className="mb-3">
          <label className="etiqueta" htmlFor={`serie-${tipo}`}>Serie</label>
          <select id={`serie-${tipo}`} name="serie" className="campo cifra" style={{ width: "8rem" }}>
            {series.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="serie" value={series[0] ?? ""} />
      )}

      {pendientes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
          No hay nada pendiente de documentar.
        </p>
      ) : (
        <div className="space-y-3">
          {pendientes.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3">
              <span className="cifra">{p.etiqueta}</span>
              <span style={{ color: "var(--texto-suave)" }}>{p.detalle}</span>
              <strong className="cifra">{formatearImporte(p.importe)}</strong>
              <button type="submit" name={campo} value={p.id} className="boton boton-primario">
                Emitir
              </button>
            </div>
          ))}
        </div>
      )}
      <Resultado estado={estado} />
    </form>
  );
}

export function EnviarRetencion({ retencionId, estado }: { retencionId: string; estado: string }) {
  const [res, accion] = useActionState<EstadoForm, FormData>(enviarRetencionAccion, {});
  if (estado === "aceptado" || estado === "aceptado_con_observaciones") {
    return <span style={{ color: "var(--texto-suave)" }}>—</span>;
  }
  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="retencionId" value={retencionId} />
      <Enviar texto="Enviar a SUNAT" tono="primario" />
      <Resultado estado={res} />
    </form>
  );
}
