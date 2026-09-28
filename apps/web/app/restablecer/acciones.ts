"use server";

import { redirect } from "next/navigation";
import { resetearPassword, TokenInvalido } from "@roulterp/servicios";
import { entornoAuth } from "@/lib/entorno";
import { type EstadoForm } from "@/lib/formulario";

export type { EstadoForm };

/**
 * Fija una contraseña nueva con el enlace de restablecimiento.
 *
 * Es la contraparte de la invitación, con el otro tipo de token: uno de
 * invitación activa una cuenta que aún no servía, y uno de restablecimiento
 * cambia la clave de una que ya funciona. Mantenerlos separados es lo que
 * impide que un enlace de invitación viejo sirva para tomar una cuenta activa.
 *
 * `resetearPassword` cierra además las demás sesiones de esa persona: quien
 * restablece su clave suele hacerlo porque sospecha que alguien más la tiene, y
 * dejar las sesiones abiertas dejaría al intruso dentro.
 */
export async function restablecerAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("repetir") ?? "")) {
    return { error: "La contraseña y su repetición no coinciden." };
  }

  try {
    await resetearPassword(entornoAuth, token, password);
  } catch (e) {
    if (e instanceof TokenInvalido) {
      return { error: "El enlace no sirve o ya caducó. Pida otro a su administrador." };
    }
    if (e instanceof Error) return { error: e.message };
    throw e;
  }

  redirect("/entrar?restablecida=1");
}
