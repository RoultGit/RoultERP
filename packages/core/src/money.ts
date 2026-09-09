/**
 * Aritmética decimal exacta para importes y cantidades.
 *
 * Todo valor se guarda como un bigint de unidades escaladas 10^6. Seis
 * decimales porque es lo que SUNAT admite en costo unitario del PLE 13.1 y en
 * los comprobantes electrónicos; los importes de cabecera se redondean a 2 al
 * presentarlos, nunca antes.
 *
 * No se usa `number` en ninguna operación aritmética: 0.1 + 0.2 !== 0.3 es un
 * descuadre contable, no una curiosidad.
 *
 * Un `Dec` es un bigint, y `JSON.stringify` lanza sobre bigint. Es deliberado:
 * obliga a convertir con `toString` en el borde HTTP y en el de la base, que es
 * exactamente donde hay que decidir cuántos decimales se publican. Nunca metas
 * un `Dec` crudo en una respuesta ni en un log.
 */

export const SCALE = 6;
const F = 10n ** BigInt(SCALE);

export type Dec = bigint & { readonly __dec: unique symbol };

const as = (v: bigint): Dec => v as Dec;

export const ZERO = as(0n);

/** Divide redondeando medio hacia arriba en valor absoluto (redondeo comercial). */
function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("división por cero");
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = n / d;
  const r = n % d;
  const bumped = r * 2n >= d ? q + 1n : q;
  return neg ? -bumped : bumped;
}

/**
 * Construye un Dec desde string, number o bigint.
 *
 * Se acepta `number` sólo por comodidad en literales de código y pruebas; lo
 * que venga de la base de datos o de la red debe llegar como string, porque un
 * number ya perdió precisión antes de llegar aquí.
 */
export function dec(v: string | number | bigint): Dec {
  if (typeof v === "bigint") return as(v * F);
  const s = typeof v === "number" ? numToString(v) : v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TypeError(`decimal inválido: ${s}`);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracRaw = dot === -1 ? "" : body.slice(dot + 1);
  // Trunca más allá de la escala en vez de redondear: el llamante que necesite
  // redondear lo pide explícitamente con `round`.
  const frac = fracRaw.slice(0, SCALE).padEnd(SCALE, "0");
  const mag = BigInt(intPart) * F + BigInt(frac);
  return as(neg ? -mag : mag);
}

function numToString(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError(`decimal inválido: ${n}`);
  // toFixed evita la notación exponencial de números pequeños (1e-7).
  return n.toFixed(SCALE);
}

export const add = (a: Dec, b: Dec): Dec => as(a + b);
export const sub = (a: Dec, b: Dec): Dec => as(a - b);
export const neg = (a: Dec): Dec => as(-a);
export const abs = (a: Dec): Dec => as(a < 0n ? -a : a);
export const mul = (a: Dec, b: Dec): Dec => as(divRound(a * b, F));
export const div = (a: Dec, b: Dec): Dec => as(divRound(a * F, b));

export const sum = (xs: readonly Dec[]): Dec =>
  as(xs.reduce<bigint>((acc, x) => acc + x, 0n));

export const eq = (a: Dec, b: Dec): boolean => a === b;
export const lt = (a: Dec, b: Dec): boolean => a < b;
export const lte = (a: Dec, b: Dec): boolean => a <= b;
export const gt = (a: Dec, b: Dec): boolean => a > b;
export const gte = (a: Dec, b: Dec): boolean => a >= b;
export const isZero = (a: Dec): boolean => a === 0n;
export const isNeg = (a: Dec): boolean => a < 0n;
export const cmp = (a: Dec, b: Dec): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const max = (a: Dec, b: Dec): Dec => (a >= b ? a : b);
export const min = (a: Dec, b: Dec): Dec => (a <= b ? a : b);

/** Redondea a `places` decimales, medio hacia arriba. */
export function round(a: Dec, places = 2): Dec {
  if (places < 0 || places > SCALE) throw new RangeError("places fuera de rango");
  const step = 10n ** BigInt(SCALE - places);
  return as(divRound(a, step) * step);
}

/** Trunca hacia cero a `places` decimales. */
export function trunc(a: Dec, places = 2): Dec {
  if (places < 0 || places > SCALE) throw new RangeError("places fuera de rango");
  const step = 10n ** BigInt(SCALE - places);
  return as((a / step) * step);
}

/**
 * Reparte `total` entre `weights` de forma proporcional, garantizando que la
 * suma de las partes sea exactamente `total`.
 *
 * Es la operación central del prorrateo de gastos de importación: repartir el
 * flete entre los ítems de un embarque tiene que cuadrar al céntimo con el
 * flete facturado, o la liquidación no cierra contra el asiento contable.
 *
 * El sobrante se asigna por el método del resto mayor, y a igualdad de resto
 * gana el peso mayor. Determinista: la misma entrada da siempre el mismo
 * reparto, lo que importa cuando se reprocesa una liquidación.
 */
export function distribute(
  total: Dec,
  weights: readonly Dec[],
  places = SCALE,
): Dec[] {
  if (weights.length === 0) return [];
  const step = 10n ** BigInt(SCALE - places);
  const totalUnits = total / step;
  if (total % step !== 0n) {
    throw new RangeError("el total a repartir tiene más decimales que la escala pedida");
  }

  const wSum = weights.reduce<bigint>((a, w) => a + w, 0n);
  if (wSum === 0n) {
    // Sin base para prorratear: se reparte en partes iguales para no perder el
    // importe. Ocurre con embarques de muestras a valor cero.
    const base = totalUnits / BigInt(weights.length);
    const rem = totalUnits % BigInt(weights.length);
    return weights.map((_, i) =>
      as((base + (BigInt(i) < absBig(rem) ? sign(rem) : 0n)) * step),
    );
  }

  const quotas = weights.map((w) => (totalUnits * w) / wSum);
  const rests = weights.map((w, i) => ({
    i,
    rest: totalUnits * w - quotas[i]! * wSum,
    w,
  }));
  let assigned = quotas.reduce<bigint>((a, q) => a + q, 0n);
  let leftover = totalUnits - assigned;

  // `leftover` puede ser negativo si el total es negativo (una nota de crédito
  // sobre gastos, por ejemplo). El paso es +1 o -1 según el signo.
  const stepUnit = leftover < 0n ? -1n : 1n;
  rests.sort((a, b) => {
    const byRest = cmpBig(b.rest * stepUnit, a.rest * stepUnit);
    return byRest !== 0 ? byRest : cmpBig(b.w, a.w);
  });
  let k = 0;
  while (leftover !== 0n) {
    const target = rests[k % rests.length]!;
    quotas[target.i] = quotas[target.i]! + stepUnit;
    leftover -= stepUnit;
    k++;
  }

  return quotas.map((q) => as(q * step));
}

const absBig = (v: bigint): bigint => (v < 0n ? -v : v);
const sign = (v: bigint): bigint => (v < 0n ? -1n : v > 0n ? 1n : 0n);
const cmpBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** Representación decimal con `places` decimales. Es lo que va a la base. */
export function toString(a: Dec, places = SCALE): string {
  const r = round(a, places);
  const negative = r < 0n;
  const mag = negative ? -r : r;
  const int = mag / F;
  const frac = (mag % F).toString().padStart(SCALE, "0").slice(0, places);
  const s = places > 0 ? `${int}.${frac}` : `${int}`;
  return negative && (int !== 0n || frac.replace(/0/g, "") !== "") ? `-${s}` : s;
}

/** Sólo para presentación y gráficos. Nunca para volver a operar. */
export const toNumber = (a: Dec): number => Number(toString(a, SCALE));
