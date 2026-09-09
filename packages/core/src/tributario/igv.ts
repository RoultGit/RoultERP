/**
 * Cálculo de IGV y totales de un comprobante.
 *
 * Sigue la mecánica que exige SUNAT en el UBL 2.1: el impuesto se determina
 * línea por línea según su tipo de afectación (catálogo 07), y los totales de
 * cabecera son la suma de las líneas. Calcular el IGV sobre el total agregado
 * da diferencias de céntimos que el validador de SUNAT rechaza.
 */
import {
  type Dec, dec, add, sub, mul, div, sum, round, abs, ZERO, gt, isZero,
} from "../money.ts";

/** Catálogo 07 de SUNAT: tipo de afectación del IGV. */
export const AFECTACION = {
  GRAVADO: "10",
  GRAVADO_RETIRO_PREMIO: "11",
  GRAVADO_RETIRO_DONACION: "12",
  GRAVADO_RETIRO: "13",
  GRAVADO_PUBLICIDAD: "14",
  GRAVADO_BONIFICACION: "15",
  GRAVADO_RETIRO_ENTREGA: "16",
  GRAVADO_IVAP: "17",
  EXONERADO: "20",
  EXONERADO_GRATUITO: "21",
  INAFECTO: "30",
  INAFECTO_RETIRO_BONIFICACION: "31",
  INAFECTO_RETIRO: "32",
  INAFECTO_RETIRO_MUESTRAS: "33",
  INAFECTO_RETIRO_CONVENIO: "34",
  INAFECTO_RETIRO_PUBLICIDAD: "35",
  INAFECTO_BONIFICACION: "36",
  EXPORTACION: "40",
} as const;

export type Afectacion = (typeof AFECTACION)[keyof typeof AFECTACION];

/** Tasa vigente del IGV, incluido el IPM. Parametrizable por si cambia por ley. */
export const TASA_IGV = dec("0.18");

const GRATUITAS = new Set<string>([
  AFECTACION.GRAVADO_RETIRO_PREMIO,
  AFECTACION.GRAVADO_RETIRO_DONACION,
  AFECTACION.GRAVADO_RETIRO,
  AFECTACION.GRAVADO_PUBLICIDAD,
  AFECTACION.GRAVADO_BONIFICACION,
  AFECTACION.GRAVADO_RETIRO_ENTREGA,
  AFECTACION.EXONERADO_GRATUITO,
  AFECTACION.INAFECTO_RETIRO_BONIFICACION,
  AFECTACION.INAFECTO_RETIRO,
  AFECTACION.INAFECTO_RETIRO_MUESTRAS,
  AFECTACION.INAFECTO_RETIRO_CONVENIO,
  AFECTACION.INAFECTO_RETIRO_PUBLICIDAD,
  AFECTACION.INAFECTO_BONIFICACION,
]);

/** Las gratuitas no suman al importe a pagar, pero sí se informan a SUNAT. */
export const esGratuita = (a: Afectacion): boolean => GRATUITAS.has(a);

const grava = (a: Afectacion): boolean => a.startsWith("1");
const exonera = (a: Afectacion): boolean => a.startsWith("2");
const inafecta = (a: Afectacion): boolean => a.startsWith("3");

export type LineaEntrada = {
  cantidad: Dec;
  /** Valor unitario sin IGV. */
  valorUnitario: Dec;
  afectacion: Afectacion;
  /** Descuento sobre la línea, sin IGV. Ya calculado, no porcentual. */
  descuento?: Dec;
  /** ISC de la línea, si aplica. Entra a la base del IGV. */
  isc?: Dec;
  tasaIgv?: Dec;
};

export type LineaCalculada = LineaEntrada & {
  /** Valor de venta de la línea: cantidad × unitario − descuento. */
  valorVenta: Dec;
  /** Base sobre la que se aplica el IGV: valor de venta + ISC. */
  baseIgv: Dec;
  igv: Dec;
  /** Precio unitario con impuestos, el que ve el cliente. */
  precioUnitario: Dec;
  /** Importe de la línea con impuestos. Cero en las gratuitas. */
  importe: Dec;
};

/**
 * Calcula una línea.
 *
 * En las operaciones gratuitas SUNAT exige informar el IGV que habría
 * correspondido, pero el importe a pagar es cero. Por eso `igv` puede ser
 * positivo con `importe` en cero: no es un error de cuadre.
 */
