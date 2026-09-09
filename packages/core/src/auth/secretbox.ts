/**
 * Cifrado de secretos en reposo, con sobre (envelope encryption).
 *
 * Su cliente principal es el certificado digital `.pfx` de cada empresa, que es
 * lo más valioso del sistema: con él se firma cualquier comprobante a nombre de
 * ese RUC. Guardarlo en claro en la base sería regalar la capacidad de emitir
 * facturas a quien consiga un volcado.
 *
 * Cada secreto se cifra con una clave de datos propia y aleatoria (DEK); la DEK
 * viaja cifrada con la clave maestra (KEK). Rotar la maestra sólo obliga a
 * recifrar las DEK, no los datos, y una DEK comprometida no expone al resto.
 *
 * Hoy la KEK vive en una variable de entorno. En AWS pasa a KMS: sólo cambia
 * `envolverDek`/`abrirDek`, no el formato almacenado.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_BYTES = 12; // el tamaño que recomienda NIST para GCM
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = 1;

export type SobreCifrado = {
  v: number;
  /** DEK cifrada con la clave maestra, en base64. */
  dek: string;
  /** Texto cifrado con la DEK, en base64. */
  ct: string;
  /** Identificador de la clave maestra usada, para poder rotarla. */
  kek: string;
};

function assertKey(k: Uint8Array, nombre: string): void {
  if (k.length !== KEY_BYTES) {
    throw new RangeError(`${nombre} debe tener ${KEY_BYTES} bytes (256 bits)`);
  }
}

/**
 * Cifra con AES-256-GCM. El resultado lleva IV ‖ tag ‖ ciphertext.
 *
 * `aad` entra en el cálculo del tag sin cifrarse: se usa para atar el texto
 * cifrado a su contexto, de modo que un secreto de la empresa A no pueda
 * descifrarse presentándolo como de la empresa B.
 */
export function cifrar(clave: Uint8Array, plano: Uint8Array, aad?: Uint8Array): Uint8Array {
  assertKey(clave, "clave");
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALG, clave, iv);
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plano), c.final()]);
  // Se devuelve Uint8Array y no Buffer: el tipo declarado debe coincidir con el
  // prototipo real, o comparar resultados sorprende a quien llame.
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct]));
}

export function descifrar(clave: Uint8Array, blob: Uint8Array, aad?: Uint8Array): Uint8Array {
  assertKey(clave, "clave");
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error("blob cifrado truncado");
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const d = createDecipheriv(ALG, clave, iv);
  d.setAuthTag(tag);
  if (aad) d.setAAD(aad);
  // `final()` lanza si el tag no cuadra: el dato fue alterado o la clave es otra.
  return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
}

/**
 * Sella un secreto. `contexto` debe identificar de forma estable dónde vive el
 * secreto — por ejemplo `empresa:<uuid>:certificado` — y hay que pasar el mismo
 * valor al abrirlo.
 */
export function sellar(
  kek: Uint8Array,
  kekId: string,
  secreto: Uint8Array,
  contexto: string,
): SobreCifrado {
  assertKey(kek, "kek");
  const dek = randomBytes(KEY_BYTES);
  const aad = Buffer.from(contexto, "utf8");
  const sobre: SobreCifrado = {
    v: VERSION,
    dek: Buffer.from(cifrar(kek, dek, aad)).toString("base64"),
    ct: Buffer.from(cifrar(dek, secreto, aad)).toString("base64"),
    kek: kekId,
  };
  dek.fill(0);
  return sobre;
}

export function abrir(kek: Uint8Array, sobre: SobreCifrado, contexto: string): Uint8Array {
  assertKey(kek, "kek");
  if (sobre.v !== VERSION) throw new Error(`versión de sobre no soportada: ${sobre.v}`);
  const aad = Buffer.from(contexto, "utf8");
  const dek = descifrar(kek, Buffer.from(sobre.dek, "base64"), aad);
  try {
    return descifrar(dek, Buffer.from(sobre.ct, "base64"), aad);
  } finally {
    dek.fill(0);
  }
}

/** Lee la clave maestra del entorno. Falla al arrancar si no está o mide mal. */
export function kekDesdeEntorno(env: NodeJS.ProcessEnv = process.env): {
  kek: Uint8Array;
  kekId: string;
} {
  const raw = env["ROULTERP_KEK"];
  if (!raw) throw new Error("falta ROULTERP_KEK (32 bytes en base64)");
  const kek = new Uint8Array(Buffer.from(raw, "base64"));
  assertKey(kek, "ROULTERP_KEK");
  return { kek, kekId: env["ROULTERP_KEK_ID"] ?? "env-1" };
}

/** Comparación de tiempo constante para secretos de igual longitud esperada. */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
