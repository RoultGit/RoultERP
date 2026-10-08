"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { emitirNotaAccion, type EstadoForm } from "../../acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type ItemOriginal = {
  linea: number;
  productoId: string | null;
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  valorUnitario: string;
  afectacionIgv: string;
};

/** Catálogo 09 de SUNAT. */
const MOTIVOS_CREDITO = [
  ["01", "Anulación de la operación"],
  ["02", "Anulación por error en el RUC"],
  ["03", "Corrección por error en la descripción"],
  ["04", "Descuento global"],
  ["05", "Descuento por ítem"],
  ["06", "Devolución total"],
  ["07", "Devolución por ítem"],
  ["08", "Bonificación"],
  ["09", "Disminución en el valor"],
  ["10", "Otros conceptos"],
] as const;

/** Catálogo 10 de SUNAT. */
const MOTIVOS_DEBITO = [
  ["01", "Intereses por mora"],
  ["02", "Aumento en el valor"],
  ["03", "Penalidades u otros conceptos"],
] as const;

function Emitir() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Emitiendo…" : "Emitir nota"}
    </button>
  );
}

/**
 * Emisión de una nota sobre un comprobante ya enviado.
 *
 * El alcance total es el predeterminado y es también el que no admite errores:
 * copia el comprobante entero. El parcial abre las líneas del original para
 * ajustar cantidades, que es como se documenta una devolución de dos de diez.
 */
export function FormularioNota({
  comprobanteId,
  documento,
  moneda,
  seriesCredito,
  seriesDebito,
  items,
  tieneAlmacen,
}: {
  comprobanteId: string;
  documento: string;
  moneda: string;
  seriesCredito: string[];
  seriesDebito: string[];
  items: ItemOriginal[];
  tieneAlmacen: boolean;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(emitirNotaAccion, {});
  const [tipo, setTipo] = useState("07");
  const [alcance, setAlcance] = useState<"total" | "parcial">("total");
  const [cantidades, setCantidades] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.linea, i.cantidad])),
  );

  const esCredito = tipo === "07";
  const series = esCredito ? seriesCredito : seriesDebito;
  const motivos = esCredito ? MOTIVOS_CREDITO : MOTIVOS_DEBITO;

  const num = (v: string) => Number(v) || 0;
  const base =
    alcance === "total"
      ? items.reduce((a, i) => a + num(i.cantidad) * num(i.valorUnitario), 0)
      : items.reduce((a, i) => a + num(cantidades[i.linea] ?? "0") * num(i.valorUnitario), 0);

  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="comprobanteId" value={comprobanteId} />
      <input type="hidden" name="alcance" value={alcance} />

      {estado.error && <p className="aviso" role="alert">{estado.error}</p>}

      {series.length === 0 && (
        <p className="aviso">
          No hay ninguna serie registrada para {esCredito ? "notas de crédito" : "notas de débito"}.
          Créela en Facturación electrónica antes de emitir.
        </p>
      )}

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Nota sobre {documento}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="tipoDocumento">Tipo *</label>
            <select
              id="tipoDocumento" name="tipoDocumento" className="campo" value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              <option value="07">07 — Nota de crédito</option>
              <option value="08">08 — Nota de débito</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="serie">Serie *</label>
            <select id="serie" name="serie" required className="campo cifra" key={tipo}>
              {series.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaEmision">Fecha de emisión *</label>
            <input
              id="fechaEmision" name="fechaEmision" type="date" required className="campo"
              defaultValue={hoyEnPeru()}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="motivo">Motivo *</label>
            <select id="motivo" name="motivo" required className="campo" key={`m-${tipo}`}>
              {motivos.map(([codigo, texto]) => (
                <option key={codigo} value={codigo}>{codigo} — {texto}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="etiqueta" htmlFor="descripcionMotivo">Sustento *</label>
            <input
              id="descripcionMotivo" name="descripcionMotivo" required maxLength={250}
              className="campo" placeholder="Devolución de la mercadería por no conformidad"
            />
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Alcance</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio" name="alcanceUi" checked={alcance === "total"}
              onChange={() => setAlcance("total")}
            />
            Todo el comprobante
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio" name="alcanceUi" checked={alcance === "parcial"}
              onChange={() => setAlcance("parcial")}
            />
            Sólo parte
          </label>
        </div>

        {alcance === "parcial" && (
          <div className="mt-4 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="text-right">Del original</th>
                  <th className="text-right">V. unitario</th>
                  <th className="text-right">Cantidad de la nota</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.linea}>
                    <td>
                      {it.descripcion}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        {it.codigo}
                      </span>
                      {/* Las líneas viajan con los mismos nombres que usa la
                          emisión de la venta, para reutilizar su lector. */}
                      <input type="hidden" name={`lineas[${i}].productoId`} value={it.productoId ?? ""} />
                      <input type="hidden" name={`lineas[${i}].descripcion`} value={it.descripcion} />
                      <input type="hidden" name={`lineas[${i}].valorUnitario`} value={it.valorUnitario} />
                      <input type="hidden" name={`lineas[${i}].afectacionIgv`} value={it.afectacionIgv} />
                    </td>
                    <td><span className="cifra">{formatearImporte(it.cantidad)}</span></td>
                    <td><span className="cifra">{formatearImporte(it.valorUnitario, 4)}</span></td>
                    <td>
                      <input
                        name={`lineas[${i}].cantidad`} className="campo cifra text-right"
                        inputMode="decimal" value={cantidades[it.linea] ?? ""}
                        onChange={(e) =>
                          setCantidades((c) => ({ ...c, [it.linea]: e.target.value }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          Valor de venta de la nota: <span className="cifra">{formatearImporte(String(base))}</span>{" "}
          {moneda} · el IGV y el total los calcula el servidor.
        </p>
      </section>

      {esCredito && tieneAlmacen && (
        <section className="bloque p-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="devuelveMercaderia" value="1" className="mt-0.5" />
            <span>
              Devolver la mercadería al almacén
              <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
                Reingresa al kardex al costo con el que salió. Márquelo sólo si la mercadería
                volvió físicamente: una anulación por error en el RUC no mueve stock.
              </span>
            </span>
          </label>
        </section>
      )}

      <div className="flex gap-2">
        <Emitir />
        <Link href={`/ventas/${comprobanteId}` as Route} className="boton boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
