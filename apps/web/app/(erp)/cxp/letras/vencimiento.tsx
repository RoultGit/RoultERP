"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { pagarLetraAccion, protestarLetraAccion, type EstadoForm } from "../acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";

function Boton({ texto, tono }: { texto: string; tono: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${tono} !py-1 !text-xs`} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <p
      className="mt-1 text-xs"
      style={{ color: estado.error ? "var(--peligro)" : "var(--exito)" }}
      role={estado.error ? "alert" : undefined}
    >
      {estado.error ?? estado.exito}
    </p>
  );
}

/**
 * Pago y protesto de una letra, en la propia fila.
 *
 * El formulario se despliega al pulsar porque son dos o tres campos y sacar al
 * tesorero de la lista de vencimientos le haría perder de vista lo que estaba
 * revisando. El importe se deja vacío para cancelar entera, que es lo que se
 * hace casi siempre.
 */
export function VencimientoLetra({
  letraId,
  numero,
  saldo,
  protestada,
  cuentas,
  agente,
}: {
  letraId: string;
  numero: string;
  saldo: string;
  protestada: boolean;
  cuentas: { id: string; etiqueta: string }[];
  /** La empresa es agente de retención del IGV. */
  agente: boolean;
}) {
  const [abierto, setAbierto] = useState<"pago" | "protesto" | null>(null);
  const [pago, accionPago] = useActionState<EstadoForm, FormData>(pagarLetraAccion, {});
  const [protesto, accionProtesto] = useActionState<EstadoForm, FormData>(protestarLetraAccion, {});
  const hoy = hoyEnPeru();

  // Hecha la operación, el panel se cierra. Dejarlo abierto con los importes
  // recién enviados invita a pulsar otra vez sobre una letra que ya cambió, y
  // deja la fila contando algo que ya no es cierto.
  const hecho = pago.exito ?? protesto.exito;
  useEffect(() => {
    if (hecho) setAbierto(null);
  }, [hecho]);

  if (!abierto) {
    return (
      <div className="flex flex-wrap justify-end gap-1">
        <button
          type="button"
          className="boton boton-primario !py-1 !text-xs"
          onClick={() => setAbierto("pago")}
        >
          Pagar
        </button>
        {!protestada && (
          <button
            type="button"
            className="boton boton-secundario !py-1 !text-xs"
            onClick={() => setAbierto("protesto")}
          >
            Protestar
          </button>
        )}
        <Resultado estado={pago} />
        <Resultado estado={protesto} />
      </div>
    );
  }

  if (abierto === "pago") {
    return (
      <form action={accionPago} className="space-y-1">
        <input type="hidden" name="letraId" value={letraId} />
        <div className="flex flex-wrap items-end justify-end gap-1">
          <input name="fecha" type="date" required defaultValue={hoy} className="campo !py-1 !text-xs" />
          <input
            name="importe" inputMode="decimal" className="campo cifra !py-1 !text-xs"
            style={{ width: "6rem" }} placeholder={saldo}
            aria-label={`Importe a pagar de la letra ${numero}`}
          />
          <select
            name="cuentaEfectivoId" className="campo !py-1 !text-xs" defaultValue=""
            aria-label={`Cuenta de la que sale el pago de la letra ${numero}`}
          >
            <option value="">Sin cuenta</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.etiqueta}</option>
            ))}
          </select>
          {agente && (
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="retenerIgv" />
              Retener IGV
            </label>
          )}
          <Boton texto="Confirmar" tono="primario" />
          <button
            type="button" className="boton boton-secundario !py-1 !text-xs"
            onClick={() => setAbierto(null)}
          >
            ×
          </button>
        </div>
        <p className="text-right text-xs" style={{ color: "var(--texto-suave)" }}>
          En blanco cancela la letra entera. Sin cuenta, el pago se contabiliza pero no aparece en
          Caja y Bancos.
        </p>
        <Resultado estado={pago} />
      </form>
    );
  }

  return (
    <form action={accionProtesto} className="space-y-1">
      <input type="hidden" name="letraId" value={letraId} />
      <div className="flex flex-wrap items-end justify-end gap-1">
        <input name="fecha" type="date" required defaultValue={hoy} className="campo !py-1 !text-xs" />
        <input
          name="gastos" inputMode="decimal" className="campo cifra !py-1 !text-xs"
          style={{ width: "5.5rem" }} placeholder="Gastos"
          aria-label={`Gastos del protesto de la letra ${numero}`}
        />
        <input
          name="motivo" maxLength={120} className="campo !py-1 !text-xs"
          style={{ width: "10rem" }} placeholder="Motivo"
          aria-label={`Motivo del protesto de la letra ${numero}`}
        />
        <Boton texto="Protestar" tono="secundario" />
        <button
          type="button" className="boton boton-secundario !py-1 !text-xs"
          onClick={() => setAbierto(null)}
        >
          ×
        </button>
      </div>
      <p className="text-right text-xs" style={{ color: "var(--texto-suave)" }}>
        No cancela la deuda: la pasa a vencida.
      </p>
      <Resultado estado={protesto} />
    </form>
  );
}
