"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  entregarARendir, rendirEntrega, anularEntrega, type LineaRendicion,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "rendiciones de caja chica" });

export async function entregarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        entregarARendir(db, s.empresaId, s.usuarioId, {
          fecha: texto(form, "fecha"),
          cuentaId: texto(form, "cuentaId"),
          responsable: texto(form, "responsable"),
          motivo: texto(form, "motivo"),
          importe: texto(form, "importe") || "0",
          ...(texto(form, "responsableId") ? { responsableId: texto(form, "responsableId") } : {}),
          ...(texto(form, "centroCostoId") ? { centroCostoId: texto(form, "centroCostoId") } : {}),
        }),
      "caja_bancos:crear",
    );
    id = r.entregaId;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/caja-bancos/rendiciones");
  redirect(`/caja-bancos/rendiciones/${id}` as Route);
}

/** Documentos con los que el responsable justifica lo que gastó. */
function leerLineas(form: FormData): LineaRendicion[] {
  const lineas: LineaRendicion[] = [];
  for (const campo of filas(form, "importe")) {
    const importe = campo("importe");
    const concepto = campo("concepto");
    const cuenta = campo("cuenta");
    if (importe === "" || !concepto || !cuenta) continue;
    lineas.push({
      fecha: campo("fecha") || texto(form, "fecha"),
      concepto,
      cuenta,
      importe,
      ...(campo("tipoDocumento")
        ? { tipoDocumento: campo("tipoDocumento") }
        : {}),
      ...(campo("serie") ? { serie: campo("serie") } : {}),
      ...(campo("numero") ? { numero: campo("numero") } : {}),
      ...(campo("centroCostoId")
        ? { centroCostoId: campo("centroCostoId") }
        : {}),
      ...(campo("igv") ? { igv: campo("igv") } : {}),
    });
  }
  return lineas;
}

export async function rendirAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const entregaId = texto(form, "entregaId");
  const lineas = leerLineas(form);
  const devuelve = texto(form, "devuelve");
  if (lineas.length === 0 && !devuelve) {
    return { error: "Agregue al menos un documento o indique cuánto se devuelve." };
  }

  try {
    await conEmpresa(
      (db, s) =>
        rendirEntrega(db, s.empresaId, s.usuarioId, entregaId, {
          fecha: texto(form, "fecha"),
          lineas,
          ...(devuelve ? { devuelve } : {}),
        }),
      "caja_bancos:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/caja-bancos/rendiciones/${entregaId}`);
  revalidatePath("/caja-bancos/rendiciones");
  redirect(`/caja-bancos/rendiciones/${entregaId}?hecho=rendida` as Route);
}

export async function anularAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const entregaId = texto(form, "entregaId");
  try {
    await conEmpresa((db) => anularEntrega(db, entregaId), "caja_bancos:anular");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/caja-bancos/rendiciones");
  redirect("/caja-bancos/rendiciones" as Route);
}
