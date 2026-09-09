"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { enviarASunatAccion, type EstadoForm } from "../acciones";
import { Insignia } from "@/components/ui";

/**
 * Lo que el usuario necesita saber en cada estado.
 *
 * El estado interno tiene más matices que los que le sirven a quien está en la
 * pantalla: borrador, firmado y enviado son, para él, «todavía no hay respuesta
 * de SUNAT».
 */
const EXPLICACION: Record<string, { titulo: string; texto: string; tono: "exito" | "alerta" | "peligro" | "neutro" }> = {
  aceptado: {
    titulo: "Aceptado por SUNAT",
    texto: "El comprobante está informado. El CDR es la constancia y queda guardado.",
    tono: "exito",
  },
  aceptado_con_observaciones: {
    titulo: "Aceptado con observaciones",
    texto:
      "El comprobante es válido. Las observaciones son advertencias que conviene corregir en los siguientes.",
    tono: "alerta",
  },
  rechazado: {
    titulo: "Rechazado por SUNAT",
    texto:
      "Este comprobante no vale. Corrija lo que indica el mensaje y emita uno nuevo; el rechazado no se puede reparar.",
    tono: "peligro",
  },
  anulado: {
    titulo: "Anulado",
    texto: "Se comunicó la baja a SUNAT.",
    tono: "peligro",
  },
};

const PENDIENTE = {
  titulo: "Pendiente de informar",
  texto:
    "El comprobante está emitido y contabilizado. Falta enviarlo a SUNAT, lo que puede hacerse ahora o después.",
  tono: "alerta" as const,
};

function Enviar({ reintento }: { reintento: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario w-full" disabled={pending}>
      {pending ? "Enviando a SUNAT…" : reintento ? "Reintentar envío" : "Enviar a SUNAT"}
    </button>
  );
}

export function PanelSunat({
  comprobanteId,
  estado,
  codigo,
  mensaje,
  observaciones,
  hash,
  enviadoEn,
  tieneCdr,
  puedeEnviar,
}: {
  comprobanteId: string;
  estado: string;
  codigo: number | null;
  mensaje: string | null;
  observaciones: string[];
  hash: string | null;
  enviadoEn: string | null;
  tieneCdr: boolean;
  puedeEnviar: boolean;
}) {
  const [resultado, accion] = useActionState<EstadoForm, FormData>(enviarASunatAccion, {});

  const info = EXPLICACION[estado] ?? PENDIENTE;
  const aceptado = estado === "aceptado" || estado === "aceptado_con_observaciones";
  const puedeReintentar = !aceptado && estado !== "anulado";

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <section className="tarjeta">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
          Estado ante SUNAT
        </h2>

        <div className="p-4">
          <Insignia tono={info.tono}>{info.titulo}</Insignia>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--texto-suave)" }}>
            {info.texto}
          </p>

          {mensaje && (
            <p className="mt-3 rounded border px-3 py-2 text-sm"
               style={{ borderColor: "var(--borde)", background: "var(--superficie-2)" }}>
              {codigo !== null && (
                <span className="cifra mr-1.5" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
                  [{codigo}]
                </span>
              )}
              {mensaje}
            </p>
          )}

          {observaciones.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs" style={{ color: "var(--alerta)" }}>
              {observaciones.map((o) => (
                <li key={o}>· {o}</li>
              ))}
            </ul>
          )}

          <dl className="mt-4 space-y-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            {enviadoEn && (
              <div className="flex justify-between gap-3">
                <dt>Enviado</dt>
                <dd className="cifra">{enviadoEn.slice(0, 19).replace("T", " ")}</dd>
              </div>
            )}
            {tieneCdr && (
              <div className="flex justify-between gap-3">
                <dt>CDR</dt>
                <dd>guardado</dd>
              </div>
            )}
            {hash && (
              <div>
                <dt className="mb-0.5">Resumen del XML</dt>
                {/* El hash va impreso en la representación del comprobante. */}
                <dd className="cifra break-all" style={{ textAlign: "left" }}>{hash}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {puedeEnviar && puedeReintentar && (
        <form action={accion} className="tarjeta space-y-3 p-4">
          <input type="hidden" name="comprobanteId" value={comprobanteId} />

          {resultado.error && (
            <p className="aviso" role="alert">
              {resultado.error}
            </p>
          )}
          {resultado.exito && (
            <p className="rounded border px-3 py-2 text-sm"
               style={{ color: "var(--exito)", borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)" }}
               role="status">
              {resultado.exito}
            </p>
          )}

          <Enviar reintento={estado !== "borrador"} />

          <p className="text-xs leading-relaxed" style={{ color: "var(--texto-suave)" }}>
            Reenviar un comprobante que SUNAT ya registró no lo duplica: el sistema reconoce esa
            respuesta y lo marca como aceptado.
          </p>
        </form>
      )}

      {aceptado && (
        <p className="tarjeta px-4 py-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          Para dejar sin efecto un comprobante aceptado hay que emitir una nota de crédito o
          comunicar su baja; ninguna de las dos está implementada todavía.
        </p>
      )}
    </aside>
  );
}
