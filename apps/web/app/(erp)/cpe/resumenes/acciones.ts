"use server";

import { revalidatePath } from "next/cache";
import {
  generarResumenDiario, generarComunicacionBaja, enviarResumenASunat, recogerTicket,
} from "@roulterp/servicios";

import { conEmpresa, exigirEmpresaCon } from "@/lib/sesion";
import { conexionApp, kekMaestra } from "@/lib/entorno";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "resúmenes y comunicaciones de baja", documento: "el resumen" });

export async function generarResumenAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, s) =>
        generarResumenDiario(db, s.empresaId, s.usuarioId, {
          fechaReferencia: texto(form, "fechaReferencia"),
          ...(texto(form, "fechaEmision") ? { fechaEmision: texto(form, "fechaEmision") } : {}),
        }),
      "cpe:crear",
    );
    revalidatePath("/cpe/resumenes");
    return { exito: `Generado ${r.identificador} con ${r.comprobantes} boletas.` };
  } catch (e) {
    return mensaje(e);
  }
}

/** Lee qué comprobantes se dan de baja y con qué motivo. */
function leerBajas(form: FormData): { comprobanteId: string; motivo: string }[] {
  const bajas: { comprobanteId: string; motivo: string }[] = [];
  for (const [clave, valor] of form.entries()) {
    const m = /^baja\[(.+)]$/.exec(clave);
    if (!m || String(valor) !== "1") continue;
    bajas.push({
      comprobanteId: m[1]!,
      motivo: String(form.get(`motivo[${m[1]}]`) ?? "").trim(),
    });
  }
  return bajas;
}

export async function generarBajaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const comprobantes = leerBajas(form);
  if (comprobantes.length === 0) {
    return { error: "Marque al menos un comprobante para dar de baja." };
  }
  try {
    const r = await conEmpresa(
      (db, s) => generarComunicacionBaja(db, s.empresaId, s.usuarioId, { comprobantes }),
      "cpe:anular",
    );
    revalidatePath("/cpe/resumenes");
    revalidatePath("/ventas");
    return { exito: `Generada ${r.identificador} con ${r.comprobantes} comprobantes.` };
  } catch (e) {
    return mensaje(e);
  }
}

/**
 * Envía el resumen a SUNAT.
 *
 * Como el envío de un comprobante, se llama con la conexión y no dentro de una
 * transacción: hablar con SUNAT puede tardar y no debe retener una conexión del
 * pool mientras tanto.
 */
export async function enviarResumenAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirEmpresaCon("cpe:crear");
  try {
    const r = await enviarResumenASunat(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      texto(form, "resumenId"),
      kekMaestra,
    );
    revalidatePath("/cpe/resumenes");
    return r.ticket
      ? { exito: `Enviado. SUNAT devolvió el ticket ${r.ticket}; consulte el resultado en un momento.` }
      : { error: `SUNAT rechazó el envío: ${r.mensaje ?? "sin detalle"}` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function recogerTicketAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirEmpresaCon("cpe:crear");
  try {
    const r = await recogerTicket(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      texto(form, "resumenId"),
      kekMaestra,
    );
    revalidatePath("/cpe/resumenes");
    revalidatePath("/ventas");
    if (r.enProceso) {
      return { exito: "SUNAT todavía lo está procesando. Vuelva a consultar en unos minutos." };
    }
    return r.estado === "rechazado"
      ? { error: `Rechazado (${r.codigo}): ${r.mensaje ?? "sin detalle"}` }
      : { exito: `${r.estado.replace(/_/g, " ")}: ${r.mensaje ?? ""}` };
  } catch (e) {
    return mensaje(e);
  }
}
