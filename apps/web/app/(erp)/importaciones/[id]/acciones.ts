"use server";

import { revalidatePath } from "next/cache";
import {
  confirmarLiquidacion, cambiarEstado, registrarDocumento, olvidarDocumento,
  type EstadoImportacion,
} from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { marcado, texto } from "@/lib/formulario";
import { fraseDeError } from "@/lib/errores";

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
 * Anota o corrige un documento del expediente.
 *
 * No pide permiso de aprobación: registrar que llegó el packing list es trabajo
 * de quien recibe los papeles, no de quien autoriza el embarque. Exigir
 * `aprobar` acabaría en que el jefe de logística teclea lo que le dictan por
 * teléfono, que es justo como se pierde el control documental.
 */
export async function guardarDocumento(
  _previo: EstadoAccion,
  form: FormData,
): Promise<EstadoAccion> {
  const importacionId = texto(form, "importacionId");
  const tipo = texto(form, "tipo");
  const noAplica = marcado(form, "noAplica");

  try {
    await conEmpresa(
      (db, sesion) =>
        registrarDocumento(db, sesion.empresaId, sesion.usuarioId, {
          importacionId,
          tipo,
          noAplica,
          // Marcar «no aplica» y dejar una fecha puesta es contradictorio y el
          // servicio lo rechaza; aquí se limpia, que es lo que la persona quiso.
          ...(noAplica ? {} : { recibidoEn: texto(form, "recibidoEn") }),
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
          ...(texto(form, "observaciones")
            ? { observaciones: texto(form, "observaciones") }
            : {}),
        }),
      "importaciones:editar",
    );
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/importaciones/${importacionId}`);
  revalidatePath("/importaciones/pendientes");
  return { exito: "Expediente actualizado." };
}

/** Borra la anotación. Distinto de marcarla «no aplica»: la deja invisible. */
export async function borrarDocumento(
  _previo: EstadoAccion,
  form: FormData,
): Promise<EstadoAccion> {
  const importacionId = texto(form, "importacionId");
  try {
    await conEmpresa(
      (db) => olvidarDocumento(db, importacionId, texto(form, "tipo")),
      "importaciones:editar",
    );
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/importaciones/${importacionId}`);
  return { exito: "Anotación retirada." };
}

/**
 * Traduce el error a algo que le sirva a quien está en la pantalla.
 *
 * Los errores de negocio llevan un mensaje escrito para el usuario y se muestran
 * tal cual. Cualquier otra cosa va al registro del servidor y hacia el navegador
 * sale una frase genérica: un rastro de pila en pantalla le dice a un atacante
 * más de lo que le dice al contador.
 */
const mensaje = (e: unknown) => fraseDeError(e, { contexto: "la importación" });
