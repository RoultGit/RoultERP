"use client";

/**
 * El expediente documental del embarque.
 *
 * La pantalla es una lista de acuse, no sólo un aviso: se enseña el catálogo
 * entero y no únicamente lo que falta, porque quien recibe los papeles va
 * marcando de arriba a abajo y necesita ver también lo que ya está. Lo que
 * cambia es el orden y el color: lo que ya hacía falta va primero y en rojo.
 *
 * Cada fila es un formulario independiente. Un formulario único para las nueve
 * filas obligaría a guardar todo de golpe, y el flujo real es al contrario:
 * llega un documento, se anota, se cierra. Con nueve filas en un solo envío,
 * corregir el número del B/L arriesgaría pisar lo que otra persona anotó abajo.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarDocumento, borrarDocumento, type EstadoAccion } from "./acciones";

export type FilaDocumento = {
  clave: string;
  nombre: string;
  exigible: boolean;
  antesDe: string;
  nota?: string;
  recibidoEn: string | null;
  referencia: string | null;
  noAplica: boolean;
  observaciones: string | null;
  vencido: boolean;
};

const HITO = {
  embarque: "antes de embarcar",
  llegada: "antes de la llegada",
  numeracion: "antes de numerar la DUA",
  liquidacion: "antes de liquidar",
} as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-secundario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

function Fila({
  importacionId,
  doc,
  editable,
}: {
  importacionId: string;
  doc: FilaDocumento;
  editable: boolean;
}) {
  const [estado, accion] = useActionState<EstadoAccion, FormData>(guardarDocumento, {});
  const [, quitar] = useActionState<EstadoAccion, FormData>(borrarDocumento, {});
  const recibido = !!doc.recibidoEn;

  const tono = doc.noAplica
    ? "var(--texto-suave)"
    : recibido
      ? "var(--exito)"
      : doc.vencido
        ? "var(--peligro)"
        : "var(--alerta)";

  return (
    <tr style={doc.vencido && !recibido ? { background: "color-mix(in srgb, var(--peligro) 6%, transparent)" } : undefined}>
      <td>
        <div className="flex items-start gap-2">
          <span aria-hidden style={{ color: tono }}>
            {doc.noAplica ? "—" : recibido ? "✓" : doc.vencido ? "!" : "·"}
          </span>
          <div>
            <div className="font-medium">
              {doc.nombre}
              {!doc.exigible && !recibido && !doc.noAplica ? (
                <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                  (según el caso)
                </span>
              ) : null}
            </div>
            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
              {HITO[doc.antesDe as keyof typeof HITO] ?? doc.antesDe}
              {doc.nota ? ` · ${doc.nota}` : ""}
            </div>
            {estado.error ? (
              <p className="aviso mt-1.5" role="alert">
                {estado.error}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      {editable ? (
        <td colSpan={3}>
          <form action={accion} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="importacionId" value={importacionId} />
            <input type="hidden" name="tipo" value={doc.clave} />
            <input
              type="date"
              name="recibidoEn"
              className="campo"
              defaultValue={doc.recibidoEn ?? ""}
              aria-label={`Fecha de recepción de ${doc.nombre}`}
              style={{ width: "9.5rem" }}
            />
            <input
              name="referencia"
              className="campo"
              defaultValue={doc.referencia ?? ""}
              placeholder="N.º del documento"
              maxLength={60}
              aria-label={`Número de ${doc.nombre}`}
              style={{ width: "11rem" }}
            />
            <input
              name="observaciones"
              className="campo"
              defaultValue={doc.observaciones ?? ""}
              placeholder="Observación"
              maxLength={160}
              aria-label={`Observación de ${doc.nombre}`}
              style={{ minWidth: "10rem", flex: 1 }}
            />
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input type="checkbox" name="noAplica" defaultChecked={doc.noAplica} />
              No aplica
            </label>
            <Guardar />
          </form>
        </td>
      ) : (
        <>
          <td className="cifra">{doc.recibidoEn ?? "—"}</td>
          <td>{doc.referencia ?? "—"}</td>
          <td style={{ color: "var(--texto-suave)" }}>
            {doc.noAplica ? "no aplica" : doc.observaciones ?? ""}
          </td>
        </>
      )}
      <td className="text-right">
        {editable && (recibido || doc.noAplica || doc.observaciones) ? (
          <form action={quitar}>
            <input type="hidden" name="importacionId" value={importacionId} />
            <input type="hidden" name="tipo" value={doc.clave} />
            <button type="submit" className="text-xs underline" style={{ color: "var(--texto-suave)" }}>
              Quitar
            </button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}

export function Expediente({
  importacionId,
  filas,
  vencidos,
  hito,
  editable,
}: {
  importacionId: string;
  filas: FilaDocumento[];
  vencidos: number;
  hito: string;
  editable: boolean;
}) {
  // Lo vencido primero: la lista existe para que alguien haga una llamada hoy.
  const orden = [...filas].sort(
    (a, b) =>
      Number(b.vencido && !b.recibidoEn) - Number(a.vencido && !a.recibidoEn) ||
      Number(!!b.recibidoEn) - Number(!!a.recibidoEn),
  );

  return (
    <section className="bloque overflow-x-auto">
      <div
        className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--borde)" }}
      >
        <h2 className="text-sm font-semibold">Expediente documental</h2>
        <p className="text-xs" style={{ color: vencidos ? "var(--peligro)" : "var(--texto-suave)" }}>
          {vencidos === 0
            ? `Al día para el hito «${HITO[hito as keyof typeof HITO] ?? hito}».`
            : `Faltan ${vencidos} documento${vencidos === 1 ? "" : "s"} que ya hacían falta.`}
        </p>
      </div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Documento</th>
            <th style={{ width: editable ? "auto" : "9rem" }}>Recibido</th>
            {editable ? null : <th>N.º</th>}
            {editable ? null : <th>Observación</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {orden.map((d) => (
            <Fila key={d.clave} importacionId={importacionId} doc={d} editable={editable} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
