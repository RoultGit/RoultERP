"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarReglasAccion, contabilizarAccion, type EstadoForm } from "./acciones";

export type Opcion = { id: string; etiqueta: string };

export type ReglaEditable = { cuenta: string; centroCostoId: string; cuentaDestino: string };

let siguiente = 0;
const vacia = (): ReglaEditable & { clave: number } => ({
  clave: siguiente++,
  cuenta: "",
  centroCostoId: "",
  cuentaDestino: "94",
});

const DESTINOS = [
  ["92", "Costo de producción"],
  ["94", "Gastos de administración"],
  ["95", "Gastos de ventas"],
  ["97", "Gastos financieros"],
] as const;

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"}`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}

/**
 * Reglas de destino.
 *
 * Gana la más específica: nombrar centro de costo pesa más que nombrar sólo la
 * cuenta, y entre dos de la misma clase gana la del prefijo más largo. Se dice
 * en pantalla porque de otro modo el usuario no tiene forma de saber cuál se
 * aplicó.
 */
export function FormularioReglas({
  centrosCosto,
  iniciales,
}: {
  centrosCosto: Opcion[];
  iniciales: ReglaEditable[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarReglasAccion, {});
  const [reglas, setReglas] = useState(
    iniciales.length ? iniciales.map((r) => ({ ...r, clave: siguiente++ })) : [vacia()],
  );

  const actualizar = (clave: number, cambio: Partial<ReglaEditable>) =>
    setReglas((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)));

  return (
    <form action={accion} className="space-y-4">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Reglas</h2>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setReglas((rs) => [...rs, vacia()])}
          >
            Añadir regla
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[180px]">Cuenta de gasto</th>
              <th className="min-w-[220px]">Centro de costo</th>
              <th className="min-w-[220px]">Va a</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {reglas.map((r, i) => (
              <tr key={r.clave}>
                <td>
                  <input
                    name={`reglas[${i}].cuenta`} value={r.cuenta} maxLength={10}
                    onChange={(e) => actualizar(r.clave, { cuenta: e.target.value })}
                    className="campo campo-chico cifra" style={{ textAlign: "left" }}
                    placeholder="cualquiera" />
                </td>
                <td>
                  <select
                    name={`reglas[${i}].centroCostoId`} value={r.centroCostoId}
                    onChange={(e) => actualizar(r.clave, { centroCostoId: e.target.value })}
                    className="campo campo-chico"
                  >
                    <option value="">— cualquiera —</option>
                    {centrosCosto.map((c) => (
                      <option key={c.id} value={c.id}>{c.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    name={`reglas[${i}].cuentaDestino`} value={r.cuentaDestino}
                    onChange={(e) => actualizar(r.clave, { cuentaDestino: e.target.value })}
                    className="campo campo-chico"
                  >
                    {DESTINOS.map(([c, t]) => (
                      <option key={c} value={c}>{c} — {t}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {reglas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar la regla ${i + 1}`}
                      className="text-xs" style={{ color: "var(--peligro)" }}
                      onClick={() => setReglas((rs) => rs.filter((x) => x.clave !== r.clave))}
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
          Gana la regla más específica: el centro de costo pesa más que la cuenta, y entre dos
          cuentas gana el prefijo más largo. Dejar la cuenta en blanco es «cualquier gasto».
        </p>
      </section>

      <Boton primario>Guardar reglas</Boton>
    </form>
  );
}

export function Contabilizar({ periodo }: { periodo: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(contabilizarAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="periodo" value={periodo} />
      <Boton primario>Contabilizar el destino</Boton>
      {estado.error && (
        <p className="mt-1 text-sm" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
