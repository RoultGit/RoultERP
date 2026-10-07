"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { emitirVenta, emitirNota, enviarASunat, type LineaVenta } from "@roulterp/servicios";

import { conEmpresa, exigirEmpresaCon, tienePermiso } from "@/lib/sesion";
import { conexionApp, kekMaestra } from "@/lib/entorno";
import { type EstadoForm, texto, filas, marcado } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

/** Reconstruye las líneas del formulario. Ver la nota en compras/acciones.ts. */
function leerLineas(form: FormData): LineaVenta[] {
  const lineas: LineaVenta[] = [];
  for (const campo of filas(form, "cantidad")) {
    const cantidad = campo("cantidad");
    const productoId = campo("productoId");
    const descripcion = campo("descripcion");
    if (cantidad === "" || (productoId === "" && descripcion === "")) continue;

    lineas.push({
      cantidad,
      valorUnitario: campo("valorUnitario") || "0",
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(campo("afectacionIgv")
        ? { afectacionIgv: campo("afectacionIgv") }
        : {}),
      ...(campo("descuento")
        ? { descuento: campo("descuento") }
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
  const pedidoId = texto(form, "pedidoId");

  /*
   * Facturar por encima del límite de crédito exige permiso de aprobación.
   *
   * La casilla la enseña el formulario a cualquiera, porque quien vende tiene
   * que ver por qué le rechazan la factura. Pero marcarla no basta: autorizar
   * crédito es una decisión de quien responde por la cobranza, no de quien
   * teclea el pedido. Si la marca alguien sin `ventas:aprobar`, se ignora y el
   * límite vuelve a aplicarse.
   */
  const autorizadoSobreLimite =
    marcado(form, "autorizadoSobreLimite") && (await tienePermiso("ventas:aprobar"));

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
          ...(pedidoId ? { pedidoId } : {}),
          ...(autorizadoSobreLimite ? { autorizadoSobreLimite } : {}),
        }),
      "ventas:crear",
    );
    id = r.comprobanteId;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/ventas");
  revalidatePath("/inventario");
  if (pedidoId) revalidatePath("/ventas/pedidos");
  redirect(`/ventas/${id}` as Route);
}

/**
 * Emite una nota de crédito o de débito sobre un comprobante.
 *
 * Sin líneas propias la nota copia el comprobante entero, que es la anulación:
 * el formulario deja esa casilla marcada por defecto porque es lo que se pide
 * nueve de cada diez veces.
 */
export async function emitirNotaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  const total = texto(form, "alcance") === "total";
  if (!total && lineas.length === 0) {
    return { error: "Indique las líneas de la nota o márquela como total." };
  }

  let id: string;
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        emitirNota(db, sesion.empresaId, sesion.usuarioId, {
          comprobanteId: texto(form, "comprobanteId"),
          tipoDocumento: texto(form, "tipoDocumento"),
          serie: texto(form, "serie"),
          fechaEmision: texto(form, "fechaEmision"),
          motivo: texto(form, "motivo"),
          descripcionMotivo: texto(form, "descripcionMotivo"),
          ...(total ? {} : { lineas }),
          ...(form.get("devuelveMercaderia") ? { devuelveMercaderia: true } : {}),
        }),
      "ventas:crear",
    );
    id = r.comprobanteId;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/ventas");
  revalidatePath("/cxc");
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
  const sesion = await exigirEmpresaCon("cpe:crear");

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

const mensaje = (e: unknown) => traducirError(e, { contexto: "ventas", documento: "el comprobante" });
