"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { confirmar, type EstadoAccion } from "./acciones";
import { Importe } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type VistaLiquidacion = {
  fobTotal: string;
  gastosCosto: string;
  gastosNoCosto: string;
  costoTotal: string;
  noCosto: { concepto: string; importe: string }[];
  cuadra: boolean;
  diferencias: { concepto: string; esperado: string; repartido: string }[];
};

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario w-full" disabled={pending}>
      {pending ? "Confirmando…" : "Confirmar liquidación"}
    </button>
  );
}

export function PanelLiquidacion({
  importacionId,
  estado,
  vista,
  puedeConfirmar,
}: {
  importacionId: string;
  estado: string;
  vista: VistaLiquidacion | null;
  puedeConfirmar: boolean;
}) {
  const [resultado, accion] = useActionState<EstadoAccion, FormData>(confirmar, {});
  const liquidada = estado === "liquidada";
  const hoy = hoyEnPeru();

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <section className="bloque">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
          Liquidación
        </h2>

        {!vista ? (
          <p className="px-4 py-6 text-sm" style={{ color: "var(--texto-suave)" }}>
            Agregue al menos un ítem para ver el cálculo.
          </p>
        ) : (
          <>
            <dl className="divide-y text-sm" style={{ borderColor: "var(--borde)" }}>
              <Fila etiqueta="FOB en soles" valor={vista.fobTotal} />
              <Fila etiqueta="Gastos que son costo" valor={vista.gastosCosto} />
              <Fila etiqueta="Costo de la mercadería" valor={vista.costoTotal} destacado />
            </dl>

            {vista.noCosto.length > 0 && (
              <div className="border-t px-4 py-3" style={{ borderColor: "var(--borde)" }}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
                  Fuera del costo
                </p>
                <dl className="space-y-1 text-sm">
                  {vista.noCosto.map((n) => (
                    <div key={n.concepto} className="flex justify-between gap-3">
                      <dt style={{ color: "var(--texto-suave)" }}>{n.concepto}</dt>
                      <dd>
                        <Importe valor={n.importe} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--texto-suave)" }}>
                  Son crédito fiscal y pagos a cuenta: van a las cuentas 40111 y 40113, no al
                  inventario.
                </p>
              </div>
            )}

            {!vista.cuadra && (
              <div className="border-t px-4 py-3" style={{ borderColor: "var(--borde)" }}>
                <p className="aviso">
                  El prorrateo no cuadra con los gastos registrados. No se puede liquidar hasta
                  corregirlo.
                </p>
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--texto-suave)" }}>
                  {vista.diferencias.map((d) => (
                    <li key={d.concepto}>
                      {d.concepto}: se esperaba {d.esperado} y se repartió {d.repartido}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {vista && !liquidada && puedeConfirmar && (
        <form action={accion} className="bloque space-y-3 p-4">
          <input type="hidden" name="importacionId" value={importacionId} />

          {resultado.error && (
            <p className="aviso" role="alert">
              {resultado.error}
            </p>
          )}
          {resultado.exito && (
            <p className="rounded border px-3 py-2 text-sm"
               style={{ color: "var(--exito)", borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)" }}
               role="status">
              {resultado.exito}
            </p>
          )}

          <div>
            <label className="etiqueta" htmlFor="numero">
              Número de liquidación
            </label>
            <input id="numero" name="numero" className="campo" required defaultValue="" placeholder="LIQ-2026-001" />
          </div>

          <div>
            <label className="etiqueta" htmlFor="fecha">
              Fecha
            </label>
            <input id="fecha" name="fecha" type="date" className="campo" required defaultValue={hoy} />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Determina el periodo contable del asiento.
            </p>
          </div>

          <Boton />

          <p className="text-xs leading-relaxed" style={{ color: "var(--texto-suave)" }}>
            Al confirmar, la mercadería ingresa al almacén con su costo real y se genera el asiento.
            La liquidación queda congelada; para corregirla habrá que extornarla.
          </p>
        </form>
      )}

      {liquidada && (
        <p className="bloque px-4 py-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          Esta importación ya está liquidada. Su costo entró al kardex y al asiento contable.
        </p>
      )}
    </aside>
  );
}

function Fila({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt style={{ color: destacado ? undefined : "var(--texto-suave)" }} className={destacado ? "font-medium" : ""}>
        {etiqueta}
      </dt>
      <dd className={destacado ? "text-base font-semibold" : ""}>
        <Importe valor={valor} moneda="PEN" />
      </dd>
    </div>
  );
}
