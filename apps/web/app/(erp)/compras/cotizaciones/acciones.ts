"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearSolicitud, cerrarSolicitud, registrarCotizacionProveedor, descartarCotizacion, elegirCotizacion, type LineaCotizada, type LineaPedida,
} from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "cotizaciones de compra" });

/** Solicitud suelta, sin requisición detrás. */
export async function abrirSolicitudAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas: LineaPedida[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`lineas[${i}].cantidad`);
    if (marca === null) break;
    const cantidad = String(marca).trim();
    const productoId = texto(form, `lineas[${i}].productoId`);
    const descripcion = texto(form, `lineas[${i}].descripcion`);
    if (cantidad === "" || (!productoId && !descripcion)) continue;
    lineas.push({
      cantidad,
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(texto(form, `lineas[${i}].unidad`) ? { unidad: texto(form, `lineas[${i}].unidad`) } : {}),
    });
  }
  if (lineas.length === 0) return { error: "Agregue al menos un artículo." };

  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearSolicitud(db, s.empresaId, s.usuarioId, {
          fecha: texto(form, "fecha"),
          lineas,
          ...(texto(form, "fechaLimite") ? { fechaLimite: texto(form, "fechaLimite") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "compras:crear",
    );
    id = r.id;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras/cotizaciones");
  redirect(`/compras/cotizaciones/${id}` as Route);
}

export async function registrarRespuestaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const solicitudId = texto(form, "solicitudId");

  // Una línea sin precio es una línea que el proveedor no cotizó: se omite en
  // vez de registrarla en cero, que sería mentir en el cuadro comparativo.
  const lineas: LineaCotizada[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`lineas[${i}].solicitudItemId`);
    if (marca === null) break;
    const valorUnitario = texto(form, `lineas[${i}].valorUnitario`);
    if (valorUnitario === "") continue;
    lineas.push({
      solicitudItemId: String(marca),
      valorUnitario,
      ...(texto(form, `lineas[${i}].cantidad`)
        ? { cantidad: texto(form, `lineas[${i}].cantidad`) }
        : {}),
    });
  }
  if (lineas.length === 0) return { error: "Ponga al menos un precio." };

  try {
    await conEmpresa(
      (db, s) =>
        registrarCotizacionProveedor(db, s.empresaId, s.usuarioId, {
          solicitudId,
          proveedorId: texto(form, "proveedorId"),
          fecha: texto(form, "fecha"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          lineas,
          ...(texto(form, "referenciaProveedor")
            ? { referenciaProveedor: texto(form, "referenciaProveedor") }
            : {}),
          ...(texto(form, "validaHasta") ? { validaHasta: texto(form, "validaHasta") } : {}),
          ...(texto(form, "condicionPago") ? { condicionPago: texto(form, "condicionPago") } : {}),
          ...(texto(form, "plazoEntregaDias")
            ? { plazoEntregaDias: Number(texto(form, "plazoEntregaDias")) }
            : {}),
        }),
      "compras:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/compras/cotizaciones/${solicitudId}`);
  redirect(
    `/compras/cotizaciones/${solicitudId}?hecho=${encodeURIComponent("Cotización registrada.")}` as Route,
  );
}

export async function descartarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const solicitudId = texto(form, "solicitudId");
  try {
    await conEmpresa((db) => descartarCotizacion(db, texto(form, "cotizacionId")), "compras:crear");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/compras/cotizaciones/${solicitudId}`);
  redirect(
    `/compras/cotizaciones/${solicitudId}?hecho=${encodeURIComponent("Cotización descartada.")}` as Route,
  );
}

export async function cerrarSolicitudAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const solicitudId = texto(form, "solicitudId");
  try {
    await conEmpresa(
      (db) => cerrarSolicitud(db, solicitudId, form.get("desierta") !== null),
      "compras:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/compras/cotizaciones/${solicitudId}`);
  redirect(
    `/compras/cotizaciones/${solicitudId}?hecho=${encodeURIComponent("Solicitud cerrada.")}` as Route,
  );
}

/** Elige la oferta ganadora y emite la orden de compra. */
export async function elegirAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  let ordenId: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        elegirCotizacion(db, s.empresaId, s.usuarioId, texto(form, "cotizacionId"), {
          fecha: texto(form, "fecha") || hoyEnPeru(),
          ...(texto(form, "fechaEntrega") ? { fechaEntrega: texto(form, "fechaEntrega") } : {}),
          ...(texto(form, "almacenId") ? { almacenId: texto(form, "almacenId") } : {}),
        }),
      // Elegir proveedor es adjudicar: mismo permiso que aprobar la orden.
      "compras:aprobar",
    );
    ordenId = r.ordenId;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras");
  revalidatePath("/compras/cotizaciones");
  revalidatePath("/compras/requisiciones");
  redirect(`/compras/ordenes/${ordenId}` as Route);
}
