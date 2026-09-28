"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearCotizacion, resolverCotizacion, cotizacionAPedido, type LineaComercial,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "cotizaciones de venta" });

/** Mismo esquema de nombres que el resto de las capturas con detalle. */
function leerLineas(form: FormData): LineaComercial[] {
  const lineas: LineaComercial[] = [];
  for (const campo of filas(form, "cantidad")) {
    const cantidad = campo("cantidad");
    const productoId = campo("productoId");
    const descripcion = campo("descripcion");
    if (cantidad === "" || (!productoId && !descripcion)) continue;
    lineas.push({
      cantidad,
      valorUnitario: campo("valorUnitario") || "0",
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(campo("afectacionIgv")
        ? { afectacionIgv: campo("afectacionIgv") }
        : {}),
    });
  }
  return lineas;
}

export async function crearCotizacionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos una línea." };

  let numero: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearCotizacion(db, s.empresaId, s.usuarioId, {
          clienteId: texto(form, "clienteId"),
          fecha: texto(form, "fecha"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          lineas,
          ...(texto(form, "validaHasta") ? { validaHasta: texto(form, "validaHasta") } : {}),
          ...(texto(form, "condicionPago") ? { condicionPago: texto(form, "condicionPago") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "ventas:crear",
    );
    numero = r.numero;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/ventas/cotizaciones");
  redirect(`/ventas/cotizaciones?hecho=${encodeURIComponent(`Cotización ${numero} registrada.`)}` as Route);
}

export async function resolverCotizacionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const estado = texto(form, "estado") as "aceptada" | "rechazada";
  try {
    await conEmpresa((db) => resolverCotizacion(db, texto(form, "cotizacionId"), estado), "ventas:crear");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/ventas/cotizaciones");
  redirect(`/ventas/cotizaciones?hecho=${encodeURIComponent(`Cotización ${estado}.`)}` as Route);
}

export async function convertirAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  let numero: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        cotizacionAPedido(db, s.empresaId, s.usuarioId, texto(form, "cotizacionId"), {
          fecha: texto(form, "fecha") || hoyEnPeru(),
          ...(texto(form, "fechaEntrega") ? { fechaEntrega: texto(form, "fechaEntrega") } : {}),
          ...(texto(form, "almacenId") ? { almacenId: texto(form, "almacenId") } : {}),
        }),
      "ventas:crear",
    );
    numero = r.numero;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/ventas/cotizaciones");
  revalidatePath("/ventas/pedidos");
  redirect(`/ventas/pedidos?hecho=${encodeURIComponent(`Pedido ${numero} generado desde la cotización.`)}` as Route);
}
