"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearOrden, aprobarOrden, registrarCompra, type LineaCompra, type LineaOrden,
} from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

/**
 * Reconstruye las líneas del formulario.
 *
 * Van como `lineas[0].cantidad`, `lineas[1].cantidad`… porque un formulario
 * HTML sin JavaScript no puede enviar un arreglo de objetos de otra forma, y
 * mantener el formulario funcionando sin JS es lo que hace que un error de red
 * no pierda media hora de captura.
 */
function leerLineas(form: FormData): LineaCompra[] {
  const lineas: LineaCompra[] = [];
  for (const campo of filas(form, "descripcion")) {
    const d = campo("descripcion");
    // Una fila en blanco es una fila que el usuario dejó sin llenar, no un error.
    if (d === "") continue;

    const productoId = campo("productoId");
    const cuenta = campo("cuenta");
    lineas.push({
      descripcion: d,
      cantidad: campo("cantidad") || "0",
      valorUnitario: campo("valorUnitario") || "0",
      afectacionIgv: campo("afectacionIgv") || "10",
      ...(productoId ? { productoId } : {}),
      ...(cuenta ? { cuenta } : {}),
      ...(campo("descuento")
        ? { descuento: campo("descuento") }
        : {}),
      ...(campo("centroCostoId")
        ? { centroCostoId: campo("centroCostoId") }
        : {}),
    });
  }
  return lineas;
}

export async function registrarCompraAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos una línea con descripción." };

  const almacenId = texto(form, "almacenId");
  const detraccionCodigo = texto(form, "detraccionCodigo");

  try {
    await conEmpresa(
      (db, sesion) =>
        registrarCompra(db, sesion.empresaId, sesion.usuarioId, {
          proveedorId: texto(form, "proveedorId"),
          tipoDocumento: texto(form, "tipoDocumento"),
          serie: texto(form, "serie"),
          numero: texto(form, "numero"),
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
      "compras:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras");
  revalidatePath("/cxp");
  revalidatePath("/inventario");
  redirect("/compras" as Route);
}

export async function crearOrdenAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form)
    .filter((l): l is LineaCompra & { productoId: string } => Boolean(l.productoId))
    .map<LineaOrden>((l) => ({
      productoId: l.productoId,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      ...(l.descuento ? { descuento: l.descuento } : {}),
      ...(l.afectacionIgv ? { afectacionIgv: l.afectacionIgv } : {}),
    }));

  if (lineas.length === 0) {
    return { error: "Una orden de compra necesita al menos una línea con producto." };
  }

  let id: string;
  try {
    id = await conEmpresa(
      (db, sesion) =>
        crearOrden(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          proveedorId: texto(form, "proveedorId"),
          fecha: texto(form, "fecha"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          lineas,
          ...(texto(form, "almacenId") ? { almacenId: texto(form, "almacenId") } : {}),
          ...(texto(form, "fechaEntrega") ? { fechaEntrega: texto(form, "fechaEntrega") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "compras:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/compras");
  redirect(`/compras/ordenes/${id}` as Route);
}

export async function aprobarOrdenAccion(form: FormData): Promise<void> {
  const id = texto(form, "id");
  await conEmpresa((db, sesion) => aprobarOrden(db, id, sesion.usuarioId), "compras:aprobar");
  revalidatePath(`/compras/ordenes/${id}`);
  revalidatePath("/compras");
}

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "compras",
  choques: [
    [/ordenes_compra_uk/, "Ya existe una orden con ese número."],
    [/compras_uk|duplicate key/, "Ese documento ya está registrado para este proveedor."],
  ],
});
