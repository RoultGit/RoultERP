"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  generarResumenAccion, generarBajaAccion, enviarResumenAccion, recogerTicketAccion,
  type EstadoForm,
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
    <div className="mt-2 text-xs">
      {(estado.motivos ?? (estado.error ? [estado.error] : [])).map((m) => (
        <p key={m} style={{ color: "var(--peligro)" }} role="alert">{m}</p>
      ))}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
    </div>
  );
}

export type DiaPendiente = { fecha: string; boletas: number; total: string };

/**
 * Días con boletas sin resumir, en un solo formulario.
 *
 * Un formulario por día parecía más natural, pero al generar el resumen ese día
 * desaparece de la lista y con él se iba el mensaje de confirmación: el usuario
 * pulsaba, la fila se esfumaba y nada le decía qué había pasado. Con un solo
 * formulario para toda la sección, el mensaje sobrevive a que la lista cambie.
 */
export function GenerarResumen({ dias }: { dias: DiaPendiente[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(generarResumenAccion, {});

  return (
    <form action={accion}>
      {dias.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
          No hay boletas pendientes de declarar.
        </p>
      ) : (
        <div className="space-y-3">
          {dias.map((d) => (
            <div key={d.fecha} className="flex flex-wrap items-center gap-3">
              <span className="cifra">{d.fecha}</span>
              <span style={{ color: "var(--texto-suave)" }}>
                {d.boletas} {d.boletas === 1 ? "boleta" : "boletas"} · {formatearImporte(d.total)}
              </span>
              {/* El día viaja en el propio botón: así un solo formulario sirve
                  para todas las filas sin duplicar estado. */}
              <button
                type="submit"
                name="fechaReferencia"
                value={d.fecha}
                className="boton boton-primario"
              >
                Generar resumen
              </button>
            </div>
          ))}
        </div>
      )}
      <Resultado estado={estado} />
    </form>
  );
}

export type ComprobanteVigente = {
  id: string;
  etiqueta: string;
  fecha: string;
  total: string;
};

/**
 * Comunicación de baja.
 *
 * Cada comprobante marcado necesita su motivo porque SUNAT lo lee: es texto que
 * mira una persona, no un código. Se marcan varios de una vez, pero todos del
 * mismo día —lo exige la propia comunicación—, así que se agrupan por fecha.
 */
export function GenerarBaja({ comprobantes }: { comprobantes: ComprobanteVigente[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(generarBajaAccion, {});
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  // Generada la baja, se desmarca todo: los comprobantes que entraron salen de
  // la lista, y dejar marcas de los que ya no están induce a pulsar de nuevo.
  useEffect(() => {
    if (estado.exito) setMarcados({});
  }, [estado.exito]);

  const porFecha = new Map<string, ComprobanteVigente[]>();
  for (const c of comprobantes) {
    porFecha.set(c.fecha, [...(porFecha.get(c.fecha) ?? []), c]);
  }

  return (
    <form action={accion}>
      <div className="space-y-4">
        {[...porFecha.entries()].map(([fecha, docs]) => (
          <div key={fecha}>
            <p className="mb-1.5 text-xs font-medium cifra" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
              {fecha}
            </p>
            <div className="space-y-2">
              {docs.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" name={`baja[${c.id}]`} value="1"
                      checked={marcados[c.id] ?? false}
                      onChange={(e) => setMarcados((m) => ({ ...m, [c.id]: e.target.checked }))}
                    />
                    <span className="cifra">{c.etiqueta}</span>
                    <span style={{ color: "var(--texto-suave)" }}>{formatearImporte(c.total)}</span>
                  </label>
                  {marcados[c.id] && (
                    <input
                      name={`motivo[${c.id}]`} required maxLength={250}
                      className="campo flex-1" style={{ minWidth: "16rem" }}
                      placeholder="Motivo de la baja (lo lee SUNAT)"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Enviar texto="Generar comunicación de baja" tono="primario" />
      </div>
      <Resultado estado={estado} />
    </form>
  );
}

/** Envío del resumen y recogida del ticket, en el mismo bloque. */
export function AccionesResumen({
  resumenId,
  estado,
  ticket,
}: {
  resumenId: string;
  estado: string;
  ticket: string | null;
}) {
  const [envio, accionEnvio] = useActionState<EstadoForm, FormData>(enviarResumenAccion, {});
  const [recogida, accionRecogida] = useActionState<EstadoForm, FormData>(recogerTicketAccion, {});

  const resuelto = estado === "aceptado" || estado === "aceptado_con_observaciones";

  return (
    <div className="flex flex-col items-end gap-1">
      {!ticket && estado !== "rechazado" && (
        <form action={accionEnvio}>
          <input type="hidden" name="resumenId" value={resumenId} />
          <Enviar texto="Enviar a SUNAT" tono="primario" />
        </form>
      )}
      {ticket && !resuelto && (
        <form action={accionRecogida}>
          <input type="hidden" name="resumenId" value={resumenId} />
          <Enviar texto="Consultar resultado" />
        </form>
      )}
      <Resultado estado={envio} />
      <Resultado estado={recogida} />
    </div>
  );
}
