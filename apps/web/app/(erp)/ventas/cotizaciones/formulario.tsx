"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearCotizacionAccion, type EstadoForm } from "./acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string; descripcion?: string; afectacion?: string };

type Linea = {
  clave: number;
  productoId: string;
  descripcion: string;
  cantidad: string;
  valorUnitario: string;
  afectacionIgv: string;
};

const AFECTACIONES = [
  ["10", "Gravado"],
  ["20", "Exonerado"],
  ["30", "Inafecto"],
  ["40", "Exportación"],
] as const;

const vacia = (): Omit<Linea, "clave"> => ({
  productoId: "",
  descripcion: "",
  cantidad: "1",
  valorUnitario: "",
  afectacionIgv: "10",
});

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Registrar cotización"}
    </button>
  );
}

export function FormularioCotizacion({
  clientes,
  productos,
}: {
  clientes: Opcion[];
  productos: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearCotizacionAccion, {});
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(vacia);
  const [abierto, setAbierto] = useState(false);
  const [moneda, setMoneda] = useState("PEN");
  const hoy = hoyEnPeru();


  const elegirProducto = (clave: number, productoId: string) => {
    const p = productos.find((x) => x.id === productoId);
    actualizar(clave, {
      productoId,
      ...(p ? { descripcion: p.descripcion ?? "", afectacionIgv: p.afectacion ?? "10" } : {}),
    });
  };

  // Vista previa con `Number`: el servidor recalcula con aritmética exacta.
  const base = lineas.reduce(
    (a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0),
    0,
  );
  const gravado = lineas
    .filter((l) => l.afectacionIgv === "10")
    .reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0), 0);
  const igv = gravado * 0.18;

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Nueva cotización
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Cotización</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="clienteId">Cliente *</label>
            <select id="clienteId" name="clienteId" required className="campo" defaultValue="">
              <option value="" disabled>Elija un cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="validaHasta">Válida hasta</label>
            <input id="validaHasta" name="validaHasta" type="date" className="campo" />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              En blanco, quince días.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="moneda">Moneda</label>
              <select
                id="moneda" name="moneda" className="campo"
                value={moneda} onChange={(e) => setMoneda(e.target.value)}
              >
                <option value="PEN">PEN</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="tipoCambio">T.C.</label>
              <input
                id="tipoCambio" name="tipoCambio" inputMode="decimal" className="campo"
                defaultValue="1" key={moneda} placeholder={moneda === "PEN" ? "1" : "3.75"} />
            </div>
          </div>
          <div>
            <label className="etiqueta" htmlFor="condicionPago">Condición de pago</label>
            <input id="condicionPago" name="condicionPago" maxLength={60} className="campo" placeholder="30 días" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Detalle</h2>
          <button
            type="button" className="boton boton-secundario !py-1 !text-xs"
            onClick={() => agregar()}
          >
            Agregar línea
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[200px]">Producto o servicio</th>
              <th className="min-w-[180px]">Descripción</th>
              <th className="w-24 text-right">Cantidad</th>
              <th className="w-28 text-right">V. unitario</th>
              <th className="w-32">IGV</th>
              <th className="w-28 text-right">Importe</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].productoId`} value={l.productoId}
                    onChange={(e) => elegirProducto(l.clave, e.target.value)}
                    className="campo !py-1 !text-xs"
                  >
                    <option value="">— servicio libre —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} value={l.descripcion}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                    className="campo !py-1 !text-xs" required={!l.productoId && i === 0} />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo cifra !py-1 !text-xs" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].valorUnitario`} value={l.valorUnitario} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { valorUnitario: e.target.value })}
                    className="campo cifra !py-1 !text-xs" />
                </td>
                <td>
                  <select
                    name={`lineas[${i}].afectacionIgv`} value={l.afectacionIgv}
                    onChange={(e) => actualizar(l.clave, { afectacionIgv: e.target.value })}
                    className="campo !py-1 !text-xs"
                  >
                    {AFECTACIONES.map(([c, t]) => (
                      <option key={c} value={c}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="cifra text-xs">
                  {formatearImporte(
                    String((Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0)),
                  )}
                </td>
                <td>
                  {lineas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar línea ${i + 1}`}
                      className="text-xs" style={{ color: "var(--peligro)" }}
                      onClick={() => quitar(l.clave)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-1.5 text-right text-xs uppercase">Valor de venta</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(base))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-1.5 text-right text-xs uppercase">IGV 18 %</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(igv))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(base + igv))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="flex gap-2">
        <Guardar />
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Una cotización no mueve inventario ni contabilidad: es un precio con fecha. Cuando el cliente
        acepta, se convierte en pedido y el precio queda congelado.
      </p>
    </form>
  );
}
