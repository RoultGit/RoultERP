"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  registrarPago, canjearPorLetra, renovarLetra,
  PagoInvalido, ContabilizacionInvalida, type AplicacionPago,
} from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

export type EstadoForm = { error?: string; exito?: string };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * Lee las aplicaciones del formulario.
 *
 * Cada documento abierto aparece como una fila con su importe. Las que quedan
 * en blanco o en cero se ignoran: el usuario escribe sólo sobre lo que va a
 * pagar, no sobre todo lo que debe.
 */
function leerAplicaciones(form: FormData): AplicacionPago[] {
  const aplicaciones: AplicacionPago[] = [];
  for (const [clave, valor] of form.entries()) {
    const m = /^aplicar\[(.+)\]$/.exec(clave);
    if (!m) continue;
    const importe = String(valor).trim();
    if (importe === "" || Number(importe) === 0) continue;
    aplicaciones.push({ documentoId: m[1]!, importe });
  }
  return aplicaciones;
}

export async function registrarPagoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const aplicaciones = leerAplicaciones(form);
  if (aplicaciones.length === 0) {
    return { error: "Indique cuánto se paga de cada documento." };
  }

  try {
    await conEmpresa(
      (db, sesion) =>
        registrarPago(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          proveedorId: texto(form, "proveedorId"),
          fecha: texto(form, "fecha"),
          moneda: texto(form, "moneda") || "PEN",
          tipoCambio: texto(form, "tipoCambio") || "1",
          medioPago: texto(form, "medioPago") || "transferencia",
          cuentaOrigen: texto(form, "cuentaOrigen") || "1041",
          aplicaciones,
          retenerIgv: form.get("retenerIgv") === "on",
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
        }),
      "cxp:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxp");
  revalidatePath("/cxp/pagos");
  redirect("/cxp/pagos" as Route);
}

export async function canjearPorLetraAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const documentos = leerAplicaciones(form).map((a) => ({
    documentoId: a.documentoId,
    importe: a.importe,
  }));
  if (documentos.length === 0) {
    return { error: "Indique qué documentos se canjean y por cuánto." };
  }

  try {
    await conEmpresa(
      (db, sesion) =>
        canjearPorLetra(db, sesion.empresaId, sesion.usuarioId, {
          numero: texto(form, "numero"),
          cartera: "pagar",
          terceroId: texto(form, "proveedorId"),
          fechaGiro: texto(form, "fechaGiro"),
          fechaVencimiento: texto(form, "fechaVencimiento"),
          moneda: texto(form, "moneda") || "PEN",
          documentos,
        }),
      "cxp:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxp");
  revalidatePath("/cxp/letras");
  redirect("/cxp/letras" as Route);
}

export async function renovarLetraAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        renovarLetra(db, sesion.empresaId, sesion.usuarioId, texto(form, "letraId"), {
          numero: texto(form, "numero"),
          fecha: texto(form, "fecha"),
          fechaVencimiento: texto(form, "fechaVencimiento"),
          ...(texto(form, "intereses") ? { intereses: texto(form, "intereses") } : {}),
        }),
      "cxp:crear",
    );
    revalidatePath("/cxp/letras");
    return { exito: `Letra renovada por ${r.importe}.` };
  } catch (e) {
    return mensaje(e);
  }
}

function mensaje(e: unknown): EstadoForm {
  if (e instanceof NoAutorizado) return { error: "No tiene permiso para esta operación." };
  if (e instanceof PagoInvalido || e instanceof ContabilizacionInvalida) {
    return { error: e.message };
  }
  if (e instanceof Error && /pagos_uk|duplicate key/.test(e.message)) {
    return { error: "Ya existe un pago con ese número." };
  }
  if (e instanceof Error && /letras_uk/.test(e.message)) {
    return { error: "Ya existe una letra con ese número." };
  }
  console.error("error en cuentas por pagar", e);
  return { error: "No se pudo completar la operación. Revise los datos e intente de nuevo." };
}
