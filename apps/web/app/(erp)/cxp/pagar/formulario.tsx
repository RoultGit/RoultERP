"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registrarPagoAccion, canjearPorLetraAccion, type EstadoForm } from "../acciones";
import { formatearImporte, Insignia } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type DocumentoAbierto = {
  id: string;
  etiqueta: string;
  fechaVencimiento: string;
  moneda: string;
  saldo: string;
  diasVencido: number;
};

const MEDIOS = [
  ["transferencia", "Transferencia bancaria"],
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

/**
 * Registro de un pago o de un canje por letra.
 *
 * Las dos operaciones comparten la misma mecánica —elegir documentos y decir
 * cuánto de cada uno— y se diferencian en el desenlace: el pago saca dinero,
 * el canje cambia la deuda de forma. Por eso comparten formulario.
 */
export function FormularioPago({
  proveedor,
  documentos,
  cuentas,
  cuentasEfectivo,
  esAgenteRetencion,
}: {
  proveedor: { id: string; nombre: string };
  documentos: DocumentoAbierto[];
  cuentas: { cuenta: string; etiqueta: string }[];
  cuentasEfectivo: { id: string; codigo: string; nombre: string }[];
  esAgenteRetencion: boolean;
}) {
  const [modo, setModo] = useState<"pago" | "letra">("pago");
  const accionElegida = modo === "pago" ? registrarPagoAccion : canjearPorLetraAccion;
  const [estado, accion] = useActionState<EstadoForm, FormData>(accionElegida, {});

  const [importes, setImportes] = useState<Record<string, string>>({});
  const [retener, setRetener] = useState(false);
  const hoy = hoyEnPeru();

  const total = Object.values(importes).reduce((a, v) => a + (Number(v) || 0), 0);
  const retencion = retener && total > 700 ? total * 0.03 : 0;

  const llenarTodo = () =>
    setImportes(Object.fromEntries(documentos.map((d) => [d.id, d.saldo])));

  return (
    <form action={accion} className="space-y-5" key={modo}>
      <input type="hidden" name="proveedorId" value={proveedor.id} />

      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <div className="flex gap-2">
        {(["pago", "letra"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: modo === m ? "var(--acento)" : "var(--borde)",
              background: modo === m ? "var(--acento-suave)" : "var(--superficie)",
              color: modo === m ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: modo === m ? 500 : 400,
            }}
          >
            {m === "pago" ? "Registrar pago" : "Canjear por letra"}
          </button>
        ))}
      </div>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">
          {modo === "pago" ? "Datos del pago" : "Datos de la letra"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="numero">Número *</label>
            <input
              id="numero" name="numero" required maxLength={40} className="campo"
              placeholder={modo === "pago" ? "PG-2026-001" : "LT-2026-001"} autoFocus />
          </div>

          {modo === "pago" ? (
            <>
              <div>
                <label className="etiqueta" htmlFor="fecha">Fecha *</label>
                <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
              </div>
              <div>
                <label className="etiqueta" htmlFor="medioPago">Medio de pago *</label>
                <select id="medioPago" name="medioPago" className="campo" defaultValue="transferencia">
                  {MEDIOS.map(([v, t]) => (
                    <option key={v} value={v}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="cuentaOrigen">Sale de *</label>
                {/*
                  Se ofrecen las cuentas reales de la empresa cuando las hay: al
                  elegirlas, el movimiento aparece además en Caja y Bancos y
                  entra en la conciliación. Sólo si la empresa todavía no ha
                  dado de alta ninguna se cae a la cuenta contable a secas.
                */}
                {cuentasEfectivo.length > 0 ? (
                  <select id="cuentaOrigen" name="cuentaEfectivoId" className="campo">
                    {cuentasEfectivo.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select id="cuentaOrigen" name="cuentaOrigen" className="campo" defaultValue="1041">
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

        {modo === "pago" && esAgenteRetencion && (
          <label className="mt-4 flex items-start gap-2 rounded border p-2.5 text-sm"
                 style={{ borderColor: "var(--borde)" }}>
            <input
              type="checkbox" name="retenerIgv" className="mt-0.5"
              checked={retener} onChange={(e) => setRetener(e.target.checked)} />
            <span>
              <strong>Retener el IGV (3 %)</strong>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--texto-suave)" }}>
                La deuda se cancela por el bruto y al proveedor se le paga el neto: la retención es
                dinero suyo que la empresa entrega al fisco en su nombre. No aplica por debajo de
                S/ 700.
              </span>
            </span>
          </label>
        )}

        {modo === "letra" && (
          <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
            El canje no cancela la deuda: la cambia de forma. Los documentos dejan de estar
            pendientes y en su lugar queda una letra con su propio vencimiento.
          </p>
        )}
      </section>

      <section className="bloque overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">
            Documentos pendientes de {proveedor.nombre}
          </h2>
          <button type="button" className="boton boton-secundario boton-chico" onClick={llenarTodo}>
            Aplicar el saldo completo
          </button>
        </div>

        <table className="tabla">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Vencimiento</th>
              <th>Mon.</th>
              <th className="text-right">Saldo</th>
              <th className="w-36 text-right">
                {modo === "pago" ? "A pagar" : "A canjear"}
              </th>
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.id}>
                <td className="cifra" style={{ textAlign: "left" }}>{d.etiqueta}</td>
                <td>
                  <span className="cifra">{d.fechaVencimiento}</span>
                  {d.diasVencido > 0 && (
                    <span className="ml-1.5">
                      <Insignia tono="peligro">{d.diasVencido} d</Insignia>
                    </span>
                  )}
                </td>
                <td>{d.moneda}</td>
                <td className="cifra">{formatearImporte(d.saldo)}</td>
                <td>
                  <input
                    name={`aplicar[${d.id}]`}
                    inputMode="decimal"
                    className="campo campo-chico cifra"
                    value={importes[d.id] ?? ""}
                    onChange={(e) =>
                      setImportes((prev) => ({ ...prev, [d.id]: e.target.value }))
                    }
                    placeholder="0.00"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                {modo === "pago" ? "Total a aplicar" : "Importe de la letra"}
              </td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(total))}</td>
            </tr>
            {retencion > 0 && (
              <>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs uppercase">
                    Retención de IGV
                  </td>
                  <td className="cifra px-3 py-1.5 text-xs">
                    −{formatearImporte(String(retencion))}
                  </td>
                </tr>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Sale del banco
                  </td>
                  <td className="cifra px-3 py-2 font-semibold">
                    {formatearImporte(String(total - retencion))}
                  </td>
                </tr>
              </>
            )}
          </tfoot>
        </table>

        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          Estas cifras son una vista previa. El servidor recalcula con aritmética exacta, valida
          contra el saldo real de cada documento y reconoce la diferencia de cambio si la hay.
        </p>
      </section>

      <div className="flex gap-2">
        <Boton
          texto={modo === "pago" ? "Registrar pago" : "Canjear por letra"}
          cargando="Guardando…"
        />
        <Link href="/cxp" className="boton boton-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
