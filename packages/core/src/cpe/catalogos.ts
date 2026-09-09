/**
 * Catálogos de SUNAT para comprobantes electrónicos.
 *
 * Son los códigos que van dentro del XML. No se inventan: cada uno viene de un
 * anexo publicado, y usar el valor equivocado hace que SUNAT rechace el
 * comprobante con un mensaje que no dice cuál campo estaba mal.
 *
 * Se mantienen aquí, en el dominio, porque el generador del XML y la validación
 * previa tienen que estar de acuerdo. Un catálogo duplicado en dos sitios se
 * desincroniza a la primera resolución.
 */

/** Catálogo 01: tipo de documento. */
export const TIPO_DOCUMENTO = {
  FACTURA: "01",
  BOLETA: "03",
  NOTA_CREDITO: "07",
  NOTA_DEBITO: "08",
  GUIA_REMISION_REMITENTE: "09",
  RECIBO_SERVICIOS: "14",
  GUIA_REMISION_TRANSPORTISTA: "31",
  COMPROBANTE_RETENCION: "20",
  COMPROBANTE_PERCEPCION: "40",
} as const;
export type TipoDocumento = (typeof TIPO_DOCUMENTO)[keyof typeof TIPO_DOCUMENTO];

/** Catálogo 06: tipo de documento de identidad. */
export const TIPO_IDENTIDAD = {
  SIN_DOCUMENTO: "0",
  DNI: "1",
  CARNE_EXTRANJERIA: "4",
  RUC: "6",
  PASAPORTE: "7",
  CEDULA_DIPLOMATICA: "A",
} as const;

/** Catálogo 09: motivo de la nota de crédito. */
export const MOTIVO_NOTA_CREDITO = {
  ANULACION_OPERACION: "01",
  ANULACION_ERROR_RUC: "02",
  CORRECCION_DESCRIPCION: "03",
  DESCUENTO_GLOBAL: "04",
  DESCUENTO_POR_ITEM: "05",
  DEVOLUCION_TOTAL: "06",
  DEVOLUCION_POR_ITEM: "07",
  BONIFICACION: "08",
  DISMINUCION_VALOR: "09",
  OTROS_CONCEPTOS: "10",
} as const;

/** Catálogo 10: motivo de la nota de débito. */
export const MOTIVO_NOTA_DEBITO = {
  INTERES_MORA: "01",
  AUMENTO_VALOR: "02",
  PENALIDADES: "03",
} as const;

/** Catálogo 51: tipo de operación de venta. */
export const TIPO_OPERACION = {
  VENTA_INTERNA: "0101",
  EXPORTACION: "0200",
  NO_DOMICILIADOS: "0401",
  VENTA_INTERNA_ANTICIPOS: "0102",
  VENTA_ITINERANTE: "0103",
  DETRACCION: "1001",
  DETRACCION_RECURSOS_HIDROBIOLOGICOS: "1002",
  PERCEPCION: "2001",
} as const;

/**
 * Catálogo 05: tributos.
 *
 * Cada tributo lleva tres datos que SUNAT valida entre sí: el código, su nombre
 * y su código internacional. Enviar el nombre de uno con el código de otro es
 * un rechazo seguro.
 */
export const TRIBUTOS = {
  IGV: { codigo: "1000", nombre: "IGV", tipo: "VAT" },
  IVAP: { codigo: "1016", nombre: "IVAP", tipo: "VAT" },
  ISC: { codigo: "2000", nombre: "ISC", tipo: "EXC" },
  EXPORTACION: { codigo: "9995", nombre: "EXP", tipo: "FRE" },
  GRATUITO: { codigo: "9996", nombre: "GRA", tipo: "FRE" },
  EXONERADO: { codigo: "9997", nombre: "EXO", tipo: "VAT" },
  INAFECTO: { codigo: "9998", nombre: "INA", tipo: "FRE" },
  OTROS: { codigo: "9999", nombre: "OTROS", tipo: "OTH" },
  ICBPER: { codigo: "7152", nombre: "ICBPER", tipo: "OTH" },
} as const;

