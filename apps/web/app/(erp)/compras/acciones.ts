"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearOrden, aprobarOrden, registrarCompra,
  CompraInvalida, ContabilizacionInvalida, InventarioInvalido,
  type LineaCompra, type LineaOrden,
} from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

export type EstadoForm = { error?: string; exito?: string };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

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
  for (let i = 0; ; i++) {
    const descripcion = form.get(`lineas[${i}].descripcion`);
    if (descripcion === null) break;
    const d = String(descripcion).trim();
    // Una fila en blanco es una fila que el usuario dejó sin llenar, no un error.
    if (d === "") continue;

    const productoId = texto(form, `lineas[${i}].productoId`);
    const cuenta = texto(form, `lineas[${i}].cuenta`);
    lineas.push({
      descripcion: d,
      cantidad: texto(form, `lineas[${i}].cantidad`) || "0",
      valorUnitario: texto(form, `lineas[${i}].valorUnitario`) || "0",
      afectacionIgv: texto(form, `lineas[${i}].afectacionIgv`) || "10",
      ...(productoId ? { productoId } : {}),
      ...(cuenta ? { cuenta } : {}),
      ...(texto(form, `lineas[${i}].descuento`)
        ? { descuento: texto(form, `lineas[${i}].descuento`) }
        : {}),
      ...(texto(form, `lineas[${i}].centroCostoId`)
        ? { centroCostoId: texto(form, `lineas[${i}].centroCostoId`) }
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

function mensaje(e: unknown): EstadoForm {
  if (e instanceof NoAutorizado) return { error: "No tiene permiso para esta operación." };
  if (
    e instanceof CompraInvalida ||
    e instanceof ContabilizacionInvalida ||
    e instanceof InventarioInvalido
  ) {
    return { error: e.message };
  }
  if (e instanceof Error && /compras_uk|duplicate key/.test(e.message)) {
    return { error: "Ese documento ya está registrado para este proveedor." };
  }
  if (e instanceof Error && /ordenes_compra_uk/.test(e.message)) {
    return { error: "Ya existe una orden con ese número." };
  }
  console.error("error en el módulo de compras", e);
  return { error: "No se pudo completar la operación. Revise los datos e intente de nuevo." };
}
