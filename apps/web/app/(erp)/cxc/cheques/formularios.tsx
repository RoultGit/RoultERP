"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recibirAccion, cambiarEstadoAccion, type EstadoForm } from "./acciones";
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

export function FormularioRecibir({
  cuentas,
  clientes,
}: {
  cuentas: Opcion[];
  clientes: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(recibirAccion, {});
  const [abierto, setAbierto] = useState(false);
  const [diferido, setDiferido] = useState(false);
  const hoy = hoyEnPeru();

  if (!abierto) {
    return (
      <button type="button" className="boton boton-primario" onClick={() => setAbierto(true)}>
        Registrar cheque recibido
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
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
          Un cheque del cliente todavía no es dinero: es una promesa con nombre de banco. Se
          registra aquí y se marca cobrado cuando el banco lo acredita.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="clienteId">Cliente girador</label>
            <select id="clienteId" name="clienteId" className="campo" defaultValue="">
              <option value="">— no está en el maestro —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="girador">O escriba el nombre</label>
            <input id="girador" name="girador" maxLength={120} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="bancoGirador">Banco girador</label>
            <input
              id="bancoGirador" name="bancoGirador" maxLength={60}
              className="campo" placeholder="Interbank" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="numero">N.º de cheque *</label>
            <input
              id="numero" name="numero" required maxLength={20}
              className="campo cifra" style={{ textAlign: "left" }} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="importe">Importe *</label>
            <input
              id="importe" name="importe" required inputMode="decimal"
              className="campo cifra" placeholder="0.00" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaGiro">Fecha del cheque *</label>
            <input
              id="fechaGiro" name="fechaGiro" type="date" required
              defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cuentaId">Se deposita en *</label>
            <select id="cuentaId" name="cuentaId" required className="campo" defaultValue="">
              <option value="" disabled>Elija la cuenta</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
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
            <label className="etiqueta" htmlFor="fechaCobro">No se deposita antes de *</label>
            <input id="fechaCobro" name="fechaCobro" type="date" required className="campo" />
          </div>
        )}

        <div className="mt-4">
          <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
          <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
        </div>
      </section>

      <div className="flex gap-2">
        <button type="submit" className="boton boton-primario">Registrar</button>
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Depositar, cobrar o rebotar. Rebotar exige motivo: vuelve a ser deuda. */
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
  const [modo, setModo] = useState<null | "cobrado" | "rebotado">(null);

  if (estado === "cobrado" || estado === "rebotado" || estado === "anulado") {
    return <span className="text-xs" style={{ color: "var(--texto-suave)" }}>—</span>;
  }

  return (
    <div className="space-y-1">
      {modo === "cobrado" ? (
        <form action={accion} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="chequeId" value={chequeId} />
          <input type="hidden" name="estado" value="cobrado" />
          <input
            name="fechaCobrado" type="date" required defaultValue={hoy}
            className="campo campo-chico" aria-label="Fecha en que el banco lo acreditó"
          />
          <Boton primario>Confirmar</Boton>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setModo(null)}
          >
            No
          </button>
        </form>
      ) : modo === "rebotado" ? (
        <form action={accion} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="chequeId" value={chequeId} />
          <input type="hidden" name="estado" value="rebotado" />
          <input
            name="motivoRechazo" required maxLength={120} autoFocus
            className="campo campo-chico" placeholder="Sin fondos"
            aria-label="Motivo del rechazo"
          />
          <Boton>Confirmar</Boton>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setModo(null)}
          >
            No
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {estado === "recibido" && (
            <form action={accion} className="inline">
              <input type="hidden" name="chequeId" value={chequeId} />
              <input type="hidden" name="estado" value="depositado" />
              <Boton>Depositado</Boton>
            </form>
          )}
          <button
            type="button" className="boton boton-primario boton-chico"
            onClick={() => setModo("cobrado")}
          >
            Cobrado
          </button>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setModo("rebotado")}
          >
            Rebotó
          </button>
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
