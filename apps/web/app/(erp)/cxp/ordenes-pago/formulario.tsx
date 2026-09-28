"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearOrdenAccion, type EstadoForm } from "./acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

export type DocumentoOrdenable = {
  id: string;
  referencia: string;
  fechaEmision: string;
  fechaVencimiento: string;
  moneda: string;
  total: string;
  saldo: string;
  enOrden: string;
  libre: string;
};

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Creando…" : "Crear orden de pago"}
    </button>
  );
}

/**
 * Arma la orden marcando documentos.
 *
 * Lo que se ofrece es el saldo **libre**, no el total: mostrar el saldo entero
 * cuando la mitad ya está en otra orden es la forma de acabar pagando dos veces
 * la misma factura.
 */
export function FormularioOrden({
  proveedores,
  documentos,
  cuentas,
  proveedorId,
}: {
  proveedores: Opcion[];
  documentos: DocumentoOrdenable[];
  cuentas: Opcion[];
  proveedorId: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearOrdenAccion, {});
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [importes, setImportes] = useState<Record<string, string>>({});
  const hoy = hoyEnPeru();

  const total = documentos
    .filter((d) => marcados[d.id])
    .reduce((a, d) => a + (Number(importes[d.id] || d.libre) || 0), 0);

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="proveedorId" value={proveedorId} />

      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="tarjeta p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="proveedorSelect">Proveedor</label>
            <select
              id="proveedorSelect" className="campo" defaultValue={proveedorId}
              onChange={(e) => {
                window.location.href = `/cxp/ordenes-pago?proveedor=${e.target.value}`;
              }}
            >
              <option value="" disabled>Elija un proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaProgramada">Se propone pagar el</label>
            <input id="fechaProgramada" name="fechaProgramada" type="date" className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="medioPago">Medio de pago</label>
            <select id="medioPago" name="medioPago" className="campo" defaultValue="transferencia">
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="cuentaEfectivoId">De la cuenta</label>
            <select id="cuentaEfectivoId" name="cuentaEfectivoId" className="campo" defaultValue="">
              <option value="">—</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="retenerIgv" />
          Retener el IGV al ejecutar
        </label>
      </section>

      <section className="tarjeta overflow-x-auto">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
          Documentos por pagar
        </h2>
        {documentos.length === 0 ? (
          <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
            Este proveedor no tiene saldo libre que ordenar. Lo que debía puede estar ya en otra
            orden de pago.
          </p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-10" />
                <th>Documento</th>
                <th>Emisión</th>
                <th>Vence</th>
                <th className="text-right">Total</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">En otra orden</th>
                <th className="w-32 text-right">A ordenar</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox" name="documentoId" value={d.id}
                      checked={marcados[d.id] ?? false}
                      onChange={(e) =>
                        setMarcados((m) => ({ ...m, [d.id]: e.target.checked }))
                      }
                      aria-label={`Incluir ${d.referencia}`}
                    />
                  </td>
                  <td className="cifra" style={{ textAlign: "left" }}>{d.referencia}</td>
                  <td className="cifra">{d.fechaEmision}</td>
                  <td className="cifra">{d.fechaVencimiento}</td>
                  <td className="cifra">{formatearImporte(d.total)}</td>
                  <td className="cifra">{formatearImporte(d.saldo)}</td>
                  <td className="cifra" style={{ color: "var(--texto-suave)" }}>
                    {Number(d.enOrden) > 0 ? formatearImporte(d.enOrden) : "—"}
                  </td>
                  <td>
                    <input
                      name={`importe-${d.id}`} inputMode="decimal"
                      value={importes[d.id] ?? ""}
                      placeholder={d.libre}
                      disabled={!marcados[d.id]}
                      onChange={(e) => setImportes((i) => ({ ...i, [d.id]: e.target.value }))}
                      className="campo cifra !py-1 !text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "var(--superficie-2)" }}>
                <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                  Total de la orden
                </td>
                <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(total))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <Guardar />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        La orden no mueve dinero: pide permiso. El pago, su asiento y la salida de caja ocurren
        cuando alguien con permiso de aprobación la autoriza y la ejecuta.
      </p>
    </form>
  );
}
