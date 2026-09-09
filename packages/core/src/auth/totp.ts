/**
 * TOTP (RFC 6238) para el segundo factor.
 *
 * Son cincuenta líneas de HMAC bien especificado; no justifica una dependencia.
 * Se verifica contra los vectores del apéndice B del RFC en las pruebas, que es
 * la única forma seria de afirmar que una implementación de TOTP es correcta.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new TypeError(`carácter base32 inválido: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Secreto de 160 bits, el tamaño que recomienda RFC 4226 para HMAC-SHA1. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

export type TotpOptions = {
  digits?: number;
  period?: number;
  algorithm?: "sha1" | "sha256" | "sha512";
};

/** Código para un instante dado, en segundos Unix. */
export function totp(secret: string, atSeconds: number, opts: TotpOptions = {}): string {
  const { digits = 6, period = 30, algorithm = "sha1" } = opts;
  const counter = Math.floor(atSeconds / period);

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const mac = createHmac(algorithm, Buffer.from(base32Decode(secret))).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Verifica un código admitiendo `window` pasos de desfase a cada lado, para
 * tolerar relojes desalineados. window=1 (±30 s) es el equilibrio habitual
 * entre usabilidad y superficie de ataque.
 *
 * La comparación es de tiempo constante. Quien llame a esto sigue obligado a
 * rechazar la reutilización de un código ya consumido: TOTP por sí solo no
 * impide replay dentro del mismo periodo.
 */
export function verifyTotp(
  secret: string,
  code: string,
  atSeconds: number,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  const { window = 1, period = 30, digits = 6 } = opts;
  const trimmed = code.trim().replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(trimmed)) return false;

  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = totp(secret, atSeconds + w * period, opts);
    // Sin cortocircuito: se evalúan todas las ventanas siempre, para que el
    // tiempo de respuesta no revele cuál acertó.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(trimmed))) ok = true;
  }
  return ok;
}

/** URI `otpauth://` para el QR de la app autenticadora. */
export function otpauthUri(params: {
  secret: string;
  cuenta: string;
  emisor: string;
  digits?: number;
  period?: number;
}): string {
  const { secret, cuenta, emisor, digits = 6, period = 30 } = params;
  const label = encodeURIComponent(`${emisor}:${cuenta}`);
  const q = new URLSearchParams({
    secret,
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${q}`;
}

/**
 * Códigos de respaldo de un solo uso, para cuando el usuario pierde el
 * teléfono. Se muestran una vez y se guardan hasheados, igual que una
 * contraseña; aquí sólo se generan.
 */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, 16);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}
