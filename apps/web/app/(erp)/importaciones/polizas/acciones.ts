"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearPoliza, asociarImportacion, desasociarImportacion, agregarGastoPoliza, quitarGastoPoliza, liquidarPoliza, anularPoliza, type BaseProrrateo,
} from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

/**
 * Vuelve a la póliza con constancia de lo que se acaba de hacer.
 *
 * Lleva un sello de tiempo además del mensaje, y no por capricho: redirigir a
 * la dirección exacta en la que ya se está no produce navegación alguna, la
 * acción nunca se resuelve, el botón se queda en «…» y el resto de formularios
 * de la página dejan de responder. Se veía al agrupar el segundo embarque —el
 * primero y el segundo redirigían a la misma URL— y después no se podía cargar
 * ningún gasto sin recargar a mano.
 */
function volver(polizaId: string, hecho: string): never {
  revalidatePath(`/importaciones/polizas/${polizaId}`);
  redirect(
    `/importaciones/polizas/${polizaId}?hecho=${encodeURIComponent(hecho)}&t=${Date.now()}` as Route,
  );
}

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "pólizas de importación",
  choques: [
    [/polizas_uk/, "Ya existe una póliza con ese número de DUA."],
  ],
});

export async function crearPolizaAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  let id: string;
  try {
    id = await conEmpresa(
      (db, s) =>
        crearPoliza(db, s.empresaId, s.usuarioId, {
          numero: texto(form, "numero"),
          fecha: texto(form, "fecha"),
          tipoCambio: texto(form, "tipoCambio") || "1",
          ...(texto(form, "fechaNumeracion")
            ? { fechaNumeracion: texto(form, "fechaNumeracion") }
            : {}),
          ...(texto(form, "aduana") ? { aduana: texto(form, "aduana") } : {}),
          ...(texto(form, "regimen") ? { regimen: texto(form, "regimen") } : {}),
          ...(texto(form, "agenteId") ? { agenteId: texto(form, "agenteId") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/importaciones/polizas");
  redirect(`/importaciones/polizas/${id}` as Route);
}

export async function asociarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  try {
    await conEmpresa(
      (db) => asociarImportacion(db, polizaId, texto(form, "importacionId")),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  volver(polizaId, "Embarque agrupado.");
}

export async function desasociarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  try {
    await conEmpresa(
      (db) => desasociarImportacion(db, polizaId, texto(form, "importacionId")),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  volver(polizaId, "Embarque separado de la póliza.");
}

export async function agregarGastoAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  try {
    await conEmpresa(
      (db, s) =>
        agregarGastoPoliza(db, s.empresaId, polizaId, {
          concepto: texto(form, "concepto"),
          importe: texto(form, "importe") || "0",
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          baseProrrateo: (texto(form, "baseProrrateo") || "fob") as BaseProrrateo,
          // La casilla marcada dice que el gasto es costo. El IGV y la
          // percepción se recuperan, así que van desmarcados.
          afectaCosto: form.get("afectaCosto") !== null,
          ...(texto(form, "proveedorId") ? { proveedorId: texto(form, "proveedorId") } : {}),
          ...(texto(form, "documento") ? { documento: texto(form, "documento") } : {}),
          ...(texto(form, "fecha") ? { fecha: texto(form, "fecha") } : {}),
        }),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  volver(polizaId, "Gasto cargado a la póliza.");
}

export async function quitarGastoAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  try {
    await conEmpresa(
      (db) => quitarGastoPoliza(db, polizaId, texto(form, "gastoId")),
      "importaciones:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  volver(polizaId, "Gasto quitado.");
}

/**
 * Liquida la póliza entera.
 *
 * Todo en una transacción: media póliza liquidada es peor que ninguna, porque
 * los embarques que quedaran fuera arrastrarían un costo sin su parte de la DUA
 * y nadie se enteraría hasta vender.
 */
export async function liquidarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  const fecha = texto(form, "fecha");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "Indique una fecha de liquidación válida." };
  }
  // El periodo sale de la fecha: liquidar con fecha de setiembre y asentar en
  // octubre descuadraría el registro de compras contra el balance.
  const periodo = fecha.slice(0, 4) + fecha.slice(5, 7);

  try {
    await conEmpresa(
      (db, s) => liquidarPoliza(db, s.empresaId, s.usuarioId, polizaId, { fecha, periodo }),
      "importaciones:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/importaciones/polizas/${polizaId}`);
  revalidatePath("/importaciones");
  revalidatePath("/inventario");
  revalidatePath("/cxp");
  revalidatePath("/contabilidad");
  redirect(`/importaciones/polizas/${polizaId}?hecho=liquidada` as Route);
}

export async function anularAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const polizaId = texto(form, "polizaId");
  try {
    await conEmpresa((db) => anularPoliza(db, polizaId), "importaciones:crear");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/importaciones/polizas");
  volver(polizaId, "Póliza anulada.");
}
