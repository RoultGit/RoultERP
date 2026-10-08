"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarAccion, estadoAccion, type EstadoForm } from "./acciones";
import { formatearImporte } from "@/components/ui";

export type Opcion = { id: string; etiqueta: string };

export type PartidaEditable = {
  centroCostoId: string;
  cuenta: string;
  mes: string;
  importe: string;
};

let siguiente = 0;
const vacia = (): PartidaEditable & { clave: number } => ({
  clave: siguiente++,
  centroCostoId: "",
  cuenta: "",
  mes: "",
  importe: "",
});

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
] as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar presupuesto"}
    </button>
  );
}

/**
 * Editor de un presupuesto.
 *
 * Una partida sin mes es anual y se reparte en doceavas exactas: repartir por
 * redondeo dejaría la suma del año descuadrada respecto del total que alguien
 * aprobó.
 */
export function FormularioPresupuesto({
  centrosCosto,
  cuentas,
  inicial,
}: {
  centrosCosto: Opcion[];
  cuentas: Opcion[];
  inicial: {
    codigo: string;
    nombre: string;
    ejercicio: number;
    observaciones: string;
    partidas: PartidaEditable[];
  } | null;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarAccion, {});
  const [partidas, setPartidas] = useState(
    inicial?.partidas.length
      ? inicial.partidas.map((p) => ({ ...p, clave: siguiente++ }))
      : [vacia()],
  );

  const actualizar = (clave: number, cambio: Partial<PartidaEditable>) =>
    setPartidas((ps) => ps.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)));

  const total = partidas.reduce((a, p) => a + (Number(p.importe) || 0), 0);

  return (
    <form action={accion} className="space-y-4">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="bloque p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="codigo">Código *</label>
            <input
              id="codigo" name="codigo" required maxLength={20}
              defaultValue={inicial?.codigo ?? ""} readOnly={inicial !== null}
              className="campo cifra" style={{ textAlign: "left" }} placeholder="P2026" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="nombre">Nombre *</label>
            <input
              id="nombre" name="nombre" required maxLength={120}
              defaultValue={inicial?.nombre ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ejercicio">Ejercicio *</label>
            <input
              id="ejercicio" name="ejercicio" required inputMode="numeric"
              defaultValue={String(inicial?.ejercicio ?? new Date().getUTCFullYear())}
              className="campo cifra" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input
              id="observaciones" name="observaciones" maxLength={200}
              defaultValue={inicial?.observaciones ?? ""} className="campo" />
          </div>
        </div>
      </section>

      <section className="bloque overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Partidas</h2>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setPartidas((ps) => [...ps, vacia()])}
          >
            Añadir partida
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[200px]">Centro de costo</th>
              <th className="min-w-[200px]">Cuenta</th>
              <th className="w-32">Mes</th>
              <th className="w-32 text-right">Importe</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {partidas.map((p, i) => (
              <tr key={p.clave}>
                <td>
                  <select
                    name={`partidas[${i}].centroCostoId`} value={p.centroCostoId}
                    onChange={(e) => actualizar(p.clave, { centroCostoId: e.target.value })}
                    className="campo campo-chico"
                  >
                    <option value="">— sin centro —</option>
                    {centrosCosto.map((c) => (
                      <option key={c.id} value={c.id}>{c.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`partidas[${i}].cuenta`} value={p.cuenta} maxLength={10}
                    list="cuentas-presupuesto"
                    onChange={(e) => actualizar(p.clave, { cuenta: e.target.value })}
                    className="campo campo-chico cifra" style={{ textAlign: "left" }}
                    placeholder="63" required={i === 0} />
                </td>
                <td>
                  <select
                    name={`partidas[${i}].mes`} value={p.mes}
                    onChange={(e) => actualizar(p.clave, { mes: e.target.value })}
                    className="campo campo-chico"
                  >
                    <option value="">Todo el año</option>
                    {MESES.map((m, j) => (
                      <option key={m} value={String(j + 1)}>{m}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`partidas[${i}].importe`} value={p.importe} inputMode="decimal"
                    onChange={(e) => actualizar(p.clave, { importe: e.target.value })}
                    className="campo campo-chico cifra" placeholder="0.00" />
                </td>
                <td>
                  {partidas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar la partida ${i + 1}`}
                      className="text-xs" style={{ color: "var(--peligro)" }}
                      onClick={() => setPartidas((ps) => ps.filter((x) => x.clave !== p.clave))}
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
              <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                Total presupuestado
              </td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(total))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <datalist id="cuentas-presupuesto">
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>{c.etiqueta}</option>
          ))}
        </datalist>
        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          «Todo el año» reparte el importe en doce partes exactas. La cuenta es un prefijo: «63»
          recoge todo el grupo, «6351» sólo los alquileres de local.
        </p>
      </section>

      <Guardar />
    </form>
  );
}

/** Aprobar, reabrir, cerrar o eliminar. */
export function Estado({
  presupuestoId,
  estado,
}: {
  presupuestoId: string;
  estado: string;
}) {
  const [resultado, accion] = useActionState<EstadoForm, FormData>(estadoAccion, {});

  const acciones: { valor: string; texto: string; primario?: boolean }[] =
    estado === "borrador"
      ? [
          { valor: "aprobar", texto: "Aprobar", primario: true },
          { valor: "eliminar", texto: "Eliminar" },
        ]
      : estado === "aprobado"
        ? [
            { valor: "reabrir", texto: "Reabrir" },
            { valor: "cerrar", texto: "Cerrar" },
          ]
        : [];

  if (acciones.length === 0) {
    return <span className="text-xs" style={{ color: "var(--texto-suave)" }}>cerrado</span>;
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {acciones.map((a) => (
        <form key={a.valor} action={accion} className="inline">
          <input type="hidden" name="presupuestoId" value={presupuestoId} />
          <input type="hidden" name="accion" value={a.valor} />
          <Boton primario={a.primario}>{a.texto}</Boton>
        </form>
      ))}
      {resultado.error && (
        <span className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {resultado.error}
        </span>
      )}
    </div>
  );
}

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"} boton-chico`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}
