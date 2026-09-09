/**
 * Asientos contables por partida doble.
 *
 * El libro es **append-only**: un asiento contabilizado no se edita ni se
 * borra, se extorna con su inverso. No es una preferencia de diseño, es lo que
 * exige un libro legal, y es también lo que hace que el sistema sirva como
 * prueba ante una fiscalización.
 *
 * Todo asiento lleva dos importes por línea: el de la moneda de la operación y
 * el de la moneda funcional. Un importador cobra en dólares y declara en soles;
 * guardar sólo uno de los dos obliga a reconstruir el otro con el tipo de
 * cambio de hoy, que no es el de la operación.
 */
import {
  type Dec, add, sub, mul, neg, sum, round, toString, ZERO, isZero, gt, lt, eq,
} from "../money.ts";

export type Estado = "borrador" | "contabilizado" | "extornado" | "anulado";

export type LineaAsiento = {
  /** Cuenta del PCGE, hasta divisionaria. */
  cuenta: string;
  glosa?: string;
  /** Importe al debe en moneda de la operación. Uno de los dos debe ser cero. */
  debe: Dec;
  haber: Dec;
  /** Los mismos importes convertidos a la moneda funcional. */
  debeFuncional: Dec;
  haberFuncional: Dec;
  centroCostoId?: string;
  /** Cliente, proveedor o empleado al que se imputa el saldo. */
  anexoId?: string;
  documento?: { tipo: string; serie: string; numero: string; fecha: Date };
};

export type Asiento = {
  id: string;
  /** Periodo contable al que pertenece, en formato AAAAMM. */
  periodo: string;
  fecha: Date;
  /** Libro o subdiario del que proviene (catálogo 8 de SUNAT). */
  subdiario: string;
  glosa: string;
  moneda: string;
  tipoCambio: Dec;
  estado: Estado;
  lineas: readonly LineaAsiento[];
  /** Si es un extorno, el asiento que revierte. */
  extornaA?: string;
  origen?: { modulo: string; documentoId: string };
};

export class AsientoInvalido extends Error {
  constructor(
    readonly motivos: readonly string[],
  ) {
    super(motivos.join("; "));
    this.name = "AsientoInvalido";
  }
}

export type Totales = {
  debe: Dec;
  haber: Dec;
  debeFuncional: Dec;
  haberFuncional: Dec;
  diferencia: Dec;
  diferenciaFuncional: Dec;
};

export function totales(lineas: readonly LineaAsiento[]): Totales {
  const debe = round(sum(lineas.map((l) => l.debe)), 2);
  const haber = round(sum(lineas.map((l) => l.haber)), 2);
  const debeFuncional = round(sum(lineas.map((l) => l.debeFuncional)), 2);
  const haberFuncional = round(sum(lineas.map((l) => l.haberFuncional)), 2);
  return {
    debe, haber, debeFuncional, haberFuncional,
    diferencia: sub(debe, haber),
    diferenciaFuncional: sub(debeFuncional, haberFuncional),
  };
}

/**
 * Reúne todos los motivos por los que un asiento no es válido, en vez de fallar
 * en el primero. Quien captura un asiento de veinte líneas necesita ver los
 * cuatro errores de una vez, no descubrirlos uno por uno.
 */
export function validar(a: Asiento): string[] {
  const motivos: string[] = [];

  if (a.lineas.length < 2) {
    motivos.push("un asiento necesita al menos dos líneas");
  }
  if (!/^\d{6}$/.test(a.periodo)) {
    motivos.push("el periodo debe tener el formato AAAAMM");
  }
  if (a.glosa.trim() === "") {
    motivos.push("la glosa es obligatoria");
  }
  if (!gt(a.tipoCambio, ZERO)) {
    motivos.push("el tipo de cambio debe ser positivo");
  }

  a.lineas.forEach((l, i) => {
    const n = i + 1;
    if (l.cuenta.trim() === "") motivos.push(`línea ${n}: falta la cuenta`);
    if (lt(l.debe, ZERO) || lt(l.haber, ZERO)) {
      motivos.push(`línea ${n}: los importes no pueden ser negativos; use el lado contrario`);
    }
    if (!isZero(l.debe) && !isZero(l.haber)) {
      motivos.push(`línea ${n}: no puede tener importe al debe y al haber a la vez`);
    }
    if (!isZero(l.debeFuncional) && !isZero(l.haberFuncional)) {
      motivos.push(`línea ${n}: no puede tener importe funcional al debe y al haber a la vez`);
    }
    /*
     * Una línea sin importe en ninguna moneda no dice nada y sobra.
     *
     * Se admite, en cambio, la que sólo tiene importe funcional: es la
     * diferencia de cambio. Una deuda de 1180 dólares registrada a 3.75 y
     * pagada a 3.80 se cancela por los mismos 1180 dólares, pero cuesta 59
     * soles más. Esos 59 soles existen únicamente en la moneda funcional, y
     * exigirles una contrapartida en dólares sería pedir que el asiento mienta.
     */
    if (isZero(l.debe) && isZero(l.haber) && isZero(l.debeFuncional) && isZero(l.haberFuncional)) {
      motivos.push(`línea ${n}: no puede tener importe cero en ninguna moneda`);
    }
    // Al revés sí es un error: un importe en la moneda de la operación sin su
    // equivalente funcional descuadra el balance en soles.
    if (!isZero(l.debe) && isZero(l.debeFuncional)) {
      motivos.push(`línea ${n}: falta el importe funcional al debe`);
    }
    if (!isZero(l.haber) && isZero(l.haberFuncional)) {
      motivos.push(`línea ${n}: falta el importe funcional al haber`);
    }
  });

  const t = totales(a.lineas);
  if (!isZero(t.diferencia)) {
    motivos.push(`el asiento no cuadra: descuadre de ${toString(t.diferencia, 2)}`);
  }
  if (!isZero(t.diferenciaFuncional)) {
    motivos.push("el asiento no cuadra en moneda funcional");
  }

  return motivos;
}

