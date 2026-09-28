/**
 * Comprobantes de retención y de percepción.
 *
 * Son documentos electrónicos como la factura —van por `sendBill` y llevan la
 * misma firma— pero describen un flujo de impuesto, no una venta:
 *
 * - **La retención** la practica el agente de retención al *pagar* a su
 *   proveedor: le entrega menos y le da este comprobante por la diferencia.
 * - **La percepción** la cobra el agente de percepción al *vender*: cobra de
 *   más y entrega este comprobante por el exceso.
 *
 * Los dos XML son casi idénticos salvo por los nombres de sus elementos, y hay
 * un detalle que los distingue de la factura y que rompe la validación si se
 * copia el orden de aquélla: aquí `cac:Signature` va **antes** de `cbc:ID`.
 *
 * Los importes retenido y percibido van siempre en soles, aunque la operación
 * que los origina esté en dólares: por eso el tipo de cambio viaja dentro de
 * cada referencia.
 */
import { esc, el, extensiones, i2, type Emisor } from "./ubl.ts";
import type { Dec } from "../money.ts";
import { toString as dtoa } from "../money.ts";

const NS = {
  retencion: "urn:sunat:names:specification:ubl:peru:schema:xsd:Retention-1",
  percepcion: "urn:sunat:names:specification:ubl:peru:schema:xsd:Perception-1",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sac: "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

/** Catálogo 23: régimen de retención. */
export const REGIMEN_RETENCION = {
  TASA_3: "01",
  TASA_6: "02",
} as const;

/** Catálogo 22: régimen de percepción. */
export const REGIMEN_PERCEPCION = {
  VENTA_INTERNA: "01",
  COMBUSTIBLE: "02",
  AGENTE_A_AGENTE: "03",
} as const;

export type PagoReferencia = {
  importe: Dec;
  moneda: string;
  fecha: string;
};

export type DocumentoAfectado = {
  /** Catálogo 01: tipo del documento sobre el que se retiene o percibe. */
  tipoDocumento: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  moneda: string;
  total: Dec;
  /** Importe retenido o percibido, siempre en soles. */
  importe: Dec;
  fecha: string;
  /** Neto pagado o cobrado tras aplicar el importe, en soles. */
  neto: Dec;
  pagos: PagoReferencia[];
  /** Obligatorio cuando el documento no está en soles. */
  tipoCambio?: { monedaOrigen: string; monedaDestino: string; factor: Dec; fecha: string };
};

export type ComprobanteRetencion = {
  serie: string;
  numero: string;
  fechaEmision: string;
  horaEmision?: string;
  emisor: Emisor;
  /** El proveedor en la retención, el cliente en la percepción. */
  contraparte: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  /** Catálogo 23 o 22 según el documento. */
  regimen: string;
  /** Tasa como fracción: 0.03 se emite como 3.00. */
  tasa: Dec;
  /** Total retenido o percibido, en soles. */
  importeTotal: Dec;
  /** Total pagado o cobrado, en soles. */
  importeOperacion: Dec;
  observacion?: string;
  documentos: DocumentoAfectado[];
};

const CIEN = 100n * 1_000_000n;

/** SUNAT quiere la tasa como porcentaje: 3.00, no 0.03. */
const porcentaje = (fraccion: Dec): string =>
  dtoa(((fraccion * CIEN) / 1_000_000n) as Dec, 2);

export function validarRetencion(c: ComprobanteRetencion): string[] {
  const motivos: string[] = [];
  if (c.documentos.length === 0) {
    motivos.push("el comprobante debe referirse a al menos un documento");
  }
  const suma = c.documentos.reduce<bigint>((a, d) => a + d.importe, 0n);
  if (suma !== c.importeTotal) {
    motivos.push("el total del comprobante no coincide con la suma de sus documentos");
  }
  for (const d of c.documentos) {
    if (d.moneda !== "PEN" && !d.tipoCambio) {
      motivos.push(
        `${d.serie}-${d.numero}: un documento en ${d.moneda} necesita el tipo de cambio, porque el importe se declara en soles`,
      );
    }
  }
  return motivos;
}

/** Construye el XML del comprobante de retención (tipo 20). */
export const construirRetencion = (c: ComprobanteRetencion): string =>
  construir(c, {
    raiz: "Retention",
    ns: NS.retencion,
    codigoSistema: "sac:SUNATRetentionSystemCode",
    porcentaje: "sac:SUNATRetentionPercent",
    totalOperacion: "sac:SUNATTotalPaid",
    referencia: "sac:SUNATRetentionDocumentReference",
    informacion: "sac:SUNATRetentionInformation",
    importe: "sac:SUNATRetentionAmount",
    fecha: "sac:SUNATRetentionDate",
    neto: "sac:SUNATNetTotalPaid",
  });

/** Construye el XML del comprobante de percepción (tipo 40). */
export const construirPercepcion = (c: ComprobanteRetencion): string =>
  construir(c, {
    raiz: "Perception",
    ns: NS.percepcion,
    codigoSistema: "sac:SUNATPerceptionSystemCode",
    porcentaje: "sac:SUNATPerceptionPercent",
    totalOperacion: "sac:SUNATTotalCashed",
    referencia: "sac:SUNATPerceptionDocumentReference",
    informacion: "sac:SUNATPerceptionInformation",
    importe: "sac:SUNATPerceptionAmount",
    fecha: "sac:SUNATPerceptionDate",
    neto: "sac:SUNATNetTotalCashed",
  });

type Etiquetas = {
  raiz: string;
  ns: string;
  codigoSistema: string;
  porcentaje: string;
  totalOperacion: string;
  referencia: string;
  informacion: string;
  importe: string;
  fecha: string;
  neto: string;
};

function construir(c: ComprobanteRetencion, e: Etiquetas): string {
  const motivos = validarRetencion(c);
  if (motivos.length > 0) throw new Error(motivos.join("; "));

  const soles = ' currencyID="PEN"';

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<${e.raiz} xmlns="${e.ns}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.0"),
    el("cbc:CustomizationID", "1.0"),
    // A diferencia de la factura, la firma va antes del identificador. El orden
    // de los elementos es parte del esquema: cambiarlo invalida el documento.
    firmanteRetencion(c.emisor),
    el("cbc:ID", `${c.serie}-${c.numero}`),
    el("cbc:IssueDate", c.fechaEmision),
    el("cbc:IssueTime", c.horaEmision ?? "00:00:00"),
    agente(c.emisor),
    "<cac:ReceiverParty>",
    "<cac:PartyIdentification>",
    el("cbc:ID", c.contraparte.numeroDocumento, ` schemeID="${esc(c.contraparte.tipoDocumento)}"`),
    "</cac:PartyIdentification>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", c.contraparte.razonSocial),
    "</cac:PartyLegalEntity>",
    "</cac:ReceiverParty>",
    el(e.codigoSistema, c.regimen),
    el(e.porcentaje, porcentaje(c.tasa)),
    ...(c.observacion ? [el("cbc:Note", c.observacion)] : []),
    el("cbc:TotalInvoiceAmount", i2(c.importeTotal), soles),
    el(e.totalOperacion, i2(c.importeOperacion), soles),
    ...c.documentos.map((d) => referencia(d, e)),
    `</${e.raiz}>`,
  ].join("");
}

