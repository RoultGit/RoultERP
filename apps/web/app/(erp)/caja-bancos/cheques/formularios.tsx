"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { girarChequeAccion, cambiarEstadoAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

function Boton({ children, primario }: { children: React.ReactNode; primario?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`boton ${primario ? "boton-primario" : "boton-secundario"} boton-chico`}
      disabled={pending}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function FormularioCheque({
  cuentas,
  terceros,
}: {
  cuentas: Opcion[];
  terceros: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(girarChequeAccion, {});
  const [abierto, setAbierto] = useState(false);
  const [diferido, setDiferido] = useState(false);
  const hoy = hoyEnPeru();

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Girar cheque
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-4">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Cheque</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="cuentaId">Cuenta bancaria *</label>
            <select id="cuentaId" name="cuentaId" required className="campo" defaultValue="">
              <option value="" disabled>Elija la cuenta</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="numero">Número *</label>
            <input
              id="numero" name="numero" required maxLength={20}
              className="campo cifra" style={{ textAlign: "left" }} placeholder="00012345" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="importe">Importe *</label>
            <input
              id="importe" name="importe" required inputMode="decimal"
              className="campo cifra" placeholder="0.00" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaGiro">Fecha de giro *</label>
            <input
              id="fechaGiro" name="fechaGiro" type="date" required
              defaultValue={hoy} className="campo" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="beneficiarioId">Beneficiario</label>
            <select id="beneficiarioId" name="beneficiarioId" className="campo" defaultValue="">
              <option value="">— no está en el maestro —</option>
              {terceros.map((t) => (
                <option key={t.id} value={t.id}>{t.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="beneficiario">O escriba el nombre</label>
            <input id="beneficiario" name="beneficiario" maxLength={120} className="campo" />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={diferido}
            onChange={(e) => setDiferido(e.target.checked)}
          />
          Cheque diferido
        </label>
        {diferido && (
          <div className="mt-2 max-w-xs">
            <label className="etiqueta" htmlFor="fechaCobro">No se cobra antes de *</label>
            <input id="fechaCobro" name="fechaCobro" type="date" required className="campo" />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Hasta esa fecha el banco no lo paga, y el dinero sigue comprometido.
            </p>
          </div>
        )}

        <div className="mt-4">
          <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
          <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
        </div>
      </section>

      <div className="flex gap-2">
        <button type="submit" className="boton boton-primario">Girar cheque</button>
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Girar no descuenta el saldo del banco: el dinero sale cuando el banco lo carga. Es lo que
        permite que el libro cuadre contra el extracto.
      </p>
    </form>
  );
}

/** Acciones de una fila de la situación de cheques. */
export function AccionesCheque({
  chequeId,
  estado,
  hoy,
}: {
  chequeId: string;
  estado: string;
  hoy: string;
}) {
  const [resultado, accion] = useActionState<EstadoForm, FormData>(cambiarEstadoAccion, {});
  const [cobrando, setCobrando] = useState(false);

  if (estado === "cobrado" || estado === "anulado") {
    return <span className="text-xs" style={{ color: "var(--texto-suave)" }}>—</span>;
  }

  return (
    <div className="space-y-1">
      {cobrando ? (
        <form action={accion} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="chequeId" value={chequeId} />
          <input type="hidden" name="estado" value="cobrado" />
          <input
            name="fechaCobrado" type="date" required defaultValue={hoy}
            className="campo campo-chico" aria-label="Fecha en que el banco lo cargó"
          />
          <Boton primario>Confirmar</Boton>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setCobrando(false)}
          >
            No
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {estado === "girado" && (
            <form action={accion} className="inline">
              <input type="hidden" name="chequeId" value={chequeId} />
              <input type="hidden" name="estado" value="entregado" />
              <Boton>Entregado</Boton>
            </form>
          )}
          <button
            type="button" className="boton boton-primario boton-chico"
            onClick={() => setCobrando(true)}
          >
            Cobrado
          </button>
          <form action={accion} className="inline">
            <input type="hidden" name="chequeId" value={chequeId} />
            <input type="hidden" name="estado" value="anulado" />
            <Boton>Anular</Boton>
          </form>
        </div>
      )}
      {resultado.error && (
        <p className="text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {resultado.error}
        </p>
      )}
    </div>
  );
}
