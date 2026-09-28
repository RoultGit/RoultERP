"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  asociarAccion, desasociarAccion, agregarGastoAccion, quitarGastoAccion,
  liquidarAccion, anularAccion, type EstadoForm,
} from "../acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"} !py-1 !text-xs`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}

function Error({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--peligro)" }} role="alert">
      {mensaje}
    </p>
  );
}


/** Mete un embarque suelto en la póliza. */
export function Asociar({
  polizaId,
  disponibles,
}: {
  polizaId: string;
  disponibles: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(asociarAccion, {});
  if (disponibles.length === 0) {
    return (
      <p className="px-4 py-3 text-sm" style={{ color: "var(--texto-suave)" }}>
        No hay embarques sueltos para agrupar. Los ya liquidados no se agrupan.
      </p>
    );
  }
  return (
    <form action={accion} className="flex flex-wrap items-end gap-2 px-4 py-3">
      <input type="hidden" name="polizaId" value={polizaId} />
      <div className="min-w-[260px] flex-1">
        <label className="etiqueta" htmlFor="importacionId">Agregar embarque</label>
        <select id="importacionId" name="importacionId" required className="campo" defaultValue="">
          <option value="" disabled>Elija un embarque</option>
          {disponibles.map((d) => (
            <option key={d.id} value={d.id}>{d.etiqueta}</option>
          ))}
        </select>
      </div>
      <Boton primario>Agrupar</Boton>
      <Error mensaje={estado.error} />
    </form>
  );
}

export function Desasociar({
  polizaId,
  importacionId,
}: {
  polizaId: string;
  importacionId: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(desasociarAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="polizaId" value={polizaId} />
      <input type="hidden" name="importacionId" value={importacionId} />
      <Boton>Sacar</Boton>
      <Error mensaje={estado.error} />
    </form>
  );
}

const BASES = [
  ["fob", "Valor FOB"],
  ["cantidad", "Cantidad"],
  ["peso", "Peso"],
  ["volumen", "Volumen"],
] as const;

/**
 * Gasto de la DUA.
 *
 * La casilla «es costo» decide si el gasto engorda el inventario o va al
 * crédito fiscal. El IGV y la percepción se recuperan, así que van desmarcados,
 * y equivocarla infla el costo de la mercadería en un 18 %.
 */
export function AgregarGasto({
  polizaId,
  proveedores,
}: {
  polizaId: string;
  proveedores: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(agregarGastoAccion, {});
  const [moneda, setMoneda] = useState("PEN");
  const [esCosto, setEsCosto] = useState(true);

  return (
    <form action={accion} className="space-y-3 px-4 py-3">
      <input type="hidden" name="polizaId" value={polizaId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="concepto">Concepto *</label>
          <input
            id="concepto" name="concepto" required maxLength={80}
            className="campo" placeholder="Agenciamiento de aduana" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="importe">Importe *</label>
          <input
            id="importe" name="importe" required inputMode="decimal"
            className="campo cifra" placeholder="0.00" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="etiqueta" htmlFor="moneda">Moneda</label>
            <select
              id="moneda" name="moneda" className="campo"
              value={moneda} onChange={(e) => setMoneda(e.target.value)}
            >
              <option value="PEN">PEN</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoCambio">T.C.</label>
            <input
              id="tipoCambio" name="tipoCambio" inputMode="decimal" className="campo cifra"
              defaultValue="1" key={moneda} placeholder={moneda === "PEN" ? "1" : "3.80"} />
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="baseProrrateo">Se reparte por</label>
          <select id="baseProrrateo" name="baseProrrateo" className="campo" defaultValue="fob">
            {BASES.map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="proveedorId">A quién se le debe</label>
          <select id="proveedorId" name="proveedorId" className="campo" defaultValue="">
            <option value="">Al proveedor del embarque</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.etiqueta}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="documento">Documento</label>
          <input id="documento" name="documento" maxLength={40} className="campo" placeholder="F001-1234" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" name="afectaCosto" checked={esCosto}
          onChange={(e) => setEsCosto(e.target.checked)}
        />
        Es costo de la mercadería
      </label>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        {esCosto
          ? "Se sumará al costo de las existencias y entrará al kardex."
          : "Irá al crédito fiscal (IGV, IPM) o a la cuenta de percepciones, no al inventario."}
      </p>

      <div className="flex gap-2">
        <Boton primario>Agregar gasto</Boton>
      </div>
      <Error mensaje={estado.error} />
    </form>
  );
}

export function QuitarGasto({ polizaId, gastoId }: { polizaId: string; gastoId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(quitarGastoAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="polizaId" value={polizaId} />
      <input type="hidden" name="gastoId" value={gastoId} />
      <button type="submit" className="text-xs" style={{ color: "var(--peligro)" }} aria-label="Quitar gasto">
        ✕
      </button>
      <Error mensaje={estado.error} />
    </form>
  );
}

export function Liquidar({
  polizaId,
  puedeLiquidar,
  motivo,
}: {
  polizaId: string;
  puedeLiquidar: boolean;
  motivo: string | null;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(liquidarAccion, {});
  const hoy = hoyEnPeru();

  if (!puedeLiquidar) {
    return (
      <p className="px-4 py-3 text-sm" style={{ color: "var(--texto-suave)" }}>
        {motivo ?? "Todavía no se puede liquidar."}
      </p>
    );
  }

  return (
    <form action={accion} className="space-y-3 px-4 py-3">
      <input type="hidden" name="polizaId" value={polizaId} />
      <div>
        <label className="etiqueta" htmlFor="fecha">Fecha de liquidación *</label>
        <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
      </div>
      <button type="submit" className="boton boton-primario w-full">
        Liquidar la póliza
      </button>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Cada embarque recibe su parte de los gastos de la DUA, ingresa al almacén a su costo real y
        genera su asiento y su cuenta por pagar. No se deshace: para corregir, se extorna.
      </p>
      <Error mensaje={estado.error} />
    </form>
  );
}

export function AnularPoliza({ polizaId }: { polizaId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(anularAccion, {});
  const [confirmando, setConfirmando] = useState(false);

  if (!confirmando) {
    return (
      <button
        type="button" className="boton boton-secundario"
        onClick={() => setConfirmando(true)}
      >
        Anular
      </button>
    );
  }
  return (
    <form action={accion} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="polizaId" value={polizaId} />
      <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Los embarques quedarán sueltos.
      </span>
      <Boton>Confirmar</Boton>
      <button
        type="button" className="boton boton-secundario !py-1 !text-xs"
        onClick={() => setConfirmando(false)}
      >
        No
      </button>
      <Error mensaje={estado.error} />
    </form>
  );
}
