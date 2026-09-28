"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { emitirReciboAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

/**
 * Contrapartidas propuestas.
 *
 * Quien emite un recibo en caja no tiene por qué saber contabilidad. La lista
 * completa de cuentas sigue disponible; esto es sólo lo que se usa a diario.
 */
const SUGERIDA = { ingreso: "759", egreso: "639" } as const;

function Emitir({ tipo }: { tipo: "ingreso" | "egreso" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Emitiendo…" : `Emitir recibo de ${tipo}`}
    </button>
  );
}

export function FormularioRecibo({
  cuentas,
  contrapartidas,
  terceros,
  centrosCosto,
}: {
  cuentas: Opcion[];
  contrapartidas: Opcion[];
  terceros: Opcion[];
  centrosCosto: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(emitirReciboAccion, {});
  const [tipo, setTipo] = useState<"ingreso" | "egreso">("egreso");
  const hoy = hoyEnPeru();

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="tipo" value={tipo} />

      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["ingreso", "egreso"] as const).map((t) => (
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
            {t === "ingreso" ? "Recibo de ingreso" : "Recibo de egreso"}
          </button>
        ))}
      </div>

      <section className="tarjeta p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          {tipo === "ingreso"
            ? "Dinero que entra a caja y no viene de una cobranza: devoluciones, venta de chatarra, aportes."
            : "Dinero que sale de caja y no es un pago a proveedor: movilidad, compras menores, reembolsos."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cuentaId">Caja o banco *</label>
            <select id="cuentaId" name="cuentaId" required className="campo" defaultValue="">
              <option value="" disabled>Elija la cuenta</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="importe">Importe *</label>
            <input
              id="importe" name="importe" required inputMode="decimal"
              className="campo cifra" placeholder="0.00" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cuentaContrapartida">Contra la cuenta *</label>
            <select
              id="cuentaContrapartida" name="cuentaContrapartida" required
              className="campo cifra" key={tipo} defaultValue={SUGERIDA[tipo]}
            >
              {contrapartidas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="terceroId">
              {tipo === "ingreso" ? "De quién se recibe" : "A nombre de quién"}
            </label>
            <select id="terceroId" name="terceroId" className="campo" defaultValue="">
              <option value="">— no está en el maestro —</option>
              {terceros.map((t) => (
                <option key={t.id} value={t.id}>{t.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="aNombreDe">
              O escriba el nombre
            </label>
            <input
              id="aNombreDe" name="aNombreDe" maxLength={120} className="campo"
              placeholder="Luis Quispe" />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="etiqueta" htmlFor="concepto">Concepto *</label>
            <input
              id="concepto" name="concepto" required maxLength={200} className="campo"
              placeholder="Movilidad del personal de almacén" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="centroCostoId">Centro de costo</label>
            <select id="centroCostoId" name="centroCostoId" className="campo" defaultValue="">
              <option value="">—</option>
              {centrosCosto.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="referencia">Referencia</label>
            <input id="referencia" name="referencia" maxLength={60} className="campo" />
          </div>
        </div>
      </section>

      <Emitir tipo={tipo} />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        El recibo mueve la caja y se contabiliza en el acto. El importe se guarda también en letras,
        que es lo que impide alterar un papel ya firmado.
      </p>
    </form>
  );
}
