"use server";

import { revalidatePath } from "next/cache";
import {
  confirmarLiquidacion, cambiarEstado, ImportacionInvalida,
  ContabilizacionInvalida, InventarioInvalido, type EstadoImportacion,
} from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

export type EstadoAccion = { error?: string; exito?: string };

/**
 * Confirma la liquidación.
 *
 * Todo ocurre en una sola transacción: la liquidación, los ingresos al almacén
 * y el asiento contable. O queda todo o no queda nada; una mercadería que entró
 * al kardex sin su asiento es un descuadre que aparece semanas después, cuando
 * ya nadie recuerda qué pasó.
 */
export async function confirmar(
  _previo: EstadoAccion,
  form: FormData,
): Promise<EstadoAccion> {
  const importacionId = String(form.get("importacionId") ?? "");
  const numero = String(form.get("numero") ?? "").trim();
  const fecha = String(form.get("fecha") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Indique una fecha de liquidación válida." };
  }
  if (numero === "") {
    return { error: "Indique el número de la liquidación." };
  }
  // El periodo contable sale de la fecha: liquidar con fecha de setiembre y
  // asentar en octubre descuadraría el registro de compras contra el balance.
  const periodo = fecha.slice(0, 4) + fecha.slice(5, 7);

  try {
    const r = await conEmpresa(
      (db, sesion) =>
        confirmarLiquidacion(db, sesion.empresaId, sesion.usuarioId, importacionId, {
          numero,
          fecha,
          periodo,
        }),
      "importaciones:aprobar",
    );
    revalidatePath(`/importaciones/${importacionId}`);
    revalidatePath("/inventario");
    return {
      exito: `Liquidación ${numero} confirmada. Ingresaron ${r.movimientos.length} productos por S/ ${r.costoTotal}.`,
    };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function avanzar(_previo: EstadoAccion, form: FormData): Promise<EstadoAccion> {
  const id = String(form.get("importacionId") ?? "");
  const nuevo = String(form.get("estado") ?? "") as EstadoImportacion;
  const duaNumero = String(form.get("duaNumero") ?? "").trim();
  const duaFecha = String(form.get("duaFecha") ?? "").trim();

  try {
    await conEmpresa(
      (db) =>
        cambiarEstado(db, id, nuevo, {
          ...(duaNumero ? { duaNumero } : {}),
          ...(duaFecha ? { duaFecha } : {}),
        }),
      "importaciones:aprobar",
    );
    revalidatePath(`/importaciones/${id}`);
    revalidatePath("/importaciones");
    return { exito: `Estado actualizado a «${nuevo.replace(/_/g, " ")}».` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

/**
 * Traduce el error a algo que le sirva a quien está en la pantalla.
 *
 * Los errores de negocio llevan un mensaje escrito para el usuario y se muestran
 * tal cual. Cualquier otra cosa va al registro del servidor y hacia el navegador
 * sale una frase genérica: un rastro de pila en pantalla le dice a un atacante
 * más de lo que le dice al contador.
 */
function mensaje(e: unknown): string {
  if (e instanceof NoAutorizado) return "No tiene permiso para esta operación.";
  if (
    e instanceof ImportacionInvalida ||
    e instanceof InventarioInvalido ||
    e instanceof ContabilizacionInvalida
  ) {
    return e.message;
  }
  console.error("error al operar sobre la importación", e);
  return "No se pudo completar la operación. Revise los datos e intente de nuevo.";
}
