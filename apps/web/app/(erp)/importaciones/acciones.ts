"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";

import {
  crearImportacion, agregarItem, agregarGasto, type BaseProrrateo,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function crearImportacionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let id: string;
  try {
    id = await conEmpresa(
      (db, sesion) =>
        crearImportacion(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          proveedorId: texto(form, "proveedorId"),
          almacenId: texto(form, "almacenId"),
          moneda: texto(form, "moneda") || "USD",
          tipoCambio: texto(form, "tipoCambio"),
          incoterm: texto(form, "incoterm"),
          fechaOrden: texto(form, "fechaOrden"),
          facturaExterior: texto(form, "facturaExterior"),
          puertoOrigen: texto(form, "puertoOrigen"),
          puertoDestino: texto(form, "puertoDestino"),
          observaciones: texto(form, "observaciones"),
        }),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/importaciones");
  redirect(`/importaciones/${id}` as Route);
}

export async function agregarItemAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const importacionId = texto(form, "importacionId");
  try {
    await conEmpresa(
      (db, sesion) =>
        agregarItem(db, sesion.empresaId, importacionId, {
          productoId: texto(form, "productoId"),
          descripcion: texto(form, "descripcion"),
          cantidad: texto(form, "cantidad"),
          fobUnitario: texto(form, "fobUnitario"),
          peso: texto(form, "peso") || undefined,
          volumen: texto(form, "volumen") || undefined,
          partidaArancelaria: texto(form, "partidaArancelaria") || undefined,
        }),
      "importaciones:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/importaciones/${importacionId}`);
  return { exito: "Ítem agregado." };
}

export async function agregarGastoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const importacionId = texto(form, "importacionId");
  const base = texto(form, "baseProrrateo") as BaseProrrateo;
  try {
    await conEmpresa(
      (db, sesion) =>
        agregarGasto(db, sesion.empresaId, importacionId, {
          concepto: texto(form, "concepto"),
          importe: texto(form, "importe"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          baseProrrateo: base,
          // La bandera llega del formulario, pero el catálogo de conceptos ya
          // la trae marcada: es el error que más caro sale si se equivoca.
          afectaCosto: form.get("afectaCosto") === "on",
          ...(texto(form, "itemId") ? { itemId: texto(form, "itemId") } : {}),
          ...(texto(form, "documento") ? { documento: texto(form, "documento") } : {}),
          ...(texto(form, "fecha") ? { fecha: texto(form, "fecha") } : {}),
        }),
      "importaciones:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/importaciones/${importacionId}`);
  return { exito: "Gasto agregado." };
}

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "importaciones",
  choques: [
    [/importaciones_uk|duplicate key/, "Ya existe una importación con ese número."],
  ],
});
