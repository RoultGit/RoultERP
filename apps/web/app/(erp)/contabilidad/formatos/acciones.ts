"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  guardarFormato, eliminarFormato, sincronizarFormatos, type LineaFormato,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "formatos de estados financieros" });

function leerLineas(form: FormData): LineaFormato[] {
  const lineas: LineaFormato[] = [];
  for (const campo of filas(form, "concepto")) {
    const concepto = campo("concepto");
    if (!concepto) continue;
    const clase = campo("clase") || "detalle";
    const suma = campo("suma");
    lineas.push({
      concepto,
      clase,
      nivel: Number(campo("nivel") || "1"),
      ...(campo("codigo") ? { codigo: campo("codigo") } : {}),
      ...(campo("cuentas") ? { cuentas: campo("cuentas") } : {}),
      ...(campo("signo")
        ? { signo: campo("signo") as "deudor" | "acreedor" }
        : {}),
      ...(suma ? { suma: suma.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
      ...(campo("columna")
        ? { columna: campo("columna") as "activo" | "pasivo" }
        : {}),
    });
  }
  return lineas;
}

export async function guardarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos un renglón." };

  let id: string;
  try {
    id = await conEmpresa(
      (db, s) =>
        guardarFormato(db, s.empresaId, s.usuarioId, {
          codigo: texto(form, "codigo"),
          nombre: texto(form, "nombre"),
          tipo: texto(form, "tipo"),
          esPredeterminado: form.get("esPredeterminado") !== null,
          lineas,
        }),
      "contabilidad:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/formatos");
  revalidatePath("/contabilidad/estados");
  redirect(`/contabilidad/formatos?formato=${id}&hecho=guardado` as Route);
}

export async function eliminarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    await conEmpresa((db) => eliminarFormato(db, texto(form, "formatoId")), "contabilidad:anular");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/formatos");
  redirect("/contabilidad/formatos" as Route);
}

/** Devuelve los formatos de partida a una empresa que los borró o nunca los tuvo. */
export async function restaurarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) => sincronizarFormatos(db, s.empresaId, s.usuarioId),
      "contabilidad:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/formatos");
  redirect("/contabilidad/formatos?hecho=restaurados" as Route);
}
