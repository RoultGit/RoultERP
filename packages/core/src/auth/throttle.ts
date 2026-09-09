/**
 * Freno de fuerza bruta sobre el login.
 *
 * Lógica pura: el contador vive en Postgres, pero la decisión de bloquear se
 * toma aquí para poder probar los bordes sin base de datos.
 *
 * Se frena por cuenta y por IP a la vez, y hace falta que ambos frenos estén
 * libres. Sólo por cuenta, un atacante bloquea a un usuario a voluntad; sólo
 * por IP, una botnet lo esquiva.
 */

/** Fallos tolerados antes de que empiece la espera. */
export const UMBRAL = 5;
const BASE_MS = 2_000;
const TOPE_MS = 15 * 60 * 1000; // 15 min
/** Los fallos se olvidan tras este tiempo sin actividad. */
export const VENTANA_MS = 60 * 60 * 1000; // 1 h

export type Intentos = { fallos: number; ultimoFalloEn: Date | null };

export type Veredicto =
  | { permitido: true }
  | { permitido: false; esperaMs: number };

/** Espera exigida tras `fallos` intentos: 2 s, 4 s, 8 s… con tope de 15 min. */
export function esperaTras(fallos: number): number {
  if (fallos <= UMBRAL) return 0;
  const exceso = fallos - UMBRAL;
  return Math.min(BASE_MS * 2 ** (exceso - 1), TOPE_MS);
}

export function evaluar(i: Intentos, ahora: Date = new Date()): Veredicto {
  if (i.ultimoFalloEn === null || i.fallos <= UMBRAL) return { permitido: true };
  const transcurrido = ahora.getTime() - i.ultimoFalloEn.getTime();
  if (transcurrido >= VENTANA_MS) return { permitido: true };
  const espera = esperaTras(i.fallos);
  return transcurrido >= espera
    ? { permitido: true }
    : { permitido: false, esperaMs: espera - transcurrido };
}

/** Combina los frenos de cuenta e IP: gana el más restrictivo. */
export function evaluarAmbos(cuenta: Intentos, ip: Intentos, ahora: Date = new Date()): Veredicto {
  const a = evaluar(cuenta, ahora);
  const b = evaluar(ip, ahora);
  if (a.permitido && b.permitido) return { permitido: true };
  const esperaA = a.permitido ? 0 : a.esperaMs;
  const esperaB = b.permitido ? 0 : b.esperaMs;
  return { permitido: false, esperaMs: Math.max(esperaA, esperaB) };
}

/** Un fallo más. Reinicia el contador si la ventana ya venció. */
export function registrarFallo(i: Intentos, ahora: Date = new Date()): Intentos {
  const vencida =
    i.ultimoFalloEn === null || ahora.getTime() - i.ultimoFalloEn.getTime() >= VENTANA_MS;
  return { fallos: vencida ? 1 : i.fallos + 1, ultimoFalloEn: ahora };
}

export const limpiar = (): Intentos => ({ fallos: 0, ultimoFalloEn: null });
