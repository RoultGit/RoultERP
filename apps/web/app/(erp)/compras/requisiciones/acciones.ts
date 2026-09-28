"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearRequisicion, resolverRequisicion, anularRequisicion, crearSolicitud, type LineaPedida,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "requisiciones" });

function leerLineas(form: FormData): LineaPedida[] {
  const lineas: LineaPedida[] = [];
  for (const campo of filas(form, "cantidad")) {
    const cantidad = campo("cantidad");
    const productoId = campo("productoId");
    const descripcion = campo("descripcion");
    if (cantidad === "" || (!productoId && !descripcion)) continue;
    lineas.push({
      cantidad,
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(campo("unidad") ? { unidad: campo("unidad") } : {}),
      ...(campo("observaciones")
        ? { observaciones: campo("observaciones") }
        : {}),
    });
  }
  return lineas;
}

export async function crearRequisicionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos un artículo." };

  let numero: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearRequisicion(db, s.empresaId, s.usuarioId, {
          fecha: texto(form, "fecha"),
          lineas,
          ...(texto(form, "tipo") ? { tipo: texto(form, "tipo") } : {}),
          ...(texto(form, "fechaRequerida") ? { fechaRequerida: texto(form, "fechaRequerida") } : {}),
          ...(texto(form, "area") ? { area: texto(form, "area") } : {}),
          ...(texto(form, "almacenId") ? { almacenId: texto(form, "almacenId") } : {}),
          ...(texto(form, "centroCostoId") ? { centroCostoId: texto(form, "centroCostoId") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "compras:crear",
    );
    numero = r.numero;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/compras/requisiciones");
  redirect(`/compras/requisiciones?hecho=${encodeURIComponent(`Requisición ${numero} registrada.`)}` as Route);
}

export async function resolverRequisicionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const estado = texto(form, "estado") as "aprobada" | "rechazada";
  try {
    await conEmpresa(
      (db, s) =>
        resolverRequisicion(db, texto(form, "requisicionId"), s.usuarioId, {
          estado,
          ...(texto(form, "motivo") ? { motivo: texto(form, "motivo") } : {}),
        }),
      // Aprobar una requisición es autorizar un gasto: es el mismo permiso que
      // aprueba una orden de compra, no el de capturarla.
      "compras:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras/requisiciones");
  redirect(`/compras/requisiciones?hecho=${encodeURIComponent(`Requisición ${estado}.`)}` as Route);
}

export async function anularRequisicionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa((db) => anularRequisicion(db, texto(form, "requisicionId")), "compras:crear");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras/requisiciones");
  redirect(`/compras/requisiciones?hecho=${encodeURIComponent("Requisición anulada.")}` as Route);
}

/** Abre la solicitud de cotización a partir de una requisición aprobada. */
export async function crearSolicitudAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearSolicitud(db, s.empresaId, s.usuarioId, {
          fecha: texto(form, "fecha") || hoyEnPeru(),
          requisicionId: texto(form, "requisicionId"),
          ...(texto(form, "fechaLimite") ? { fechaLimite: texto(form, "fechaLimite") } : {}),
        }),
      "compras:crear",
    );
    id = r.id;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras/requisiciones");
  revalidatePath("/compras/cotizaciones");
  redirect(`/compras/cotizaciones/${id}` as Route);
}
