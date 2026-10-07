"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { definirAccion, procesarAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

type Linea = { clave: number; componenteId: string; cantidad: string };

let siguiente = 0;
const vacia = (): Linea => ({ clave: siguiente++, componenteId: "", cantidad: "1" });

function Boton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : children}
    </button>
  );
}

function Aviso({ estado }: { estado: EstadoForm }) {
  if (!estado.error) return null;
  return (
    <div className="aviso" role="alert">
      {(estado.motivos ?? [estado.error]).map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

/**
 * Define la receta de un producto.
 *
 * Un kit lleva varios componentes; una conversión, uno solo —el saco del que
 * salen las bolsas—, y la cantidad es la fracción de origen que consume **una**
 * unidad de destino: una bolsa de 1 kg consume 0.02 de un saco de 50.
 */
export function FormularioReceta({
  productos,
  productoId,
  tipoActual,
  componentesActuales,
}: {
  productos: Opcion[];
  productoId: string;
  tipoActual: string | null;
  componentesActuales: { componenteId: string; cantidad: string }[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(definirAccion, {});
  const [tipo, setTipo] = useState<"kit" | "conversion">(
    (tipoActual as "kit" | "conversion") ?? "kit",
  );
  const [lineas, setLineas] = useState<Linea[]>(
    componentesActuales.length > 0
      ? componentesActuales.map((c) => ({
          clave: siguiente++,
          componenteId: c.componenteId,
          cantidad: c.cantidad,
        }))
      : [vacia()],
  );

  const actualizar = (clave: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  // Una conversión sale de un solo origen: se recorta la lista al cambiar.
  const cambiarTipo = (t: "kit" | "conversion") => {
    setTipo(t);
    if (t === "conversion") setLineas((ls) => ls.slice(0, 1));
  };

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="productoId" value={productoId} />
      <input type="hidden" name="tipo" value={tipo} />
      <Aviso estado={estado} />

      <div className="flex flex-wrap gap-2">
        {(["kit", "conversion"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => cambiarTipo(t)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: tipo === t ? "var(--acento)" : "var(--borde)",
              background: tipo === t ? "var(--acento-suave)" : "var(--superficie)",
              color: tipo === t ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: tipo === t ? 500 : 400,
            }}
          >
            {t === "kit" ? "Kit" : "Conversión de unidades"}
          </button>
        ))}
      </div>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">
            {tipo === "kit" ? "Lleva" : "Sale de"}
          </h2>
          {tipo === "kit" && (
            <button
              type="button" className="boton boton-secundario boton-chico"
              onClick={() => setLineas((ls) => [...ls, vacia()])}
            >
              Añadir componente
            </button>
          )}
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="w-40 text-right">Por cada unidad</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].componenteId`} value={l.componenteId} required
                    onChange={(e) => actualizar(l.clave, { componenteId: e.target.value })}
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
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo campo-chico cifra" />
                </td>
                <td>
                  {lineas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar el componente ${i + 1}`}
                      className="text-xs" style={{ color: "var(--peligro)" }}
                      onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
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
          {tipo === "kit"
            ? "Cuánto consume una unidad del kit."
            : "Qué fracción del origen consume una unidad de destino: una bolsa de 1 kg gasta 0.02 de un saco de 50."}
        </p>
      </section>

      <Boton>Guardar composición</Boton>
    </form>
  );
}

/** Arma o desarma. Es la misma pantalla con el signo cambiado. */
export function FormularioProceso({
  productoId,
  almacenes,
  tipo,
}: {
  productoId: string;
  almacenes: Opcion[];
  tipo: string | null;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(procesarAccion, {});
  const [operacion, setOperacion] = useState<"armar" | "desarmar">("armar");
  const hoy = hoyEnPeru();
  const esConversion = tipo === "conversion";

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="productoId" value={productoId} />
      <input type="hidden" name="operacion" value={operacion} />
      <Aviso estado={estado} />

      <div className="flex flex-wrap gap-2">
        {(["armar", "desarmar"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOperacion(o)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: operacion === o ? "var(--acento)" : "var(--borde)",
              background: operacion === o ? "var(--acento-suave)" : "var(--superficie)",
              color: operacion === o ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: operacion === o ? 500 : 400,
            }}
          >
            {esConversion
              ? o === "armar"
                ? "Convertir"
                : "Volver al origen"
              : o === "armar"
                ? "Armar"
                : "Desarmar"}
          </button>
        ))}
      </div>

      <section className="tarjeta p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="almacenId">Almacén *</label>
            <select id="almacenId" name="almacenId" required className="campo" defaultValue="">
              <option value="" disabled>Elija el almacén</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="cantidad">Cantidad *</label>
            <input
              id="cantidad" name="cantidad" required inputMode="decimal"
              className="campo cifra" placeholder="0" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="glosa">Motivo</label>
            <input id="glosa" name="glosa" maxLength={200} className="campo" />
          </div>
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          {operacion === "armar"
            ? "Los componentes salen al costo del kardex y el producto entra por esa misma suma."
            : "El producto sale al costo del kardex y ese costo se reparte entre sus componentes."}
          {" "}No genera asiento: la mercadería no cambia de cuenta, sólo de forma.
        </p>
      </section>

      <Boton>
        {esConversion
          ? operacion === "armar"
            ? "Registrar la conversión"
            : "Registrar la vuelta al origen"
          : operacion === "armar"
            ? "Registrar el armado"
            : "Registrar el desarmado"}
      </Boton>
    </form>
  );
}
