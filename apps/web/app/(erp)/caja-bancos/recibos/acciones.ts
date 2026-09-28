"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { emitirRecibo } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "recibos de caja" });

export async function emitirReciboAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let numero: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        emitirRecibo(db, s.empresaId, s.usuarioId, {
          tipo: texto(form, "tipo") === "ingreso" ? "ingreso" : "egreso",
          fecha: texto(form, "fecha"),
          cuentaId: texto(form, "cuentaId"),
          concepto: texto(form, "concepto"),
          importe: texto(form, "importe") || "0",
          cuentaContrapartida: texto(form, "cuentaContrapartida"),
          ...(texto(form, "terceroId") ? { terceroId: texto(form, "terceroId") } : {}),
          ...(texto(form, "aNombreDe") ? { aNombreDe: texto(form, "aNombreDe") } : {}),
          ...(texto(form, "centroCostoId") ? { centroCostoId: texto(form, "centroCostoId") } : {}),
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
        }),
      "caja_bancos:crear",
    );
    numero = r.numero;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/caja-bancos");
  revalidatePath("/caja-bancos/recibos");
  redirect(`/caja-bancos/recibos?hecho=${encodeURIComponent(`Recibo ${numero} emitido.`)}` as Route);
}
