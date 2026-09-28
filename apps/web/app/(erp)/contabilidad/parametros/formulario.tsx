"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarAccion, type EstadoForm } from "./acciones";

export type Parametro = {
  clave: string;
  nombre: string;
  descripcion: string;
  modulo: string;
  cuenta: string;
  porDefecto: string;
  personalizada: boolean;
  descripcionCuenta: string | null;
};

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar cuentas"}
    </button>
  );
}

/**
 * Configuración de las cuentas de integración.
 *
 * Se elige de una lista, no se teclea: sólo se ofrecen cuentas que admiten
 * movimiento, que son las únicas que pueden recibir un asiento. Al lado de cada
 * una se recuerda cuál es la de partida, para poder volver.
 */
export function FormularioParametros({
  parametros,
  cuentas,
}: {
  parametros: Parametro[];
  cuentas: { cuenta: string; descripcion: string }[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarAccion, {});
  const modulos = [...new Set(parametros.map((p) => p.modulo))];

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {modulos.map((modulo) => (
        <section key={modulo} className="tarjeta overflow-x-auto">
          <h2
            className="border-b px-4 py-2.5 text-sm font-semibold"
            style={{ borderColor: "var(--borde)" }}
          >
            {modulo}
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Cuándo se usa</th>
                <th className="w-[320px]">Cuenta</th>
                <th>De partida</th>
              </tr>
            </thead>
            <tbody>
              {parametros
                .filter((p) => p.modulo === modulo)
                .map((p) => (
                  <tr key={p.clave}>
                    <td className="font-medium">{p.nombre}</td>
                    <td className="max-w-[360px] text-sm" style={{ color: "var(--texto-suave)" }}>
                      {p.descripcion}
                    </td>
                    <td>
                      <select name={p.clave} defaultValue={p.cuenta} className="campo">
                        {cuentas.map((c) => (
                          <option key={c.cuenta} value={c.cuenta}>
                            {c.cuenta} — {c.descripcion}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="cifra text-sm" style={{ color: "var(--texto-suave)" }}>
                      {p.personalizada ? p.porDefecto : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}

      <Guardar />
    </form>
  );
}
