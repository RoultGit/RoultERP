"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  registrarPago, canjearPorLetra, renovarLetra, pagarLetra, protestarLetra, type AplicacionPago,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

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
          ...(texto(form, "cuentaEfectivoId")
            ? { cuentaEfectivoId: texto(form, "cuentaEfectivoId") }
            : {}),
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

/**
 * Paga la letra al vencimiento.
 *
 * Sin importe se cancela entera, que es lo normal; con importe se amortiza. El
 * servicio rechaza lo que exceda el saldo.
 */
export async function pagarLetraAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let hecho: string;
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        pagarLetra(db, sesion.empresaId, sesion.usuarioId, {
          letraId: texto(form, "letraId"),
          fecha: texto(form, "fecha"),
          ...(texto(form, "importe") ? { importe: texto(form, "importe") } : {}),
          ...(texto(form, "cuentaOrigen") ? { cuentaOrigen: texto(form, "cuentaOrigen") } : {}),
          ...(texto(form, "cuentaEfectivoId")
            ? { cuentaEfectivoId: texto(form, "cuentaEfectivoId") }
            : {}),
          ...(form.get("retenerIgv") !== null ? { retenerIgv: true } : {}),
        }),
      "cxp:crear",
    );
    revalidatePath("/cxp/letras");
    revalidatePath("/cxp/egresos");
    /*
     * Se redirige con el resultado en la dirección en vez de devolverlo.
     *
     * Pagada la letra, su fila deja de tener botones de acción y el componente
     * que mostraba el aviso desaparece con ellos: el usuario pulsaba y no
     * recibía confirmación de nada. Un aviso que vive en la página sobrevive a
     * que la fila cambie.
     */
    hecho =
      `Letra ${r.numero}: pagado ${r.importe}.` +
      (r.retencion === "0.00" ? "" : ` Se retuvo ${r.retencion} y salieron ${r.importeNeto}.`) +
      (r.saldo === "0.00" ? " Queda cancelada." : ` Queda un saldo de ${r.saldo}.`);
  } catch (e) {
    return mensaje(e);
  }
  redirect(`/cxp/letras?hecho=${encodeURIComponent(hecho)}` as Route);
}

/** Protesta la letra vencida. No cancela la deuda: la reclasifica. */
export async function protestarLetraAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let hecho: string;
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        protestarLetra(db, sesion.empresaId, sesion.usuarioId, {
          letraId: texto(form, "letraId"),
          fecha: texto(form, "fecha"),
          ...(texto(form, "gastos") ? { gastos: texto(form, "gastos") } : {}),
          ...(texto(form, "motivo") ? { motivo: texto(form, "motivo") } : {}),
        }),
      "cxp:anular",
    );
    revalidatePath("/cxp/letras");
    hecho = `Letra ${r.numero} protestada. La deuda sigue viva, ahora como vencida.`;
  } catch (e) {
    return mensaje(e);
  }
  redirect(`/cxp/letras?hecho=${encodeURIComponent(hecho)}` as Route);
}

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "cuentas por pagar",
  choques: [
    [/letras_uk/, "Ya existe una letra con ese número."],
    [/pagos_uk|duplicate key/, "Ya existe un pago con ese número."],
  ],
});
