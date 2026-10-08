"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { crearImportacionAccion, type EstadoForm } from "../acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

/** Incoterms más usados en importación marítima peruana. */
const INCOTERMS = ["FOB", "CIF", "CFR", "EXW", "FCA", "DAP", "DDP"] as const;

function Crear() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Creando…" : "Crear importación"}
    </button>
  );
}

export function FormularioImportacion({
  proveedores,
  almacenes,
}: {
  proveedores: { id: string; nombre: string; pais: string; domiciliado: boolean }[];
  almacenes: { id: string; nombre: string; esTransito: boolean }[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearImportacionAccion, {});
  const hoy = hoyEnPeru();

  // Los del exterior primero: son los que realmente emiten una factura de
  // importación. Los nacionales aparecen porque el agente de aduanas o el
  // transportista también son proveedores de este embarque.
  const ordenados = [...proveedores].sort(
    (a, b) => Number(a.domiciliado) - Number(b.domiciliado) || a.nombre.localeCompare(b.nombre),
  );

  return (
    <form action={accion} className="max-w-3xl space-y-5">
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Datos del embarque</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="numero">Número *</label>
            <input
              id="numero" name="numero" required maxLength={40} className="campo"
              placeholder="IMP-2026-0016" autoFocus
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaOrden">Fecha de la orden *</label>
            <input
              id="fechaOrden" name="fechaOrden" type="date" required
              defaultValue={hoy} className="campo"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="proveedorId">Proveedor *</label>
            <select id="proveedorId" name="proveedorId" required className="campo" defaultValue="">
              <option value="" disabled>Elija un proveedor</option>
              {ordenados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} {p.domiciliado ? "" : `· ${p.pais}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="facturaExterior">Factura del exterior</label>
            <input id="facturaExterior" name="facturaExterior" maxLength={60} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="incoterm">Incoterm</label>
            <select id="incoterm" name="incoterm" defaultValue="FOB" className="campo">
              {INCOTERMS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-1 text-sm font-semibold">Moneda y tipo de cambio</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          Este tipo de cambio valoriza el FOB. Cada gasto lleva el suyo: el flete se paga a un tipo
          y el agente de aduanas a otro, con semanas de diferencia.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="moneda">Moneda de la factura *</label>
            <select id="moneda" name="moneda" defaultValue="USD" className="campo">
              <option value="USD">USD — dólares</option>
              <option value="EUR">EUR — euros</option>
              <option value="PEN">PEN — soles</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoCambio">Tipo de cambio *</label>
            <input
              id="tipoCambio" name="tipoCambio" inputMode="decimal" required
              className="campo" placeholder="3.752"
            />
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Logística</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="almacenId">Almacén de ingreso *</label>
            <select id="almacenId" name="almacenId" required className="campo" defaultValue="">
              <option value="" disabled>Elija un almacén</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {a.esTransito ? " (tránsito)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Al liquidar, la mercadería ingresa aquí con su costo real.
            </p>
          </div>
          <div />
          <div>
            <label className="etiqueta" htmlFor="puertoOrigen">Puerto de origen</label>
            <input id="puertoOrigen" name="puertoOrigen" maxLength={80} className="campo" placeholder="Ningbo, CN" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="puertoDestino">Puerto de destino</label>
            <input id="puertoDestino" name="puertoDestino" maxLength={80} className="campo" placeholder="Callao, PE" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <textarea id="observaciones" name="observaciones" rows={2} className="campo" />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Crear />
        <Link href="/importaciones" className="boton boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
