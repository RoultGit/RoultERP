"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  registrarCobranza, canjearPorLetra, type AplicacionCobranza,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

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
          ...(texto(form, "cuentaEfectivoId")
            ? { cuentaEfectivoId: texto(form, "cuentaEfectivoId") }
            : {}),
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

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "cuentas por cobrar",
  choques: [
    [/letras_uk/, "Ya existe una letra con ese número."],
    [/cobranzas_uk|duplicate key/, "Ya existe una cobranza con ese número."],
  ],
});
