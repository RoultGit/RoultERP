"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { crearPlanilla, cerrarPlanilla, anularPlanilla } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const aviso = (e: unknown) => traducirError(e, { contexto: "planillas de cobranza" });

export async function crearAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  // Los documentos llegan como "comprobante:<id>" o "letra:<id>": la misma
  // casilla sirve a las dos formas en que un cliente puede deber.
  const documentos: { comprobanteId?: string; letraId?: string; importe?: string }[] = [];
  for (const marca of form.getAll("documento").map(String)) {
    const [clase, id] = marca.split(":");
    if (!id) continue;
    const importe = texto(form, `importe-${marca}`);
    documentos.push({
      ...(clase === "letra" ? { letraId: id } : { comprobanteId: id }),
      ...(importe ? { importe } : {}),
    });
  }
  if (documentos.length === 0) return { error: "Marque al menos un documento." };

  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearPlanilla(db, s.empresaId, s.usuarioId, {
          fecha: texto(form, "fecha"),
          responsable: texto(form, "responsable"),
          documentos,
          ...(texto(form, "tipo") ? { tipo: texto(form, "tipo") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "cxc:crear",
    );
    id = r.id;
  } catch (e) {
    return aviso(e);
  }
  revalidatePath("/cxc/planillas");
  redirect(`/cxc/planillas/${id}` as Route);
}

export async function cerrarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const planillaId = texto(form, "planillaId");
  try {
    await conEmpresa((db, s) => cerrarPlanilla(db, planillaId, s.usuarioId), "cxc:editar");
  } catch (e) {
    return aviso(e);
  }
  revalidatePath(`/cxc/planillas/${planillaId}`);
  revalidatePath("/cxc/planillas");
  redirect(`/cxc/planillas/${planillaId}?hecho=cerrada` as Route);
}

export async function anularAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const planillaId = texto(form, "planillaId");
  const motivo = texto(form, "motivo");
  if (!motivo) return { error: "Anular una planilla exige un motivo." };
  try {
    await conEmpresa((db) => anularPlanilla(db, planillaId, motivo), "cxc:editar");
  } catch (e) {
    return aviso(e);
  }
  revalidatePath(`/cxc/planillas/${planillaId}`);
  revalidatePath("/cxc/planillas");
  redirect(`/cxc/planillas/${planillaId}?hecho=anulada` as Route);
}
