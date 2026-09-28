"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cambiarPassword, prepararMfa, activarMfa, desactivarMfa, cerrarTodasLasSesiones,
} from "@roulterp/servicios";
import { exigirSesion, borrarCookieSesion } from "@/lib/sesion";
import { entornoAuth } from "@/lib/entorno";
import { type EstadoForm as Base, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

/** El alta del segundo factor devuelve el QR y, al final, los respaldos. */
export type EstadoForm = Base & {
  mfa?: { secreto: string; uri: string };
  respaldos?: string[];
};

const mensaje = (e: unknown) => traducirError(e, { contexto: "la cuenta del usuario" });

/**
 * Cambia la contraseña.
 *
 * Cerrar las demás sesiones es parte de la operación, no un extra: quien cambia
 * su contraseña porque sospecha que se la robaron espera que el intruso quede
 * fuera, y esta sesión se cierra también para que el cambio se note.
 */
export async function cambiarPasswordAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirSesion();
  const nueva = texto(form, "nueva");
  if (nueva !== texto(form, "repetir")) {
    return { error: "La nueva contraseña y su repetición no coinciden." };
  }
  try {
    await cambiarPassword(entornoAuth, sesion.usuarioId, texto(form, "actual"), nueva);
  } catch (e) {
    return mensaje(e);
  }
  await borrarCookieSesion();
  redirect("/entrar?cambio=1");
}

export async function prepararMfaAccion(
  _previo: EstadoForm,
  _form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirSesion();
  try {
    const r = await prepararMfa(entornoAuth, sesion.usuarioId, sesion.email);
    return { mfa: r };
  } catch (e) {
    return mensaje(e);
  }
}

export async function activarMfaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirSesion();
  try {
    const respaldos = await activarMfa(entornoAuth, sesion.usuarioId, texto(form, "codigo").trim());
    revalidatePath("/cuenta");
    return { exito: "Segundo factor activado.", respaldos };
  } catch (e) {
    return mensaje(e);
  }
}

export async function desactivarMfaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirSesion();
  try {
    // Se exige la contraseña a propósito: quitar el segundo factor con una
    // sesión robada dejaría la cuenta abierta para siempre.
    await desactivarMfa(entornoAuth, sesion.usuarioId, texto(form, "password"));
    revalidatePath("/cuenta");
    return { exito: "Segundo factor desactivado." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function cerrarSesionesAccion(
  _previo: EstadoForm,
  _form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirSesion();
  await cerrarTodasLasSesiones(entornoAuth, sesion.usuarioId);
  await borrarCookieSesion();
  redirect("/entrar?cerradas=1");
}
