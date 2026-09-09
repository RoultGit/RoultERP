"use server";

/**
 * Acciones del formulario de entrada.
 *
 * Devuelven un estado en vez de lanzar: un error de credenciales es parte del
 * uso normal del formulario, no una excepción del sistema, y el usuario tiene
 * que verlo escrito en la pantalla donde estaba.
 *
 * Ningún mensaje distingue «ese correo no existe» de «esa contraseña está mal».
 * Distinguirlos convierte el formulario en un enumerador de cuentas, y a nadie
 * le sirve saber que el correo era correcto salvo a quien está probando cuáles
 * lo son.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import {
  login, verificarMfa, cerrarSesion, seleccionarEmpresa,
  CredencialesInvalidas, DemasiadosIntentos, TokenInvalido,
} from "@roulterp/servicios";
import { SESSION_COOKIE } from "@roulterp/core/auth";
import { entornoAuth } from "@/lib/entorno";
import { ponerCookieSesion, borrarCookieSesion, sesionActual } from "@/lib/sesion";

export type EstadoEntrar =
  | { fase: "credenciales"; error?: string }
  | { fase: "mfa"; reto: string; error?: string };

async function datosPeticion() {
  const h = await headers();
  return {
    // En Vercel el cliente real viene en x-forwarded-for; el primer valor es el
    // del navegador y el resto son proxies intermedios.
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent") ?? undefined,
  };
}

/** Ruta de destino, validada para que no sirva de redirección abierta. */
function destinoSeguro(valor: FormDataEntryValue | null): string {
  const s = typeof valor === "string" ? valor : "";
  // Sólo rutas internas: una barra sola al inicio, nunca `//` ni un esquema.
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(s) ? s : "/";
}

export async function entrar(
  _previo: EstadoEntrar,
  form: FormData,
): Promise<EstadoEntrar> {
  const siguiente = destinoSeguro(form.get("siguiente"));
  try {
    const r = await login(entornoAuth, {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ...(await datosPeticion()),
    });

    if (r.estado === "mfa_requerido") return { fase: "mfa", reto: r.reto };
    await ponerCookieSesion(r.token);
  } catch (e) {
    return { fase: "credenciales", error: mensajeDe(e) };
  }
  // El redirect va fuera del try: Next lo implementa lanzando, y atraparlo
  // dentro convertiría una navegación correcta en un error de credenciales.
  redirect(siguiente);
}

export async function comprobarCodigo(
  _previo: EstadoEntrar,
  form: FormData,
): Promise<EstadoEntrar> {
  const reto = String(form.get("reto") ?? "");
  const siguiente = destinoSeguro(form.get("siguiente"));
  try {
    const r = await verificarMfa(entornoAuth, {
      reto,
      codigo: String(form.get("codigo") ?? ""),
      ...(await datosPeticion()),
    });
    if (r.estado !== "ok") return { fase: "mfa", reto, error: "No se pudo verificar el código." };
    await ponerCookieSesion(r.token);
  } catch (e) {
    if (e instanceof TokenInvalido) {
      return { fase: "credenciales", error: "La verificación venció. Vuelva a entrar." };
    }
    return { fase: "mfa", reto, error: mensajeDe(e) };
  }
  redirect(siguiente);
}

export async function salir(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await cerrarSesion(entornoAuth, token);
  await borrarCookieSesion();
  redirect("/entrar");
}

export async function elegirEmpresa(form: FormData): Promise<void> {
  const s = await sesionActual();
  if (!s) redirect("/entrar");
  const empresaId = String(form.get("empresaId") ?? "");
  const ok = await seleccionarEmpresa(entornoAuth, s.sesionId, empresaId);
  redirect(ok ? "/tablero" : "/empresas");
}

function mensajeDe(e: unknown): string {
  if (e instanceof CredencialesInvalidas) return "Correo o contraseña incorrectos.";
  if (e instanceof DemasiadosIntentos) {
    const segundos = Math.ceil(e.esperaMs / 1000);
    return `Demasiados intentos. Espere ${segundos} segundo${segundos === 1 ? "" : "s"}.`;
  }
  if (e instanceof ZodError) {
    return e.issues[0]?.message ?? "Revise los datos ingresados.";
  }
  if (e instanceof TokenInvalido) return e.message;
  // Nada de detalles internos hacia el navegador: van al registro del servidor.
  console.error("error inesperado al autenticar", e);
  return "No se pudo completar la operación. Intente de nuevo.";
}
