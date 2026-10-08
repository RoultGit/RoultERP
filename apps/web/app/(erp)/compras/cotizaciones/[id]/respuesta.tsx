"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registrarRespuestaAccion, type EstadoForm } from "../acciones";

export type LineaPedida = {
  solicitudItemId: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
};

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Registrar cotización"}
    </button>
  );
}

/**
 * Captura de lo que respondió un proveedor.
 *
 * Las líneas vienen dadas por la solicitud —no se inventan aquí— y la que se
 * deja sin precio se entiende como no cotizada, que es lo que pasa de verdad:
 * casi nadie cotiza la lista entera.
 */
export function FormularioRespuesta({
  solicitudId,
  proveedores,
  lineas,
  hoy,
}: {
  solicitudId: string;
  proveedores: { id: string; etiqueta: string }[];
  lineas: LineaPedida[];
  hoy: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(registrarRespuestaAccion, {});
  const [abierto, setAbierto] = useState(false);
  const [moneda, setMoneda] = useState("PEN");

  if (proveedores.length === 0) {
    return (
      <p className="bloque p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
        Todos los proveedores registrados ya respondieron esta solicitud.
      </p>
    );
  }

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Registrar la respuesta de un proveedor
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="solicitudId" value={solicitudId} />
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Cotización del proveedor</h2>
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
            <label className="etiqueta" htmlFor="referenciaProveedor">Su n.º de cotización</label>
            <input
              id="referenciaProveedor" name="referenciaProveedor" maxLength={40}
              className="campo" placeholder="COT-9912" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="validaHasta">Válida hasta</label>
            <input id="validaHasta" name="validaHasta" type="date" className="campo" />
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
            <label className="etiqueta" htmlFor="plazoEntregaDias">Entrega (días)</label>
            <input
              id="plazoEntregaDias" name="plazoEntregaDias" inputMode="numeric"
              className="campo cifra" placeholder="5" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="condicionPago">Condición de pago</label>
            <input
              id="condicionPago" name="condicionPago" maxLength={60}
              className="campo" placeholder="30 días" />
          </div>
        </div>
        {moneda !== "PEN" && (
          <p className="mt-2 text-xs" style={{ color: "var(--texto-suave)" }}>
            El tipo de cambio de esta oferta es el que se usa para compararla contra las demás.
          </p>
        )}
      </section>

      <section className="bloque overflow-x-auto">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
          Precios ofrecidos
        </h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Artículo</th>
              <th className="w-24 text-right">Pedido</th>
              <th className="w-28 text-right">Cotiza</th>
              <th className="w-32 text-right">V. unitario</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.solicitudItemId}>
                <td>
                  <input type="hidden" name={`lineas[${i}].solicitudItemId`} value={l.solicitudItemId} />
                  {l.descripcion}
                  <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                    {l.unidad}
                  </span>
                </td>
                <td className="cifra">{l.cantidad}</td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} inputMode="decimal"
                    className="campo campo-chico cifra" placeholder={l.cantidad} />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].valorUnitario`} inputMode="decimal"
                    className="campo campo-chico cifra" placeholder="—" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          Deje sin precio lo que el proveedor no cotizó. La cantidad sólo se llena si ofrece una
          distinta a la pedida —un empaque cerrado, por ejemplo—.
        </p>
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