export const esValido = (a: Asiento): boolean => validar(a).length === 0;

export function exigirValido(a: Asiento): void {
  const motivos = validar(a);
  if (motivos.length > 0) throw new AsientoInvalido(motivos);
}

/**
 * Marca un asiento como contabilizado. A partir de aquí es inmutable.
 */
export function contabilizar(a: Asiento): Asiento {
  if (a.estado !== "borrador") {
    throw new AsientoInvalido([`sólo se contabiliza un borrador; este está ${a.estado}`]);
  }
  exigirValido(a);
  return { ...a, estado: "contabilizado" };
}

/**
 * Genera el asiento que revierte a otro.
 *
 * Se invierten los lados en vez de negar los importes: un haber negativo no es
 * contabilidad, es una hoja de cálculo. El extorno conserva la cuenta, el
 * centro de costo y el anexo de cada línea, para que el saldo por tercero
 * también se revierta.
 */
export function extornar(
  a: Asiento,
  datos: { id: string; fecha: Date; periodo: string; glosa?: string },
): { original: Asiento; extorno: Asiento } {
  if (a.estado !== "contabilizado") {
    throw new AsientoInvalido([`sólo se extorna un asiento contabilizado; este está ${a.estado}`]);
  }
  const extorno: Asiento = {
    ...a,
    id: datos.id,
    fecha: datos.fecha,
    periodo: datos.periodo,
    glosa: datos.glosa ?? `Extorno de: ${a.glosa}`,
    estado: "contabilizado",
    extornaA: a.id,
    lineas: a.lineas.map((l) => ({
      ...l,
      debe: l.haber,
      haber: l.debe,
      debeFuncional: l.haberFuncional,
      haberFuncional: l.debeFuncional,
    })),
  };
  exigirValido(extorno);
  return { original: { ...a, estado: "extornado" }, extorno };
}

/** Saldo de una cuenta: deudor si es positivo, acreedor si es negativo. */
export type SaldoCuenta = {
  cuenta: string;
  debe: Dec;
  haber: Dec;
  saldo: Dec;
};

/**
 * Balance de comprobación en moneda funcional.
 *
 * Sólo considera asientos contabilizados: un borrador no es contabilidad, y un
 * extornado ya está compensado por su extorno, que sí se cuenta.
 */
export function balance(asientos: readonly Asiento[]): SaldoCuenta[] {
  const acc = new Map<string, { debe: Dec; haber: Dec }>();
  for (const a of asientos) {
    if (a.estado !== "contabilizado" && a.estado !== "extornado") continue;
    for (const l of a.lineas) {
      const cur = acc.get(l.cuenta) ?? { debe: ZERO, haber: ZERO };
      acc.set(l.cuenta, {
        debe: add(cur.debe, l.debeFuncional),
        haber: add(cur.haber, l.haberFuncional),
      });
    }
  }
  return [...acc]
    .map(([cuenta, v]) => ({
      cuenta,
      debe: round(v.debe, 2),
      haber: round(v.haber, 2),
      saldo: round(sub(v.debe, v.haber), 2),
    }))
    .sort((x, y) => x.cuenta.localeCompare(y.cuenta));
}

/** El balance de comprobación tiene que sumar cero. Si no, hay un asiento roto. */
export function balanceCuadra(saldos: readonly SaldoCuenta[]): boolean {
  return isZero(round(sum(saldos.map((s) => s.saldo)), 2));
}

/**
 * Diferencia de cambio de una partida en moneda extranjera.
 *
 * Positiva es ganancia (cuenta 77), negativa es pérdida (cuenta 67). El signo
 * depende de si la partida es activo o pasivo: una subida del dólar favorece a
 * quien tiene una cuenta por cobrar en dólares y perjudica a quien tiene una
 * por pagar. Por eso la naturaleza entra como parámetro y no se adivina.
 */
export function diferenciaCambio(
  montoMonedaExtranjera: Dec,
  tipoCambioOriginal: Dec,
  tipoCambioCierre: Dec,
  naturaleza: "activo" | "pasivo",
): { importe: Dec; cuenta: "77" | "67" } {
  const original = mul(montoMonedaExtranjera, tipoCambioOriginal);
  const cierre = mul(montoMonedaExtranjera, tipoCambioCierre);
  const bruto = round(sub(cierre, original), 2);
  const importe = naturaleza === "activo" ? bruto : neg(bruto);
  return { importe, cuenta: gt(importe, ZERO) ? "77" : "67" };
}

/** Igualdad de asientos por su efecto contable, para pruebas de recálculo. */
export function mismoEfecto(a: Asiento, b: Asiento): boolean {
  const norm = (x: Asiento) =>
    [...x.lineas]
      .map((l) => `${l.cuenta}|${l.debeFuncional}|${l.haberFuncional}|${l.anexoId ?? ""}`)
      .sort()
      .join("\n");
  const ta = totales(a.lineas);
  const tb = totales(b.lineas);
  return norm(a) === norm(b) && eq(ta.debeFuncional, tb.debeFuncional);
}
