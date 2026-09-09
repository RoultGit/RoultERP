/**
 * Regímenes de pago adelantado del IGV: detracciones, retenciones y
 * percepciones.
 *
 * Las tasas y los códigos los fija SUNAT por resolución y cambian con cierta
 * frecuencia. Por eso viven en la base de datos con fecha de vigencia y aquí
 * sólo está la aritmética; las tablas de este archivo son la semilla con la que
 * arranca una empresa nueva, no la fuente de verdad.
 */
import { type Dec, dec, add, sub, mul, round, trunc, gt, lt, ZERO } from "../money.ts";

// ─── Detracción (SPOT) ────────────────────────────────────────────────────

/**
 * Importe mínimo de la operación para que nazca la obligación de detraer.
 * R.S. 183-2004/SUNAT y modificatorias.
 */
export const MINIMO_DETRACCION = dec("700.00");

export type ReglaDetraccion = {
  /** Código del anexo (catálogo 54 de SUNAT). */
  codigo: string;
  descripcion: string;
  /** Tasa como fracción: 0.12 para 12 %. */
  tasa: Dec;
  /** Si es false, se detrae desde el primer sol sin importar el mínimo. */
  aplicaMinimo: boolean;
};

const r = (codigo: string, descripcion: string, tasa: string, aplicaMinimo = true): ReglaDetraccion =>
  ({ codigo, descripcion, tasa: dec(tasa), aplicaMinimo });

/**
 * Semilla de reglas vigentes al 2026-09. Se carga en la tabla de la empresa al
 * crearla y desde ahí se mantiene; no se lee de aquí en tiempo de ejecución.
 */
export const DETRACCION_SEED: readonly ReglaDetraccion[] = [
  // Anexo 2 — bienes
  r("004", "Recursos hidrobiológicos", "0.04"),
  r("005", "Maíz amarillo duro", "0.04"),
  r("008", "Madera", "0.04"),
  r("009", "Arena y piedra", "0.10"),
  r("010", "Residuos, subproductos, desechos y recortes", "0.15"),
  r("014", "Carnes y despojos comestibles", "0.04"),
  r("031", "Oro gravado con el IGV", "0.10"),
  r("034", "Minerales metálicos no auríferos", "0.10"),
  r("035", "Bienes exonerados del IGV", "0.015"),
  r("036", "Oro y demás minerales metálicos exonerados del IGV", "0.015"),
  r("039", "Minerales no metálicos", "0.10"),
  r("040", "Bien inmueble gravado con IGV", "0.04"),
  // Anexo 3 — servicios
  r("012", "Intermediación laboral y tercerización", "0.12"),
  r("019", "Arrendamiento de bienes", "0.10"),
  r("020", "Mantenimiento y reparación de bienes muebles", "0.12"),
  r("021", "Movimiento de carga", "0.10"),
  r("022", "Otros servicios empresariales", "0.12"),
  r("024", "Comisión mercantil", "0.12"),
  r("025", "Fabricación de bienes por encargo", "0.12"),
  r("026", "Servicio de transporte de personas", "0.10"),
  r("027", "Servicio de transporte de carga", "0.04"),
  r("030", "Contratos de construcción", "0.04"),
  r("037", "Demás servicios gravados con el IGV", "0.12"),
];

export type Detraccion = {
  aplica: boolean;
  codigo: string;
  tasa: Dec;
  /** Monto a depositar en el Banco de la Nación, en soles enteros. */
  monto: Dec;
  /** Saldo que se le paga al proveedor. */
  neto: Dec;
};

/**
 * Calcula la detracción de una operación.
 *
 * El depósito se expresa en soles sin céntimos. `redondeo` decide cómo: SUNAT
 * admite el redondeo al entero más cercano, que es el defecto, pero algunas
 * empresas cierran con su contador que siempre se redondea hacia arriba. Es un
 * parámetro por empresa, no una constante.
 *
 * ponytail: la base es el importe total con IGV. Si algún día hay un supuesto
 * con base distinta, entra como otro campo de la regla, no como un `if` aquí.
 */
