/**
 * Representación impresa del comprobante electrónico.
 *
 * El XML es el comprobante; lo que se entrega al cliente en el mostrador es su
 * representación impresa, y la norma dice qué tiene que llevar: los datos del
 * emisor y del adquirente, el detalle, el total en letras, el **resumen del
 * XML** y un **código QR** con los datos de la operación.
 *
 * Aquí vive sólo el código QR: su contenido tiene un orden exacto que se
 * equivoca con facilidad y conviene fijarlo con pruebas. El importe en letras
 * ya lo calcula `enLetras`, en el módulo de ventas, y es el que va dentro del
 * XML: tener dos daría dos importes en letras para el mismo comprobante, uno en
 * el archivo y otro en la hoja. El diseño de la hoja es de la aplicación web.
 */
import QRCode from "qrcode";

/**
 * Contenido del código QR, según el anexo de la R.S. 097-2012/SUNAT y sus
 * modificatorias.
 *
 * Nueve campos separados por `|` y en este orden exacto: RUC del emisor, tipo
 * de comprobante, serie, número, IGV, importe total, fecha de emisión, tipo de
 * documento del adquirente y su número. El resumen del XML va al final.
 *
 * El orden importa más de lo que parece: quien lee el QR es una aplicación, no
 * una persona, y un campo cambiado de sitio da un comprobante que no valida sin
 * que nadie lo note mirando la hoja.
 */
export function contenidoQr(datos: {
  rucEmisor: string;
  tipoComprobante: string;
  serie: string;
  numero: string;
  igv: string;
  total: string;
  /** AAAA-MM-DD. */
  fechaEmision: string;
  tipoDocAdquirente: string;
  numeroDocAdquirente: string;
  /** Resumen SHA-256 del XML firmado. */
  hash?: string | null;
}): string {
  const campos = [
    datos.rucEmisor,
    datos.tipoComprobante,
    datos.serie,
    datos.numero,
    datos.igv,
    datos.total,
    datos.fechaEmision,
    datos.tipoDocAdquirente,
    datos.numeroDocAdquirente,
  ];
  // El resumen va al final y sólo si existe: un comprobante todavía sin firmar
  // no tiene hash, y poner uno vacío con su barra delante deja un campo que no
  // es ninguno de los dos.
  return datos.hash ? `${campos.join("|")}|${datos.hash}` : campos.join("|");
}

/** El QR como imagen SVG, para incrustarla en la hoja sin pedir nada a la red. */
export function qrSvg(contenido: string): Promise<string> {
  return QRCode.toString(contenido, {
    type: "svg",
    margin: 0,
    // Nivel M: el que usan las representaciones impresas. Más corrección
    // aguantaría una hoja más sucia a costa de un código más denso.
    errorCorrectionLevel: "M",
  });
}