export function calcularLinea(l: LineaEntrada): LineaCalculada {
  const tasa = l.tasaIgv ?? TASA_IGV;
  const descuento = l.descuento ?? ZERO;
  const isc = l.isc ?? ZERO;

  const bruto = mul(l.cantidad, l.valorUnitario);
  const valorVenta = round(sub(bruto, descuento), 2);
  const baseIgv = round(add(valorVenta, isc), 2);
  const igv = grava(l.afectacion) ? round(mul(baseIgv, tasa), 2) : ZERO;

  const gratuita = esGratuita(l.afectacion);
  const importe = gratuita ? ZERO : round(add(baseIgv, igv), 2);
  const precioUnitario =
    gratuita || isZero(l.cantidad) ? ZERO : round(div(importe, l.cantidad), 6);

  return { ...l, valorVenta, baseIgv, igv, precioUnitario, importe };
}

export type TotalesComprobante = {
  gravadas: Dec;
  exoneradas: Dec;
  inafectas: Dec;
  exportacion: Dec;
  gratuitas: Dec;
  descuentos: Dec;
  isc: Dec;
  igv: Dec;
  /** IGV informativo de las operaciones gratuitas. No se cobra. */
  igvGratuitas: Dec;
  /** Suma de valores de venta de las operaciones onerosas. */
  valorVentaTotal: Dec;
  /** Importe total a pagar. */
  total: Dec;
  lineas: LineaCalculada[];
};

/**
 * Totaliza un comprobante a partir de sus líneas.
 *
 * `otrosCargos` son cargos globales que no son descuento ni impuesto (por
 * ejemplo, un recargo al consumo). Se suman al total sin afectar la base del
 * IGV, que es como los trata el UBL de SUNAT.
 */
export function totalizar(
  lineas: readonly LineaEntrada[],
  opts: { otrosCargos?: Dec; descuentoGlobal?: Dec } = {},
): TotalesComprobante {
  const calc = lineas.map(calcularLinea);

  const porTipo = (pred: (a: Afectacion) => boolean): Dec =>
    round(
      sum(calc.filter((l) => pred(l.afectacion) && !esGratuita(l.afectacion)).map((l) => l.valorVenta)),
      2,
    );

  const gravadas = porTipo(grava);
  const exoneradas = porTipo(exonera);
  const inafectas = porTipo(inafecta);
  const exportacion = porTipo((a) => a === AFECTACION.EXPORTACION);
  const gratuitas = round(sum(calc.filter((l) => esGratuita(l.afectacion)).map((l) => l.valorVenta)), 2);

  const igv = round(sum(calc.filter((l) => !esGratuita(l.afectacion)).map((l) => l.igv)), 2);
  const igvGratuitas = round(sum(calc.filter((l) => esGratuita(l.afectacion)).map((l) => l.igv)), 2);
  const isc = round(sum(calc.map((l) => l.isc ?? ZERO)), 2);
  const descuentos = round(
    add(sum(calc.map((l) => l.descuento ?? ZERO)), opts.descuentoGlobal ?? ZERO),
    2,
  );

  const valorVentaTotal = round(add(add(gravadas, exoneradas), add(inafectas, exportacion)), 2);
  const otrosCargos = opts.otrosCargos ?? ZERO;
  const total = round(
    sub(add(add(valorVentaTotal, isc), add(igv, otrosCargos)), opts.descuentoGlobal ?? ZERO),
    2,
  );

  return {
    gravadas, exoneradas, inafectas, exportacion, gratuitas,
    descuentos, isc, igv, igvGratuitas, valorVentaTotal, total,
    lineas: calc,
  };
}

/**
 * Obtiene el valor unitario sin IGV a partir de un precio que ya lo incluye.
 *
 * Lo usa la caja: el vendedor cotiza «este producto sale 118» y el sistema debe
 * guardar 100 como valor de venta. Al reconstruir el total desde el valor
 * unitario puede aparecer un céntimo de diferencia por redondeo; quien emita el
 * comprobante debe usar siempre el valor unitario como fuente, nunca el precio.
 */
export function valorDesdePrecio(precio: Dec, tasa: Dec = TASA_IGV): Dec {
  return round(div(precio, add(dec("1"), tasa)), 6);
}

/** ¿Los totales calculados cuadran con los declarados? Tolerancia de un céntimo. */
export function cuadra(calculado: Dec, declarado: Dec): boolean {
  return !gt(abs(sub(calculado, declarado)), dec("0.01"));
}