export function calcularDetraccion(
  totalOperacion: Dec,
  regla: ReglaDetraccion,
  opts: { redondeo?: "cercano" | "arriba"; minimo?: Dec } = {},
): Detraccion {
  const minimo = opts.minimo ?? MINIMO_DETRACCION;
  const aplica = !regla.aplicaMinimo || gt(totalOperacion, minimo);
  if (!aplica) {
    return { aplica: false, codigo: regla.codigo, tasa: regla.tasa, monto: ZERO, neto: totalOperacion };
  }
  const bruto = mul(totalOperacion, regla.tasa);
  const monto =
    opts.redondeo === "arriba" ? techoSoles(bruto) : round(bruto, 0);
  return {
    aplica: true,
    codigo: regla.codigo,
    tasa: regla.tasa,
    monto,
    neto: sub(totalOperacion, monto),
  };
}

/** Redondeo hacia arriba al sol entero. Para negativos, hacia cero. */
function techoSoles(v: Dec): Dec {
  const piso = trunc(v, 0);
  return lt(piso, v) ? add(piso, dec("1")) : piso;
}

export const buscarRegla = (
  reglas: readonly ReglaDetraccion[],
  codigo: string,
): ReglaDetraccion | undefined => reglas.find((x) => x.codigo === codigo);

// ─── Retención del IGV ────────────────────────────────────────────────────

/** Tasa del régimen general de retenciones desde el 01/03/2014. */
export const TASA_RETENCION = dec("0.03");
/** Por debajo de este importe pagado no se retiene. */
export const MINIMO_RETENCION = dec("700.00");

export type Retencion = { aplica: boolean; tasa: Dec; monto: Dec; neto: Dec };

/**
 * Retención que practica un agente de retención al pagar a su proveedor.
 *
 * Se calcula sobre el importe que se paga, no sobre el total de la factura: en
 * un pago parcial se retiene sobre lo pagado. El mínimo también se evalúa
 * contra el importe de la operación, que es lo que fija la norma.
 *
 * No se retiene si la operación ya está sujeta a detracción o percepción; esa
 * exclusión la decide quien llama, porque depende del documento completo.
 */
export function calcularRetencion(
  importePagado: Dec,
  opts: { tasa?: Dec; totalOperacion?: Dec; minimo?: Dec } = {},
): Retencion {
  const tasa = opts.tasa ?? TASA_RETENCION;
  const minimo = opts.minimo ?? MINIMO_RETENCION;
  const base = opts.totalOperacion ?? importePagado;
  if (!gt(base, minimo)) {
    return { aplica: false, tasa, monto: ZERO, neto: importePagado };
  }
  const monto = round(mul(importePagado, tasa), 2);
  return { aplica: true, tasa, monto, neto: sub(importePagado, monto) };
}

// ─── Percepción del IGV ───────────────────────────────────────────────────

/** Catálogo 22 de SUNAT: régimen de percepción aplicable. */
export const PERCEPCION = {
  /** Venta interna, tasa general. */
  VENTA_INTERNA: { codigo: "01", tasa: dec("0.02") },
  /** Adquisición de combustible. */
  COMBUSTIBLE: { codigo: "02", tasa: dec("0.01") },
  /** Agente de percepción que vende a otro agente: tasa reducida. */
  VENTA_INTERNA_REDUCIDA: { codigo: "01", tasa: dec("0.005") },
} as const;

export type Percepcion = { tasa: Dec; monto: Dec; totalConPercepcion: Dec };

/**
 * Percepción que cobra un agente de percepción por encima del precio de venta.
 *
 * A diferencia de la retención, esto **aumenta** lo que paga el cliente: el
 * agente cobra el total más la percepción y la entrega al fisco.
 */
export function calcularPercepcion(
  totalOperacion: Dec,
  tasa: Dec = PERCEPCION.VENTA_INTERNA.tasa,
): Percepcion {
  const monto = round(mul(totalOperacion, tasa), 2);
  return { tasa, monto, totalConPercepcion: add(totalOperacion, monto) };
}

/**
 * Los tres regímenes se excluyen entre sí sobre una misma operación.
 * Devuelve el que corresponde según la prioridad que fija la norma:
 * detracción primero, luego percepción, luego retención.
 */
export function regimenAplicable(flags: {
  sujetoDetraccion: boolean;
  sujetoPercepcion: boolean;
  sujetoRetencion: boolean;
}): "detraccion" | "percepcion" | "retencion" | "ninguno" {
  if (flags.sujetoDetraccion) return "detraccion";
  if (flags.sujetoPercepcion) return "percepcion";
  if (flags.sujetoRetencion) return "retencion";
  return "ninguno";
}
