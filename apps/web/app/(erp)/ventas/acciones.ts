"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  emitirVenta, enviarASunat, VentaInvalida, ContabilizacionInvalida,
  InventarioInvalido, ConfiguracionInvalida, type LineaVenta,
} from "@roulterp/servicios";
import { CertificadoInvalido, ErrorSunat } from "@roulterp/core/cpe";
import { conEmpresa, exigirEmpresa, NoAutorizado } from "@/lib/sesion";
import { conexionApp, kekMaestra } from "@/lib/entorno";

export type EstadoForm = { error?: string; exito?: string };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Reconstruye las líneas del formulario. Ver la nota en compras/acciones.ts. */
function leerLineas(form: FormData): LineaVenta[] {
  const lineas: LineaVenta[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`lineas[${i}].cantidad`);
    if (marca === null) break;
    const cantidad = String(marca).trim();
    const productoId = texto(form, `lineas[${i}].productoId`);
    const descripcion = texto(form, `lineas[${i}].descripcion`);
    if (cantidad === "" || (productoId === "" && descripcion === "")) continue;

    lineas.push({
      cantidad,
      valorUnitario: texto(form, `lineas[${i}].valorUnitario`) || "0",
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(texto(form, `lineas[${i}].afectacionIgv`)
        ? { afectacionIgv: texto(form, `lineas[${i}].afectacionIgv`) }
        : {}),
      ...(texto(form, `lineas[${i}].descuento`)
        ? { descuento: texto(form, `lineas[${i}].descuento`) }
        : {}),
    });
  }
  return lineas;
}

export async function emitirVentaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos una línea." };

  const almacenId = texto(form, "almacenId");
  const detraccionCodigo = texto(form, "detraccionCodigo");
  let id: string;

  try {
    const r = await conEmpresa(
      (db, sesion) =>
        emitirVenta(db, sesion.empresaId, sesion.usuarioId, {
          clienteId: texto(form, "clienteId"),
          tipoDocumento: texto(form, "tipoDocumento"),
          serie: texto(form, "serie"),
          fechaEmision: texto(form, "fechaEmision"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          lineas,
          ...(texto(form, "fechaVencimiento")
            ? { fechaVencimiento: texto(form, "fechaVencimiento") }
            : {}),
          ...(almacenId ? { almacenId } : {}),
          ...(detraccionCodigo ? { detraccionCodigo } : {}),
        }),
      "ventas:crear",
    );
    id = r.comprobanteId;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/ventas");
  revalidatePath("/inventario");
  redirect(`/ventas/${id}` as Route);
}

/**
 * Envía el comprobante a SUNAT.
 *
 * Se llama con la conexión, no dentro de una transacción: el servicio abre las
 * suyas porque hablar con SUNAT puede tardar un minuto y no debe retener una
 * conexión del pool mientras tanto.
 */
export async function enviarASunatAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = texto(form, "comprobanteId");
  const sesion = await exigirEmpresa();

  try {
    const r = await enviarASunat(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      id,
      kekMaestra,
    );
    revalidatePath(`/ventas/${id}`);
    revalidatePath("/ventas");

    if (r.estado === "rechazado") {
      return { error: `SUNAT rechazó el comprobante (${r.codigo}): ${r.mensaje}` };
    }
    const observaciones = r.observaciones.length
      ? ` Observaciones: ${r.observaciones.join("; ")}`
      : "";
    return { exito: `${r.mensaje}${observaciones}` };
  } catch (e) {
    return mensaje(e);
  }
}

function mensaje(e: unknown): EstadoForm {
  if (e instanceof NoAutorizado) return { error: "No tiene permiso para esta operación." };
  if (
    e instanceof VentaInvalida ||
    e instanceof ContabilizacionInvalida ||
    e instanceof InventarioInvalido ||
    e instanceof ConfiguracionInvalida ||
    e instanceof CertificadoInvalido
  ) {
    return { error: e.message };
  }
  if (e instanceof ErrorSunat) {
    // Un fallo del servicio no es culpa del usuario y se resuelve reintentando.
    return {
      error: e.reintentable
        ? `SUNAT no respondió (${e.codigo}). El comprobante quedó emitido; reintente el envío en unos minutos.`
        : `SUNAT devolvió el error ${e.codigo}: ${e.message}`,
    };
  }
  console.error("error en el módulo de ventas", e);
  return { error: "No se pudo completar la operación. Revise los datos e intente de nuevo." };
}
