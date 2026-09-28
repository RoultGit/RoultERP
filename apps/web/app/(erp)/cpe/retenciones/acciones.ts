"use server";

import { revalidatePath } from "next/cache";
import {
  emitirRetencionDePago, emitirRetencionDeLetra, emitirPercepcionDeCobranza, enviarRetencionASunat,
} from "@roulterp/servicios";

import { conEmpresa, exigirEmpresaCon } from "@/lib/sesion";
import { conexionApp, kekMaestra } from "@/lib/entorno";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "retenciones y percepciones", documento: "el comprobante" });

export async function emitirRetencionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, s) =>
        // Llega como "pago:<id>" o "letra:<id>": el comprobante es el mismo,
        // pero uno nace de un pago de facturas y el otro del pago de una letra.
        (() => {
          const [origen, id] = texto(form, "pagoId").split(":");
          const serie = texto(form, "serie");
          return origen === "letra"
            ? emitirRetencionDeLetra(db, s.empresaId, s.usuarioId, { letraPagoId: id!, serie })
            : emitirRetencionDePago(db, s.empresaId, s.usuarioId, { pagoId: id!, serie });
        })(),
      "cpe:crear",
    );
    revalidatePath("/cpe/retenciones");
    return { exito: `Emitido ${r.serie}-${r.numero} por ${r.importeTotal}.` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function emitirPercepcionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, s) =>
        emitirPercepcionDeCobranza(db, s.empresaId, s.usuarioId, {
          cobranzaId: texto(form, "cobranzaId"),
          serie: texto(form, "serie"),
        }),
      "cpe:crear",
    );
    revalidatePath("/cpe/retenciones");
    return { exito: `Emitido ${r.serie}-${r.numero} por ${r.importeTotal}.` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function enviarRetencionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirEmpresaCon("cpe:crear");
  try {
    const r = await enviarRetencionASunat(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      texto(form, "retencionId"),
      kekMaestra,
    );
    revalidatePath("/cpe/retenciones");
    return r.estado === "rechazado"
      ? { error: `Rechazado (${r.codigo}): ${r.mensaje}` }
      : { exito: `${r.estado.replace(/_/g, " ")}: ${r.mensaje}` };
  } catch (e) {
    return mensaje(e);
  }
}