function referencia(d: DocumentoAfectado, e: Etiquetas): string {
  const soles = ' currencyID="PEN"';
  return [
    `<${e.referencia}>`,
    el("cbc:ID", `${d.serie}-${d.numero}`, ` schemeID="${esc(d.tipoDocumento)}"`),
    el("cbc:IssueDate", d.fechaEmision),
    el("cbc:TotalInvoiceAmount", i2(d.total), ` currencyID="${esc(d.moneda)}"`),
    ...d.pagos.flatMap((p, i) => [
      "<cac:Payment>",
      el("cbc:ID", i + 1),
      el("cbc:PaidAmount", i2(p.importe), ` currencyID="${esc(p.moneda)}"`),
      el("cbc:PaidDate", p.fecha),
      "</cac:Payment>",
    ]),
    `<${e.informacion}>`,
    el(e.importe, i2(d.importe), soles),
    el(e.fecha, d.fecha),
    el(e.neto, i2(d.neto), soles),
    ...(d.tipoCambio
      ? [
          "<cac:ExchangeRate>",
          el("cbc:SourceCurrencyCode", d.tipoCambio.monedaOrigen),
          el("cbc:TargetCurrencyCode", d.tipoCambio.monedaDestino),
          el("cbc:CalculationRate", dtoa(d.tipoCambio.factor, 3)),
          el("cbc:Date", d.tipoCambio.fecha),
          "</cac:ExchangeRate>",
        ]
      : []),
    `</${e.informacion}>`,
    `</${e.referencia}>`,
  ].join("");
}

/** El firmante de estos documentos usa `SIGN` + RUC como identificador. */
function firmanteRetencion(emisor: Emisor): string {
  return [
    "<cac:Signature>",
    el("cbc:ID", `SIGN${emisor.ruc}`),
    "<cac:SignatoryParty>",
    "<cac:PartyIdentification>",
    el("cbc:ID", emisor.ruc),
    "</cac:PartyIdentification>",
    "<cac:PartyName>",
    el("cbc:Name", emisor.razonSocial),
    "</cac:PartyName>",
    "</cac:SignatoryParty>",
    "<cac:DigitalSignatureAttachment>",
    "<cac:ExternalReference>",
    el("cbc:URI", `#SIGN-${emisor.ruc}`),
    "</cac:ExternalReference>",
    "</cac:DigitalSignatureAttachment>",
    "</cac:Signature>",
  ].join("");
}

function agente(e: Emisor): string {
  return [
    "<cac:AgentParty>",
    "<cac:PartyIdentification>",
    el("cbc:ID", e.ruc, ' schemeID="6"'),
    "</cac:PartyIdentification>",
    "<cac:PartyName>",
    el("cbc:Name", e.nombreComercial ?? e.razonSocial),
    "</cac:PartyName>",
    "<cac:PostalAddress>",
    el("cbc:ID", e.ubigeo ?? "150101"),
    el("cbc:StreetName", e.direccion ?? "-"),
    "<cac:Country>",
    el("cbc:IdentificationCode", "PE"),
    "</cac:Country>",
    "</cac:PostalAddress>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", e.razonSocial),
    "</cac:PartyLegalEntity>",
    "</cac:AgentParty>",
  ].join("");
}
