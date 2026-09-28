"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { resolverAccion, anularAccion, ejecutarAccion, type EstadoForm } from "../acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

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

function Error({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p className="mt-1 text-sm" style={{ color: "var(--peligro)" }} role="alert">
      {mensaje}
    </p>
  );
}

/** Autorizar o rechazar. Rechazar pide motivo porque sin él vuelve igual. */
export function Autorizacion({ ordenId }: { ordenId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(resolverAccion, {});
  const [rechazando, setRechazando] = useState(false);

  if (rechazando) {
    return (
      <form action={accion} className="space-y-2 p-4">
        <input type="hidden" name="ordenId" value={ordenId} />
        <input type="hidden" name="estado" value="rechazada" />
        <label className="etiqueta" htmlFor="motivo">Motivo del rechazo *</label>
        <input
          id="motivo" name="motivo" required maxLength={200} autoFocus
          className="campo" placeholder="Falta la conformidad del área usuaria" />
        <div className="flex gap-2">
          <Boton>Confirmar rechazo</Boton>
          <button
            type="button" className="boton boton-secundario"
            onClick={() => setRechazando(false)}
          >
            Cancelar
          </button>
        </div>
        <Error mensaje={estado.error} />
      </form>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <form action={accion}>
        <input type="hidden" name="ordenId" value={ordenId} />
        <input type="hidden" name="estado" value="autorizada" />
        <Boton primario>Autorizar</Boton>
      </form>
      <button
        type="button" className="boton boton-secundario w-full"
        onClick={() => setRechazando(true)}
      >
        Rechazar
      </button>
      <Error mensaje={estado.error} />
    </div>
  );
}

/** Ejecuta la orden: registra el pago de verdad. */
export function Ejecutar({
  ordenId,
  cuentas,
  cuentaSugerida,
  moneda,
}: {
  ordenId: string;
  cuentas: Opcion[];
  cuentaSugerida: string | null;
  moneda: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(ejecutarAccion, {});
  const hoy = hoyEnPeru();

  return (
    <form action={accion} className="space-y-3 p-4">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <label className="etiqueta" htmlFor="fecha">Fecha del pago *</label>
        <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
      </div>
      <div>
        <label className="etiqueta" htmlFor="cuentaEfectivoId">De la cuenta</label>
        <select
          id="cuentaEfectivoId" name="cuentaEfectivoId" className="campo"
          defaultValue={cuentaSugerida ?? ""}
        >
          <option value="">—</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>{c.etiqueta}</option>
          ))}
        </select>
      </div>
      {moneda !== "PEN" && (
        <div>
          <label className="etiqueta" htmlFor="tipoCambio">Tipo de cambio del día *</label>
          <input
            id="tipoCambio" name="tipoCambio" inputMode="decimal" required
            className="campo cifra" placeholder="3.80" />
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            El de hoy, no el de la factura: la diferencia es ganancia o pérdida por cambio.
          </p>
        </div>
      )}
      <div>
        <label className="etiqueta" htmlFor="referencia">Referencia</label>
        <input
          id="referencia" name="referencia" maxLength={60} className="campo"
          placeholder="N.º de operación o cheque" />
      </div>
      <Boton primario>Pagar</Boton>
      <Error mensaje={estado.error} />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Genera el asiento, descarga los documentos y saca el dinero de la cuenta. No se deshace:
        para corregir, se extorna el pago.
      </p>
    </form>
  );
}

export function Anular({ ordenId }: { ordenId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(anularAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="ordenId" value={ordenId} />
      <button type="submit" className="boton boton-secundario">Anular</button>
      {estado.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </span>
      )}
    </form>
  );
}
