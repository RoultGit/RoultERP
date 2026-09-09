"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  registrarCobranza, canjearPorLetra,
  CobranzaInvalida, PagoInvalido, ContabilizacionInvalida,
  type AplicacionCobranza,
} from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

export type EstadoForm = { error?: string; exito?: string };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Lee cuánto se cobra de cada comprobante. Ver la nota en cxp/acciones.ts. */
function leerAplicaciones(form: FormData): AplicacionCobranza[] {
  const aplicaciones: AplicacionCobranza[] = [];
  for (const [clave, valor] of form.entries()) {
    const m = /^aplicar\[(.+)\]$/.exec(clave);
    if (!m) continue;
    const importe = String(valor).trim();
    if (importe === "" || Number(importe) === 0) continue;
    aplicaciones.push({ comprobanteId: m[1]!, importe });
  }
  return aplicaciones;
}

export async function registrarCobranzaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const aplicaciones = leerAplicaciones(form);
  if (aplicaciones.length === 0) {
    return { error: "Indique cuánto se cobra de cada comprobante." };
  }

  try {
    await conEmpresa(
      (db, sesion) =>
        registrarCobranza(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          clienteId: texto(form, "clienteId"),
          fecha: texto(form, "fecha"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          medioCobro: texto(form, "medioCobro") || "transferencia",
          cuentaDestino: texto(form, "cuentaDestino") || "1041",
          aplicaciones,
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
        }),
      "cxc:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxc");
  revalidatePath("/cxc/cobranzas");
  redirect("/cxc/cobranzas" as Route);
}

export async function canjearCobrarAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const documentos = leerAplicaciones(form).map((a) => ({
    documentoId: a.comprobanteId,
    importe: a.importe,
  }));
  if (documentos.length === 0) {
    return { error: "Indique qué comprobantes se canjean y por cuánto." };
  }

  try {
    await conEmpresa(
      (db, sesion) =>
        canjearPorLetra(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          cartera: "cobrar",
          terceroId: texto(form, "clienteId"),
          fechaGiro: texto(form, "fechaGiro"),
          fechaVencimiento: texto(form, "fechaVencimiento"),
          moneda: texto(form, "moneda") || "PEN",
          documentos,
        }),
      "cxc:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxc");
  redirect("/cxc" as Route);
}

function mensaje(e: unknown): EstadoForm {
  if (e instanceof NoAutorizado) return { error: "No tiene permiso para esta operación." };
  if (
    e instanceof CobranzaInvalida ||
    e instanceof PagoInvalido ||
    e instanceof ContabilizacionInvalida
  ) {
    return { error: e.message };
  }
  if (e instanceof Error && /cobranzas_uk|duplicate key/.test(e.message)) {
    return { error: "Ya existe una cobranza con ese número." };
  }
  if (e instanceof Error && /letras_uk/.test(e.message)) {
    return { error: "Ya existe una letra con ese número." };
  }
  console.error("error en cuentas por cobrar", e);
  return { error: "No se pudo completar la operación. Revise los datos e intente de nuevo." };
}
