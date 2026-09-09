/**
 * Hashing de contraseñas con Argon2id.
 *
 * Parámetros por defecto: los de OWASP para Argon2id (m=19456 KiB, t=2, p=1).
 * Se guarda el hash en formato PHC, así que subir el costo más adelante no
 * invalida los hashes viejos: `needsRehash` detecta los que quedaron cortos y
 * se rehashean en el siguiente login exitoso.
 *
 * Implementación en JS puro a propósito. Un binario nativo es más rápido, pero
 * en un runtime serverless es una fuente de fallos de despliegue, y aquí lo que
 * se optimiza es no quedarse sin login.
 */
import { argon2idAsync } from "@noble/hashes/argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";

export type Argon2Params = { m: number; t: number; p: number };

/** OWASP Password Storage Cheat Sheet, perfil Argon2id de referencia. */
export const DEFAULT_PARAMS: Argon2Params = { m: 19456, t: 2, p: 1 };

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ARGON_VERSION = 0x13; // 19

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64").replace(/=+$/, "");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

/**
 * Rechaza lo que ningún hash arregla. El tope de 1024 bytes existe porque
 * Argon2 sobre una entrada gigante es una negación de servicio gratuita.
 */
export function assertPasswordUsable(password: string): void {
  if (typeof password !== "string") throw new TypeError("contraseña inválida");
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes < 12) throw new RangeError("la contraseña debe tener al menos 12 caracteres");
  if (bytes > 1024) throw new RangeError("la contraseña excede el máximo de 1024 bytes");
}

export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_PARAMS,
): Promise<string> {
  assertPasswordUsable(password);
  const salt = randomBytes(SALT_BYTES);
  const hash = await argon2idAsync(password, salt, { ...params, dkLen: HASH_BYTES });
  return `$argon2id$v=${ARGON_VERSION}$m=${params.m},t=${params.t},p=${params.p}$${b64(salt)}$${b64(hash)}`;
}

type Parsed = { params: Argon2Params; salt: Uint8Array; hash: Uint8Array };

function parsePhc(phc: string): Parsed | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return null;
  const [, mm, tt, pp, salt, hash] = m;
  return {
    params: { m: Number(mm), t: Number(tt), p: Number(pp) },
    salt: unb64(salt!),
    hash: unb64(hash!),
  };
}

/**
 * Verifica una contraseña contra su hash.
 *
 * Devuelve false ante un hash corrupto en vez de lanzar: un registro dañado en
 * la base no debe distinguirse, desde fuera, de una contraseña equivocada.
 */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) return false;
  if (Buffer.byteLength(password, "utf8") > 1024) return false;
  const candidate = await argon2idAsync(password, parsed.salt, {
    ...parsed.params,
    dkLen: parsed.hash.length,
  });
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(parsed.hash));
}

/** ¿El hash quedó por debajo del costo actual? Entonces toca rehashear. */
export function needsRehash(phc: string, params: Argon2Params = DEFAULT_PARAMS): boolean {
  const parsed = parsePhc(phc);
  if (!parsed) return true;
  const c = parsed.params;
  return c.m < params.m || c.t < params.t || c.p !== params.p;
}

/**
 * Hash señuelo con los parámetros por defecto.
 *
 * El login lo verifica cuando el usuario no existe, para que un atacante no
 * distinga «usuario inexistente» de «contraseña incorrecta» midiendo el tiempo
 * de respuesta. Se calcula una vez al arrancar.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("contraseña-señuelo-que-nadie-usa");
  return dummy;
}
