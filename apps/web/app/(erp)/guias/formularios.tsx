"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { enviarGuiaAccion, recogerGuiaAccion, type EstadoForm } from "./acciones";

function Enviar({ texto, tono = "secundario" }: { texto: string; tono?: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${tono}`} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <div className="mt-1 text-xs">
      {estado.error && <p style={{ color: "var(--peligro)" }} role="alert">{estado.error}</p>}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
    </div>
  );
}

/**
 * Enviar la guía y recoger su ticket.
 *
 * Son dos actos porque el flujo de la GRE es asíncrono: SUNAT devuelve un
 * ticket al enviar y el resultado se consulta después, cuando lo haya
 * procesado.
 */
export function AccionesGuia({
  guiaId,
  estado,
  ticket,
}: {
  guiaId: string;
  estado: string;
  ticket: string | null;
}) {
  const [envio, accionEnvio] = useActionState<EstadoForm, FormData>(enviarGuiaAccion, {});
  const [recogida, accionRecogida] = useActionState<EstadoForm, FormData>(recogerGuiaAccion, {});

  return (
    <div className="flex flex-col items-end gap-1">
      {!ticket && estado !== "aceptada" && (
        <form action={accionEnvio}>
          <input type="hidden" name="guiaId" value={guiaId} />
          <Enviar texto="Enviar a SUNAT" tono="primario" />
        </form>
      )}
      {ticket && estado !== "aceptada" && (
        <form action={accionRecogida}>
          <input type="hidden" name="guiaId" value={guiaId} />
          <Enviar texto="Consultar resultado" />
        </form>
      )}
      <Resultado estado={envio} />
      <Resultado estado={recogida} />
    </div>
  );
}
