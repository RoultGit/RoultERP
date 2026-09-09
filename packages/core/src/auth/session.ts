/**
 * Sesiones con token opaco.
 *
 * No se usa JWT: en un ERP hace falta poder cortar una sesión en el acto
 * (despido, robo de equipo, cambio de contraseña), y un JWT sigue siendo válido
 * hasta que expira. Un token opaco contra la base cuesta un SELECT indexado y
 * se revoca con un UPDATE.
 *
 * En la base se guarda el SHA-256 del token, no el token. Así un volcado de la
 * tabla de sesiones no le sirve a nadie para suplantar a un usuario.
 */
import { createHash, randomBytes } from "node:crypto";

/** 32 bytes = 256 bits de entropía. */
const TOKEN_BYTES = 32;

export const SESSION_COOKIE = "rt_sesion";

/** Duración por defecto. Se renueva mientras haya actividad. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
/** Tope absoluto: pase lo que pase, a los 7 días hay que volver a autenticarse. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Ventana de inactividad tras la cual la sesión muere aunque no haya expirado. */
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // 2 h

export type NuevoToken = { token: string; hash: string };

/** El `token` va a la cookie del navegador; el `hash`, a la base. */
export function nuevoTokenSesion(): NuevoToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const cookieOptions = (maxAgeMs: number) =>
  ({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  }) as const;

export type EstadoSesion = {
  creadaEn: Date;
  expiraEn: Date;
  ultimoUsoEn: Date;
  revocadaEn: Date | null;
};

/**
 * Única fuente de verdad sobre si una sesión sirve. Vive en el dominio, sin
 * base de datos, para poder probar los bordes de expiración sin levantar nada.
 */
export function sesionVigente(s: EstadoSesion, ahora: Date = new Date()): boolean {
  if (s.revocadaEn !== null) return false;
  const t = ahora.getTime();
  if (t >= s.expiraEn.getTime()) return false;
  if (t - s.ultimoUsoEn.getTime() >= SESSION_IDLE_MS) return false;
  if (t - s.creadaEn.getTime() >= SESSION_MAX_MS) return false;
  return true;
}

/**
 * Nueva expiración al renovar por actividad, sin pasarse del tope absoluto.
 */
export function renovarExpiracion(s: EstadoSesion, ahora: Date = new Date()): Date {
  const deseada = ahora.getTime() + SESSION_TTL_MS;
  const tope = s.creadaEn.getTime() + SESSION_MAX_MS;
  return new Date(Math.min(deseada, tope));
}

/**
 * Tokens de un solo uso para invitación de usuario y reseteo de contraseña.
 * Mismo tratamiento que las sesiones: se guarda el hash, se entrega el claro.
 */
export function nuevoTokenUnUso(): NuevoToken {
  return nuevoTokenSesion();
}

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 h
export const INVITACION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d
