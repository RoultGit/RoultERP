"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registrarCobranzaAccion, canjearCobrarAccion, type EstadoForm } from "../acciones";
import { formatearImporte, Insignia } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type ComprobanteAbierto = {
  id: string;
  etiqueta: string;
  fechaVencimiento: string | null;
  moneda: string;
  saldo: string;
  diasVencido: number;
};

const MEDIOS = [
  ["transferencia", "Transferencia bancaria"],
  ["deposito", "Depósito en cuenta"],
  ["cheque", "Cheque"],
  ["efectivo", "Efectivo"],
] as const;

function Boton({ texto, cargando }: { texto: string; cargando: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? cargando : texto}
    </button>
  );
}

export function FormularioCobranza({
  cliente,
  comprobantes,
  cuentas,
  cuentasEfectivo,
}: {
  cliente: { id: string; nombre: string; limite: string; saldo: string };
  comprobantes: ComprobanteAbierto[];
  cuentas: { cuenta: string; etiqueta: string }[];
  cuentasEfectivo: { id: string; codigo: string; nombre: string }[];
}) {
  const [modo, setModo] = useState<"cobro" | "letra">("cobro");
  const [estado, accion] = useActionState<EstadoForm, FormData>(
    modo === "cobro" ? registrarCobranzaAccion : canjearCobrarAccion,
    {},
  );
  const [importes, setImportes] = useState<Record<string, string>>({});
  const hoy = hoyEnPeru();

  const total = Object.values(importes).reduce((a, v) => a + (Number(v) || 0), 0);
  const excedido = Number(cliente.limite) > 0 && Number(cliente.saldo) > Number(cliente.limite);

  return (
    <form action={accion} className="space-y-5" key={modo}>
      <input type="hidden" name="clienteId" value={cliente.id} />

      {estado.error && (
        <p className="aviso" role="alert">{estado.error}</p>
      )}

      {excedido && (
        <p className="aviso">
          Este cliente está por encima de su límite de crédito. Cobrar libera disponible.
        </p>
      )}

      <div className="flex gap-2">
        {(["cobro", "letra"] as const).map((m) => (
          <button
            key={m} type="button" onClick={() => setModo(m)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: modo === m ? "var(--acento)" : "var(--borde)",
              background: modo === m ? "var(--acento-suave)" : "var(--superficie)",
              color: modo === m ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: modo === m ? 500 : 400,
            }}
          >
            {m === "cobro" ? "Registrar cobranza" : "Canjear por letra"}
          </button>
        ))}
      </div>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">
          {modo === "cobro" ? "Datos de la cobranza" : "Datos de la letra"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="numero">Número *</label>
            <input id="numero" name="numero" required maxLength={40} className="campo"
                   placeholder={modo === "cobro" ? "CB-2026-001" : "LC-2026-001"} autoFocus />
          </div>

          {modo === "cobro" ? (
            <>
              <div>
                <label className="etiqueta" htmlFor="fecha">Fecha *</label>
                <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="medioCobro">Medio de cobro *</label>
                <select id="medioCobro" name="medioCobro" className="campo" defaultValue="transferencia">
                  {MEDIOS.map(([v, t]) => (
                    <option key={v} value={v}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="cuentaDestino">Entra a *</label>
                {/*
                  Se ofrecen las cuentas reales de la empresa cuando las hay: al
                  elegirlas, el movimiento aparece además en Caja y Bancos y
                  entra en la conciliación. Sólo si la empresa todavía no ha
                  dado de alta ninguna se cae a la cuenta contable a secas.
                */}
                {cuentasEfectivo.length > 0 ? (
                  <select id="cuentaDestino" name="cuentaEfectivoId" className="campo">
                    {cuentasEfectivo.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select id="cuentaDestino" name="cuentaDestino" className="campo" defaultValue="1041">
                    {cuentas.map((c) => (
                      <option key={c.cuenta} value={c.cuenta}>{c.etiqueta}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="etiqueta" htmlFor="referencia">Referencia</label>
                <input id="referencia" name="referencia" maxLength={60} className="campo"
                       placeholder="N.º de operación" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="etiqueta" htmlFor="fechaGiro">Fecha de giro *</label>
                <input id="fechaGiro" name="fechaGiro" type="date" required defaultValue={hoy} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="fechaVencimiento">Vencimiento *</label>
                <input id="fechaVencimiento" name="fechaVencimiento" type="date" required className="campo" />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Comprobantes pendientes de {cliente.nombre}</h2>
          <button
            type="button" className="boton boton-secundario !py-1 !text-xs"
            onClick={() => setImportes(Object.fromEntries(comprobantes.map((c) => [c.id, c.saldo])))}
          >
            Aplicar el saldo completo
          </button>
        </div>

        <table className="tabla">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Vencimiento</th>
              <th>Mon.</th>
              <th className="text-right">Saldo</th>
              <th className="w-36 text-right">{modo === "cobro" ? "A cobrar" : "A canjear"}</th>
            </tr>
          </thead>
          <tbody>
            {comprobantes.map((c) => (
              <tr key={c.id}>
                <td className="cifra" style={{ textAlign: "left" }}>{c.etiqueta}</td>
                <td>
                  <span className="cifra">{c.fechaVencimiento ?? "—"}</span>
                  {c.diasVencido > 0 && (
                    <span className="ml-1.5"><Insignia tono="peligro">{c.diasVencido} d</Insignia></span>
                  )}
                </td>
                <td>{c.moneda}</td>
                <td className="cifra">{formatearImporte(c.saldo)}</td>
                <td>
                  <input
                    name={`aplicar[${c.id}]`} inputMode="decimal"
                    className="campo cifra !py-1 !text-xs"
                    value={importes[c.id] ?? ""}
                    onChange={(e) => setImportes((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder="0.00"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                {modo === "cobro" ? "Total a cobrar" : "Importe de la letra"}
              </td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(total))}</td>
            </tr>
          </tfoot>
        </table>

        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          El servidor valida contra el saldo real de cada comprobante y reconoce la diferencia de
          cambio. En una cuenta por cobrar, que el dólar suba es una ganancia.
        </p>
      </section>

      <div className="flex gap-2">
        <Boton
          texto={modo === "cobro" ? "Registrar cobranza" : "Canjear por letra"}
          cargando="Guardando…"
        />
        <Link href="/cxc" className="boton boton-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
