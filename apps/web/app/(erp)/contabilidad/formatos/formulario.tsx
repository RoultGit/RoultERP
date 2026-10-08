"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarAccion, eliminarAccion, restaurarAccion, type EstadoForm } from "./acciones";

export type LineaEditable = {
  codigo: string;
  concepto: string;
  clase: string;
  nivel: number;
  cuentas: string;
  signo: string;
  suma: string;
  columna: string;
};

let siguiente = 0;
const vacia = (): LineaEditable & { clave: number } => ({
  clave: siguiente++,
  codigo: "",
  concepto: "",
  clase: "detalle",
  nivel: 1,
  cuentas: "",
  signo: "deudor",
  suma: "",
  columna: "",
});

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar formato"}
    </button>
  );
}

/**
 * Editor de una plantilla.
 *
 * Tres clases de renglón y ninguna más: título, detalle y total. Con un
 * lenguaje de fórmulas se puede escribir un estado que no cuadre, y aquí lo que
 * se configura es la presentación, no la aritmética.
 */
export function FormularioFormato({
  inicial,
}: {
  inicial: {
    codigo: string;
    nombre: string;
    tipo: string;
    esPredeterminado: boolean;
    lineas: LineaEditable[];
  } | null;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarAccion, {});
  const [tipo, setTipo] = useState(inicial?.tipo ?? "situacion");
  const [lineas, setLineas] = useState(
    inicial?.lineas.length
      ? inicial.lineas.map((l) => ({ ...l, clave: siguiente++ }))
      : [vacia()],
  );

  const actualizar = (clave: number, cambio: Partial<LineaEditable>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  const mover = (i: number, delta: number) =>
    setLineas((ls) => {
      const j = i + delta;
      if (j < 0 || j >= ls.length) return ls;
      const copia = [...ls];
      [copia[i], copia[j]] = [copia[j]!, copia[i]!];
      return copia;
    });

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
              className="campo cifra" style={{ textAlign: "left" }} placeholder="EFS" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="nombre">Nombre *</label>
            <input
              id="nombre" name="nombre" required maxLength={120}
              defaultValue={inicial?.nombre ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipo">Tipo *</label>
            <select
              id="tipo" name="tipo" className="campo"
              value={tipo} onChange={(e) => setTipo(e.target.value)}
            >
              <option value="situacion">Situación financiera</option>
              <option value="resultados">Resultados</option>
            </select>
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox" name="esPredeterminado"
            defaultChecked={inicial?.esPredeterminado ?? false}
          />
          Ofrecer este primero
        </label>
      </section>

      <section className="bloque overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Renglones</h2>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setLineas((ls) => [...ls, vacia()])}
          >
            Añadir renglón
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th className="w-24">Clase</th>
              <th className="w-24">Código</th>
              <th className="min-w-[200px]">Concepto</th>
              <th className="w-16">Nivel</th>
              <th className="min-w-[140px]">Cuentas</th>
              <th className="w-28">Signo</th>
              <th className="min-w-[160px]">Suma</th>
              {tipo === "situacion" && <th className="w-28">Columna</th>}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].clase`} value={l.clase}
                    onChange={(e) => actualizar(l.clave, { clase: e.target.value })}
                    className="campo campo-chico"
                  >
                    <option value="detalle">Detalle</option>
                    <option value="total">Total</option>
                    <option value="titulo">Título</option>
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].codigo`} value={l.codigo} maxLength={20}
                    onChange={(e) => actualizar(l.clave, { codigo: e.target.value })}
                    className="campo campo-chico" placeholder="efectivo" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].concepto`} value={l.concepto} maxLength={120}
                    onChange={(e) => actualizar(l.clave, { concepto: e.target.value })}
                    className="campo campo-chico" required={i === 0} />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].nivel`} value={String(l.nivel)} inputMode="numeric"
                    onChange={(e) => actualizar(l.clave, { nivel: Number(e.target.value) || 0 })}
                    className="campo campo-chico cifra" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cuentas`} value={l.cuentas} maxLength={120}
                    onChange={(e) => actualizar(l.clave, { cuentas: e.target.value })}
                    className="campo campo-chico cifra" style={{ textAlign: "left" }}
                    placeholder="12-18, 40111"
                    disabled={l.clase !== "detalle"} />
                </td>
                <td>
                  <select
                    name={`lineas[${i}].signo`} value={l.signo}
                    onChange={(e) => actualizar(l.clave, { signo: e.target.value })}
                    className="campo campo-chico"
                    disabled={l.clase !== "detalle"}
                  >
                    <option value="deudor">Deudor</option>
                    <option value="acreedor">Acreedor</option>
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].suma`} value={l.suma} maxLength={200}
                    onChange={(e) => actualizar(l.clave, { suma: e.target.value })}
                    className="campo campo-chico" placeholder="efectivo, cobrar"
                    disabled={l.clase !== "total"} />
                </td>
                {tipo === "situacion" && (
                  <td>
                    <select
                      name={`lineas[${i}].columna`} value={l.columna}
                      onChange={(e) => actualizar(l.clave, { columna: e.target.value })}
                      className="campo campo-chico"
                    >
                      <option value="">—</option>
                      <option value="activo">Activo</option>
                      <option value="pasivo">Pasivo</option>
                    </select>
                  </td>
                )}
                <td>
                  <div className="flex gap-1">
                    <button
                      type="button" aria-label={`Subir el renglón ${i + 1}`}
                      className="text-xs" onClick={() => mover(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button" aria-label={`Bajar el renglón ${i + 1}`}
                      className="text-xs" onClick={() => mover(i, 1)}
                    >
                      ↓
                    </button>
                    {lineas.length > 1 && (
                      <button
                        type="button" aria-label={`Quitar el renglón ${i + 1}`}
                        className="text-xs" style={{ color: "var(--peligro)" }}
                        onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          <li>· <strong>Cuentas</strong>: prefijos separados por coma. «12-18» son los siete grupos.</li>
          <li>· <strong>Acreedor</strong> invierte el saldo: el pasivo, el patrimonio y los ingresos se presentan en positivo.</li>
          <li>· <strong>Suma</strong>: códigos de renglones <em>anteriores</em>. Un total no puede mirar hacia adelante.</li>
        </ul>
      </section>

      <Guardar />
    </form>
  );
}

export function Eliminar({ formatoId }: { formatoId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(eliminarAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="formatoId" value={formatoId} />
      <button type="submit" className="boton boton-secundario">Eliminar</button>
      {estado.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </span>
      )}
    </form>
  );
}

export function Restaurar() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(restaurarAccion, {});
  return (
    <form action={accion} className="inline">
      <button type="submit" className="boton boton-secundario">Restaurar los de partida</button>
      {estado.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </span>
      )}
    </form>
  );
}
