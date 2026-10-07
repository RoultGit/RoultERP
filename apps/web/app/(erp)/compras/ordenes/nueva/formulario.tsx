"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearOrdenAccion, type EstadoForm } from "../../acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string; descripcion?: string };

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
] as const;

const vacia = (): Omit<Linea, "clave"> => ({
  productoId: "",
  descripcion: "",
  cantidad: "1",
  valorUnitario: "",
  afectacionIgv: "10",
});

function Emitir() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Emitiendo…" : "Emitir orden"}
    </button>
  );
}

export function FormularioOrden({
  proveedores,
  productos,
  almacenes,
}: {
  proveedores: Opcion[];
  productos: Opcion[];
  almacenes: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearOrdenAccion, {});
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(vacia);
  const [moneda, setMoneda] = useState("PEN");
  const hoy = hoyEnPeru();


  const elegirProducto = (clave: number, productoId: string) => {
    const p = productos.find((x) => x.id === productoId);
    actualizar(clave, { productoId, ...(p ? { descripcion: p.descripcion ?? "" } : {}) });
  };

  // Vista previa: el servidor recalcula con aritmética exacta.
  const base = lineas.reduce(
    (a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0),
    0,
  );
  const gravado = lineas
    .filter((l) => l.afectacionIgv === "10")
    .reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0), 0);
  const igv = gravado * 0.18;

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Orden</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="proveedorId">Proveedor *</label>
            <select id="proveedorId" name="proveedorId" required className="campo" defaultValue="">
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
            <label className="etiqueta" htmlFor="fechaEntrega">Entrega</label>
            <input id="fechaEntrega" name="fechaEntrega" type="date" className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="almacenId">Almacén de destino</label>
            <select id="almacenId" name="almacenId" className="campo" defaultValue="">
              <option value="">—</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.etiqueta}</option>
              ))}
            </select>
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
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          El número se asigna solo, con el correlativo del año.
        </p>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Detalle</h2>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => agregar()}
          >
            Agregar línea
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[200px]">Producto *</th>
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
                    name={`lineas[${i}].productoId`} value={l.productoId} required={i === 0}
                    onChange={(e) => elegirProducto(l.clave, e.target.value)}
                    className="campo campo-chico"
                  >
                    <option value="">— elija —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} value={l.descripcion}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                    className="campo campo-chico" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo campo-chico cifra" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].valorUnitario`} value={l.valorUnitario} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { valorUnitario: e.target.value })}
                    className="campo campo-chico cifra" />
                </td>
                <td>
                  <select
                    name={`lineas[${i}].afectacionIgv`} value={l.afectacionIgv}
                    onChange={(e) => actualizar(l.clave, { afectacionIgv: e.target.value })}
                    className="campo campo-chico"
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
              <td colSpan={5} className="px-3 py-1.5 text-right text-xs uppercase">Valor de compra</td>
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
        <Emitir />
        <Link href="/compras?vista=ordenes" className="boton boton-secundario">Cancelar</Link>
      </div>

      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        La orden es un compromiso, no un hecho contable: no mueve inventario ni asientos. Nace en
        borrador y hay que aprobarla antes de mandarla al proveedor.
      </p>
    </form>
  );
}
