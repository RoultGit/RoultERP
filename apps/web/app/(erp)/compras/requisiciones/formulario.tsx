"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearRequisicionAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string };

type Linea = {
  clave: number;
  productoId: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  observaciones: string;
};

const vacia = (): Omit<Linea, "clave"> => ({
  productoId: "",
  descripcion: "",
  unidad: "",
  cantidad: "1",
  observaciones: "",
});

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Registrar requisición"}
    </button>
  );
}

export function FormularioRequisicion({
  productos,
  almacenes,
  centrosCosto,
}: {
  productos: Opcion[];
  almacenes: Opcion[];
  centrosCosto: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearRequisicionAccion, {});
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<"compra" | "servicio">("compra");
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(vacia);
  const hoy = hoyEnPeru();


  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Nueva requisición
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
      <input type="hidden" name="tipo" value={tipo} />

      <div className="flex flex-wrap gap-2">
        {(["compra", "servicio"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: tipo === t ? "var(--acento)" : "var(--borde)",
              background: tipo === t ? "var(--acento-suave)" : "var(--superficie)",
              color: tipo === t ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: tipo === t ? 500 : 400,
            }}
          >
            {t === "compra" ? "De bienes" : "De servicio"}
          </button>
        ))}
      </div>

      <section className="tarjeta p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          {tipo === "compra"
            ? "Lo que el área necesita del almacén o del mercado. No compromete a nadie hasta que se apruebe."
            : "Un servicio que el área necesita contratar: mantenimiento, flete, alquiler."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaRequerida">Se necesita para</label>
            <input id="fechaRequerida" name="fechaRequerida" type="date" className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="area">Área solicitante</label>
            <input id="area" name="area" maxLength={60} className="campo" placeholder="Obra San Miguel" />
          </div>
          {tipo === "compra" && (
            <div>
              <label className="etiqueta" htmlFor="almacenId">Almacén de destino</label>
              <select id="almacenId" name="almacenId" className="campo" defaultValue="">
                <option value="">—</option>
                {almacenes.map((a) => (
                  <option key={a.id} value={a.id}>{a.etiqueta}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="etiqueta" htmlFor="centroCostoId">Centro de costo</label>
            <select id="centroCostoId" name="centroCostoId" className="campo" defaultValue="">
              <option value="">—</option>
              {centrosCosto.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Justificación</label>
            <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
          </div>
        </div>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Artículos</h2>
          <button
            type="button" className="boton boton-secundario !py-1 !text-xs"
            onClick={() => agregar()}
          >
            Añadir artículo
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[200px]">Producto</th>
              <th className="min-w-[200px]">Descripción</th>
              <th className="w-20">Unidad</th>
              <th className="w-24 text-right">Cantidad</th>
              <th className="min-w-[160px]">Observaciones</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].productoId`} value={l.productoId}
                    onChange={(e) => actualizar(l.clave, { productoId: e.target.value })}
                    className="campo !py-1 !text-xs"
                  >
                    <option value="">— sin código —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} value={l.descripcion}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                    className="campo !py-1 !text-xs"
                    placeholder={l.productoId ? "" : "Un torno de banco"}
                    required={!l.productoId && i === 0}
                  />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].unidad`} value={l.unidad} maxLength={4}
                    onChange={(e) => actualizar(l.clave, { unidad: e.target.value })}
                    className="campo !py-1 !text-xs" placeholder="NIU" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo cifra !py-1 !text-xs" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].observaciones`} value={l.observaciones} maxLength={120}
                    onChange={(e) => actualizar(l.clave, { observaciones: e.target.value })}
                    className="campo !py-1 !text-xs" />
                </td>
                <td>
                  {lineas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar el artículo ${i + 1}`}
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
        </table>
        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          Se puede pedir algo que todavía no existe como producto: basta la descripción.
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