/**
 * Tributo que corresponde a cada tipo de afectación del catálogo 07.
 *
 * Es la tabla que más rechazos evita: una línea exonerada con el código de
 * tributo del IGV, o una gratuita sin el código 9996, rebota el comprobante
 * entero.
 */
export function tributoDeAfectacion(afectacion: string): {
  codigo: string;
  nombre: string;
  tipo: string;
} {
  if (afectacion === "40") return TRIBUTOS.EXPORTACION;
  if (afectacion === "17") return TRIBUTOS.IVAP;
  // Las gratuitas —retiros, bonificaciones, muestras— llevan siempre 9996,
  // sin importar si su naturaleza original era gravada o exonerada.
  if (["11", "12", "13", "14", "15", "16", "21", "31", "32", "33", "34", "35", "36"].includes(afectacion)) {
    return TRIBUTOS.GRATUITO;
  }
  if (afectacion.startsWith("1")) return TRIBUTOS.IGV;
  if (afectacion.startsWith("2")) return TRIBUTOS.EXONERADO;
  if (afectacion.startsWith("3")) return TRIBUTOS.INAFECTO;
  return TRIBUTOS.OTROS;
}

/**
 * Código de precio del catálogo 16.
 *
 * `01` cuando el precio se cobra, `02` cuando la operación es gratuita. En una
 * línea gratuita, SUNAT exige además que el valor de venta sea cero y que el
 * precio referencial vaya en su propio elemento.
 */
export const codigoPrecio = (esGratuita: boolean): "01" | "02" => (esGratuita ? "02" : "01");

/** Catálogo 59: medio de pago para la detracción. */
export const MEDIO_PAGO_DETRACCION = {
  DEPOSITO_EN_CUENTA: "001",
  GIRO: "002",
  TRANSFERENCIA_DE_FONDOS: "003",
} as const;

/** Códigos de moneda ISO 4217 admitidos. */
export const MONEDAS = ["PEN", "USD", "EUR"] as const;

/**
 * Estado del comprobante ante SUNAT.
 *
 * `aceptado_con_observaciones` existe porque SUNAT acepta comprobantes con
 * advertencias: el CDR llega con código 0 pero con notas. El comprobante es
 * válido, y aun así conviene que alguien las lea.
 */
export const ESTADO_CPE = {
  BORRADOR: "borrador",
  FIRMADO: "firmado",
  ENVIADO: "enviado",
  ACEPTADO: "aceptado",
  ACEPTADO_CON_OBSERVACIONES: "aceptado_con_observaciones",
  RECHAZADO: "rechazado",
  ANULADO: "anulado",
  BAJA_SOLICITADA: "baja_solicitada",
  DADO_DE_BAJA: "dado_de_baja",
} as const;
export type EstadoCpe = (typeof ESTADO_CPE)[keyof typeof ESTADO_CPE];

/**
 * ¿El código de respuesta de SUNAT significa aceptación?
 *
 * 0 es aceptado. De 100 a 1999 son errores del contribuyente que se corrigen y
 * se reenvían. De 2000 a 3999, el comprobante queda rechazado y hay que emitir
 * otro. Los 4000 son observaciones: el comprobante se aceptó igual.
 */
export function interpretarRespuesta(codigo: number): EstadoCpe {
  if (codigo === 0) return ESTADO_CPE.ACEPTADO;
  if (codigo >= 4000) return ESTADO_CPE.ACEPTADO_CON_OBSERVACIONES;
  return ESTADO_CPE.RECHAZADO;
}

/** ¿Conviene reintentar este envío, o el error es del propio comprobante? */
export function esReintentable(codigo: number): boolean {
  // Los 0100-0999 son fallas del servicio de SUNAT: caído, en mantenimiento,
  // sin capacidad. Reintentar tiene sentido. Un error del comprobante, no.
  return codigo >= 100 && codigo < 1000;
}
