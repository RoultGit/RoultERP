"use server";

import { redirect } from "next/navigation";
import { aceptarInvitacion, TokenInvalido } from "@roulterp/servicios";
import { entornoAuth } from "@/lib/entorno";
import { type EstadoForm } from "@/lib/formulario";

export type { EstadoForm };

/**
 * Acepta la invitación y fija la contraseña.
 *
 * No inicia sesión al terminar: la persona pasa por el formulario de entrada
 * con la contraseña que acaba de elegir, que es la forma de comprobar que la
 * recuerda antes de que el enlace deje de servir.
 */
export async function aceptarInvitacionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("repetir") ?? "")) {
    return { error: "La contraseña y su repetición no coinciden." };
  }

  try {
    await aceptarInvitacion(entornoAuth, token, password);
  } catch (e) {
    if (e instanceof TokenInvalido) {
      return { error: "El enlace no sirve o ya caducó. Pida otro a su administrador." };
    }
    if (e instanceof Error) return { error: e.message };
    throw e;
  }

  redirect("/entrar?invitacion=1");
}
