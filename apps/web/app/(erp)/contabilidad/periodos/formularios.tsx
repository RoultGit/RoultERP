"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  cerrarPeriodoAccion, reabrirPeriodoAccion, ajustarCambioAccion, cerrarEjercicioAccion,
  type EstadoForm,
} from "../acciones";

function Enviar({ texto, tono }: { texto: string; tono: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${tono}`} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}

/**
 * Cierra o reabre un periodo.
 *
 * Cada fila lleva su propio formulario y su propio estado: el error de cerrar
 * setiembre —«quedan tres borradores»— tiene que salir junto a setiembre, no
 * en una franja arriba donde no se sabe a qué mes se refiere.
 */
export function AccionPeriodo({
  periodo,
  cerrado,
  puedeAprobar,
}: {
  periodo: string;
  cerrado: boolean;
  puedeAprobar: boolean;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(
    cerrado ? reabrirPeriodoAccion : cerrarPeriodoAccion,
    {},
  );

  if (!puedeAprobar) return <span style={{ color: "var(--texto-suave)" }}>—</span>;

  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="periodo" value={periodo} />
      <Enviar texto={cerrado ? "Reabrir" : "Cerrar"} tono={cerrado ? "secundario" : "primario"} />
      {estado.error &&
        (estado.motivos ?? [estado.error]).map((m) => (
          <span key={m} className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
            {m}
          </span>
        ))}
      {estado.exito && (
        <span className="text-xs" style={{ color: "var(--exito)" }}>{estado.exito}</span>
      )}
    </form>
  );
}

/**
 * Cierre anual, en dos pasos que no se pueden invertir.
 *
 * Primero se revalúan los saldos en moneda extranjera al tipo de cambio de
 * cierre; después se cancelan las cuentas de resultado. Al revés, la diferencia
 * de cambio quedaría fuera del resultado del año.
 */
export function CierreEjercicio({ ejercicio }: { ejercicio: string }) {
  const [ajuste, accionAjuste] = useActionState<EstadoForm, FormData>(ajustarCambioAccion, {});
  const [cierre, accionCierre] = useActionState<EstadoForm, FormData>(cerrarEjercicioAccion, {});

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="tarjeta p-4">
        <h2 className="mb-1 text-sm font-semibold">1 · Ajuste por diferencia de cambio</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          Revalúa las partidas monetarias en moneda extranjera —caja, cuentas por cobrar y por
          pagar— al tipo de cambio de cierre. Repetirlo al mismo tipo de cambio no mueve nada.
        </p>
        <form action={accionAjuste} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="etiqueta" htmlFor="ajuste-periodo">Periodo</label>
            <input
              id="ajuste-periodo" name="periodo" required pattern="\d{6}"
              defaultValue={`${ejercicio}12`} className="campo cifra" style={{ width: "7rem" }}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ajuste-fecha">Fecha</label>
            <input
              id="ajuste-fecha" name="fecha" type="date" required
              defaultValue={`${ejercicio}-12-31`} className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ajuste-tc">T. C. de cierre</label>
            <input
              id="ajuste-tc" name="tipoCambio" required inputMode="decimal"
              placeholder="3.750" className="campo cifra" style={{ width: "7rem" }}
            />
          </div>
          <Enviar texto="Ajustar" tono="secundario" />
        </form>
        <Resultado estado={ajuste} />
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-1 text-sm font-semibold">2 · Cierre del ejercicio</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          Cancela las cuentas de resultado contra la 89 y traslada el resultado a resultados
          acumulados, en el periodo 13. Cierra los doce meses del año: para deshacerlo hay que
          extornar los asientos y reabrir los periodos.
        </p>
        <form action={accionCierre} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="etiqueta" htmlFor="ejercicio">Ejercicio</label>
            <input
              id="ejercicio" name="ejercicio" required pattern="\d{4}"
              defaultValue={ejercicio} className="campo cifra" style={{ width: "7rem" }}
            />
          </div>
          <Enviar texto="Cerrar ejercicio" tono="primario" />
        </form>
        <Resultado estado={cierre} />
      </section>
    </div>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <div className="mt-3 text-xs">
      {(estado.motivos ?? (estado.error ? [estado.error] : [])).map((m) => (
        <p key={m} style={{ color: "var(--peligro)" }} role="alert">{m}</p>
      ))}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
    </div>
  );
}
