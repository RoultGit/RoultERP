/**
 * Cliente del servicio de comprobantes de SUNAT.
 *
 * SUNAT recibe los comprobantes por SOAP 1.1 con autenticación WS-Security en
 * texto plano sobre HTTPS. El XML no viaja suelto: va dentro de un ZIP, en
 * base64, dentro del sobre SOAP. La respuesta trae otro ZIP con el CDR, que es
 * la constancia de aceptación y el documento que hay que conservar.
 *
 * Hay tres operaciones y conviene no confundirlas:
 *
 * - `sendBill`    facturas, notas de crédito y notas de débito. Responde en el
 *                 acto con el CDR.
 * - `sendSummary` resúmenes diarios de boletas y comunicaciones de baja.
 *                 Responde con un ticket; el CDR se recoge después.
 * - `getStatus`   recoge el resultado de un ticket.
 *
 * El usuario de acceso es `RUC + usuario SOL`, todo junto y sin separadores:
 * un RUC de once dígitos seguido del usuario secundario.
 */
import { zipSync, unzipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { interpretarRespuesta, esReintentable, type EstadoCpe } from "./catalogos.ts";

/** Endpoint de pruebas de SUNAT. No emite nada real. */
export const ENDPOINT_BETA = "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";
/** Producción: facturas, notas y resúmenes. */
export const ENDPOINT_PRODUCCION = "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService";
/** Producción: guías de remisión por su servicio propio. */
export const ENDPOINT_GUIAS = "https://e-guiaremision.sunat.gob.pe/ol-ti-itemision-guia-gem/billService";

export type Credenciales = {
  ruc: string;
  /** Usuario secundario SOL, sin el RUC delante. */
  usuarioSol: string;
  claveSol: string;
};

export type OpcionesEnvio = {
  endpoint?: string;
  /** Tiempo máximo de espera. SUNAT puede tardar; menos de 30 s da falsos negativos. */
  timeoutMs?: number;
  /** Inyectable para poder probar sin salir a la red. */
  fetchImpl?: typeof fetch;
};

export class ErrorSunat extends Error {
  constructor(
    readonly codigo: number,
    mensaje: string,
    readonly reintentable = esReintentable(codigo),
  ) {
    super(mensaje);
    this.name = "ErrorSunat";
  }
}

/**
 * Empaqueta el XML en un ZIP con el nombre que espera SUNAT.
 *
 * El archivo dentro del ZIP debe llamarse igual que el ZIP, con extensión
 * `.xml`. SUNAT lo busca por nombre y rechaza el envío si no lo encuentra.
 */
export function empaquetar(nombre: string, xml: string): Uint8Array {
  return zipSync(
    { [`${nombre}.xml`]: new TextEncoder().encode(xml) },
    // Nivel 6: la diferencia con el máximo es despreciable para un XML de unas
    // decenas de kilobytes, y no vale el tiempo de CPU en una función serverless.
    { level: 6 },
  );
}

/** Extrae el primer XML de un ZIP; es como viene el CDR. */
export function desempaquetar(zip: Uint8Array): { nombre: string; contenido: string } | null {
  const archivos = unzipSync(zip);
  const nombre = Object.keys(archivos).find((n) => n.toLowerCase().endsWith(".xml"));
  if (!nombre) return null;
  return { nombre, contenido: new TextDecoder().decode(archivos[nombre]!) };
}

/**
 * Sobre SOAP con la cabecera WS-Security.
 *
 * SUNAT usa `PasswordText`, es decir, la clave viaja en claro dentro del sobre.
 * La confidencialidad la da TLS y nada más, así que este sobre no debe
 * registrarse en ningún log.
 */
function sobreSoap(cred: Credenciales, cuerpo: string): string {
  const usuario = `${cred.ruc}${cred.usuarioSol}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
<soapenv:Header>
<wsse:Security>
<wsse:UsernameToken>
<wsse:Username>${escaparXml(usuario)}</wsse:Username>
<wsse:Password>${escaparXml(cred.claveSol)}</wsse:Password>
</wsse:UsernameToken>
</wsse:Security>
</soapenv:Header>
<soapenv:Body>${cuerpo}</soapenv:Body>
</soapenv:Envelope>`;
}

const escaparXml = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type RespuestaCdr = {
  estado: EstadoCpe;
  codigo: number;
  descripcion: string;
  /** Notas que SUNAT devuelve junto con una aceptación. */
  observaciones: string[];
  /** El ZIP del CDR tal como llegó. Hay que conservarlo. */
  cdrZip: Uint8Array;
  /** El XML del CDR ya extraído. */
  cdrXml: string;
};

/**
 * Envía una factura, una nota de crédito o una nota de débito.
 *
 * Devuelve el CDR ya interpretado. Un rechazo llega como `ErrorSunat` con el
 * código, porque un comprobante rechazado no es un resultado que el sistema
 * pueda guardar como si fuera bueno.
 */
export async function enviarComprobante(
  cred: Credenciales,
  nombre: string,
  xmlFirmado: string,
  opts: OpcionesEnvio = {},
): Promise<RespuestaCdr> {
  const zip = empaquetar(nombre, xmlFirmado);
  const cuerpo = `<ser:sendBill><fileName>${escaparXml(nombre)}.zip</fileName><contentFile>${Buffer.from(zip).toString("base64")}</contentFile></ser:sendBill>`;

  const respuesta = await llamar(cred, "sendBill", cuerpo, opts);
  const base64 = extraer(respuesta, "applicationResponse");
  if (!base64) {
    // Sin CDR no hay constancia. Puede ser un fallo del servicio o un error de
    // autenticación; en ambos casos el comprobante queda sin enviar.
    const fault = extraerFault(respuesta);
    throw new ErrorSunat(fault.codigo, fault.mensaje);
  }

  return leerCdr(new Uint8Array(Buffer.from(base64, "base64")));
}

/**
 * Envía un resumen diario o una comunicación de baja.
 *
 * Responde con un ticket, no con el CDR: SUNAT los procesa en diferido y el
 * resultado se recoge después con `consultarTicket`.
 */
export async function enviarResumen(
  cred: Credenciales,
  nombre: string,
  xmlFirmado: string,
  opts: OpcionesEnvio = {},
): Promise<{ ticket: string }> {
  const zip = empaquetar(nombre, xmlFirmado);
  const cuerpo = `<ser:sendSummary><fileName>${escaparXml(nombre)}.zip</fileName><contentFile>${Buffer.from(zip).toString("base64")}</contentFile></ser:sendSummary>`;

  const respuesta = await llamar(cred, "sendSummary", cuerpo, opts);
  const ticket = extraer(respuesta, "ticket");
  if (!ticket) {
    const fault = extraerFault(respuesta);
    throw new ErrorSunat(fault.codigo, fault.mensaje);
  }
  return { ticket };
}

/** Recoge el resultado de un ticket de resumen o de baja. */
export async function consultarTicket(
  cred: Credenciales,
  ticket: string,
  opts: OpcionesEnvio = {},
): Promise<RespuestaCdr | { enProceso: true }> {
  const cuerpo = `<ser:getStatus><ticket>${escaparXml(ticket)}</ticket></ser:getStatus>`;
  const respuesta = await llamar(cred, "getStatus", cuerpo, opts);

  const codigo = Number(extraer(respuesta, "statusCode") ?? "-1");
  // 98 = en proceso. No es un error: hay que volver a preguntar más tarde.
  if (codigo === 98) return { enProceso: true };

  const base64 = extraer(respuesta, "content");
  if (!base64) {
    throw new ErrorSunat(codigo, extraer(respuesta, "statusMessage") ?? "respuesta sin contenido");
  }
  return leerCdr(new Uint8Array(Buffer.from(base64, "base64")));
}

/**
 * Interpreta el CDR.
 *
 * El código de respuesta decide todo: 0 es aceptado, de 2000 en adelante es
 * rechazo definitivo y de 4000 en adelante es aceptación con observaciones. El
 * ZIP se devuelve intacto porque es el documento que hay que conservar, no el
 * texto que se extrajo de él.
 */
export function leerCdr(cdrZip: Uint8Array): RespuestaCdr {
  const archivo = desempaquetar(cdrZip);
  if (!archivo) throw new ErrorSunat(-1, "el CDR llegó vacío o ilegible");

  const doc = new DOMParser().parseFromString(archivo.contenido, "text/xml");
  const texto = (tag: string): string =>
    doc.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() ?? "";

  const codigo = Number(texto("ResponseCode"));
  const descripcion = texto("Description");

  const observaciones: string[] = [];
  const notas = doc.getElementsByTagNameNS("*", "Note");
  for (let i = 0; i < notas.length; i++) {
    const t = notas[i]?.textContent?.trim();
    if (t) observaciones.push(t);
  }

  const estado = interpretarRespuesta(codigo);
  if (estado === "rechazado") {
    throw new ErrorSunat(codigo, descripcion || `SUNAT rechazó el comprobante (código ${codigo})`);
  }

  return { estado, codigo, descripcion, observaciones, cdrZip, cdrXml: archivo.contenido };
}

async function llamar(
  cred: Credenciales,
  operacion: string,
  cuerpo: string,
  opts: OpcionesEnvio,
): Promise<string> {
  const endpoint = opts.endpoint ?? ENDPOINT_BETA;
  const hacerFetch = opts.fetchImpl ?? fetch;
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), opts.timeoutMs ?? 60_000);

  try {
    const respuesta = await hacerFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `urn:${operacion}`,
      },
      body: sobreSoap(cred, cuerpo),
      signal: control.signal,
    });

    const texto = await respuesta.text();
    if (!respuesta.ok && !texto.includes("Fault")) {
      throw new ErrorSunat(
        respuesta.status,
        `el servicio de SUNAT respondió ${respuesta.status}`,
        respuesta.status >= 500,
      );
    }
    return texto;
  } catch (e) {
    if (e instanceof ErrorSunat) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      // Un tiempo agotado no significa que el comprobante no llegara: puede
      // haberse procesado. Quien llame debe consultar antes de reenviar, o
      // duplicará el comprobante.
      throw new ErrorSunat(408, "SUNAT no respondió a tiempo; consulte antes de reenviar", true);
    }
    throw new ErrorSunat(0, `no se pudo contactar con SUNAT: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Saca el contenido de un elemento del sobre SOAP, sin importar su prefijo. */
function extraer(soap: string, tag: string): string | null {
  const doc = new DOMParser().parseFromString(soap, "text/xml");
  return doc.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() ?? null;
}

/**
 * Lee un `soap:Fault`.
 *
 * SUNAT devuelve el código de error en `faultcode` con el formato
 * `soap-env:Client.NNNN`, y el mensaje legible en `faultstring`.
 */
function extraerFault(soap: string): { codigo: number; mensaje: string } {
  const codigo = extraer(soap, "faultcode") ?? "";
  const mensaje = extraer(soap, "faultstring") ?? "SUNAT devolvió un error sin descripción";
  const numero = Number(codigo.match(/(\d{3,4})/)?.[1] ?? "0");
  return { codigo: numero, mensaje };
}
