"use client";

import { useFormStatus } from "react-dom";
import { aprobarOrdenAccion } from "../../acciones";

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Aprobando…" : "Aprobar orden"}
    </button>
  );
}

export function Aprobar({ id }: { id: string }) {
  return (
    <form action={aprobarOrdenAccion} className="inline">
      <input type="hidden" name="id" value={id} />
      <Boton />
    </form>
  );
}
