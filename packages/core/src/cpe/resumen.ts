/**
 * Resumen diario de boletas y comunicación de baja.
 *
 * Son los dos documentos que no viajan por `sendBill` sino por `sendSummary`:
 * SUNAT los procesa en diferido, devuelve un ticket y el CDR se recoge después.
 * Uno y otro existen por razones distintas:
 *
 * - **El resumen diario (RC)** informa las boletas del día. Una boleta no se
 *   envía de una en una: se agrupan todas las del mismo día en un solo
 *   documento, que además es donde se declara si alguna se anuló.
 *
 * - **La comunicación de baja (RA)** anula facturas ya aceptadas. Una factura
 *   no se borra ni se corrige: se da de baja, y a partir de ahí no existe para
 *   SUNAT. Las boletas no van por aquí —se anulan dentro de su resumen—, que es
 *   el error más repetido con estos dos documentos.
 *
 * Ambos son UBL 2.0, no 2.1 como la factura, y ambos van firmados igual.
 */
import { esc, el, extensiones, firmante, i2, type Emisor } from "./ubl.ts";
import type { Dec } from "../money.ts";

const NS = {
  resumen: "urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1",
  baja: "urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sac: "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

/** Estado de un comprobante dentro del resumen diario (catálogo 19). */
export const ESTADO_RESUMEN = {
  ADICIONAR: "1",
  MODIFICAR: "2",
  ANULAR: "3",
} as const;

export type ItemResumen = {
  tipoDocumento: string;
  serie: string;
  /** Correlativo inicial del rango. Con `numeroFinal` informa un tramo. */
  numero: string;
  numeroFinal?: string;
  /** "1" adicionar, "2" modificar, "3" anular. */
  estado: string;
  receptor?: { tipoDocumento: string; numeroDocumento: string };
  moneda: string;
  total: Dec;
  gravadas: Dec;
  exoneradas: Dec;
  inafectas: Dec;
  exportacion: Dec;
  gratuitas: Dec;
  isc: Dec;
  igv: Dec;
  otrosCargos: Dec;
  /** Sólo en notas: el comprobante que modifican. */
  documentoModificado?: { tipoDocumento: string; serie: string; numero: string };
};

export type ResumenDiario = {
  emisor: Emisor;
  /** Día al que corresponden las boletas, AAAA-MM-DD. */
  fechaReferencia: string;
  /** Día en que se envía el resumen. Nunca anterior al de referencia. */
  fechaEmision: string;
  /** Correlativo del resumen dentro del día, empezando en 1. */
  correlativo: number;
  items: ItemResumen[];
};

export type ItemBaja = {
  tipoDocumento: string;
  serie: string;
  numero: string;
  motivo: string;
};

export type ComunicacionBaja = {
  emisor: Emisor;
  /** Día en que se emitieron los comprobantes que se dan de baja. */
  fechaReferencia: string;
  fechaEmision: string;
  correlativo: number;
  items: ItemBaja[];
};

/**
 * Identificador del documento, que es también el nombre del archivo.
 *
 * `RC-AAAAMMDD-N` para el resumen y `RA-AAAAMMDD-N` para la baja. La fecha es
 * la de emisión del resumen, no la de los comprobantes que contiene.
 */
export const idResumen = (prefijo: "RC" | "RA", fechaEmision: string, correlativo: number): string =>
  `${prefijo}-${fechaEmision.replace(/-/g, "")}-${correlativo}`;

export const nombreResumen = (ruc: string, id: string): string => `${ruc}-${id}`;

/** Construye el XML del resumen diario de boletas. */
export function construirResumenDiario(r: ResumenDiario): string {
  if (r.items.length === 0) {
    throw new Error("un resumen diario sin boletas no tiene nada que informar");
  }
  if (r.fechaEmision < r.fechaReferencia) {
    // SUNAT lo rechaza, y con razón: no se resume un día que aún no ha pasado.
    throw new Error("la fecha del resumen no puede ser anterior a la de las boletas");
  }

  const id = idResumen("RC", r.fechaEmision, r.correlativo);

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<SummaryDocuments xmlns="${NS.resumen}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.0"),
    el("cbc:CustomizationID", "1.1"),
    el("cbc:ID", id),
    // La fecha de referencia es la del día resumido; la de emisión, la del envío.
    el("cbc:ReferenceDate", r.fechaReferencia),
    el("cbc:IssueDate", r.fechaEmision),
    firmante(r.emisor),
    parteEmisorResumen(r.emisor),
    ...r.items.map((it, i) => lineaResumen(it, i + 1)),
    "</SummaryDocuments>",
  ].join("");
}

function lineaResumen(it: ItemResumen, numero: number): string {
  const moneda = ` currencyID="${esc(it.moneda)}"`;
  const identificador = it.numeroFinal
    ? `${it.serie}-${it.numero}-${it.numeroFinal}`
    : `${it.serie}-${it.numero}`;

  const partes = [
    "<sac:SummaryDocumentsLine>",
    el("cbc:LineID", numero),
    el("cbc:DocumentTypeCode", it.tipoDocumento),
    el("cbc:ID", identificador),
  ];

  if (it.receptor) {
    partes.push(
      "<cac:AccountingCustomerParty>",
      el("cbc:CustomerAssignedAccountID", it.receptor.numeroDocumento),
      el("cbc:AdditionalAccountID", it.receptor.tipoDocumento),
      "</cac:AccountingCustomerParty>",
    );
  }

  if (it.documentoModificado) {
    const m = it.documentoModificado;
    partes.push(
      "<cac:BillingReference>",
      "<cac:InvoiceDocumentReference>",
      el("cbc:ID", `${m.serie}-${m.numero}`),
      el("cbc:DocumentTypeCode", m.tipoDocumento),
      "</cac:InvoiceDocumentReference>",
      "</cac:BillingReference>",
    );
  }

  partes.push(
    "<cac:Status>",
    el("cbc:ConditionCode", it.estado),
    "</cac:Status>",
    // El total del comprobante va antes que los desgloses, y con el
    // `TotalAmount` del elemento sac, no con el `PayableAmount` de la factura.
    el("sac:TotalAmount", i2(it.total), moneda),
    ...importeFacturado("01", it.gravadas, it.moneda),
    ...importeFacturado("02", it.exoneradas, it.moneda),
    ...importeFacturado("03", it.inafectas, it.moneda),
    ...importeFacturado("04", it.exportacion, it.moneda),
    ...importeFacturado("05", it.gratuitas, it.moneda),
    ...tributo("1000", "IGV", "VAT", it.igv, it.moneda),
    ...tributo("2000", "ISC", "EXC", it.isc, it.moneda),
    ...tributo("9999", "OTROS", "OTH", it.otrosCargos, it.moneda),
    "</sac:SummaryDocumentsLine>",
  );

  return partes.join("");
}

/**
 * Importe por tipo de operación (catálogo 15).
 *
 * Se omite el bloque cuando el importe es cero: informar un `01` en cero en una
 * boleta exonerada hace que SUNAT observe el resumen.
 */
function importeFacturado(codigo: string, importe: Dec, moneda: string): string[] {
  if (importe === 0n) return [];
  return [
    "<sac:BillingPayment>",
    el("cbc:PaidAmount", i2(importe), ` currencyID="${esc(moneda)}"`),
    el("cbc:InstructionID", codigo),
    "</sac:BillingPayment>",
  ];
}

function tributo(codigo: string, nombre: string, tipo: string, importe: Dec, moneda: string): string[] {
  if (importe === 0n) return [];
  const m = ` currencyID="${esc(moneda)}"`;
  return [
    "<cac:TaxTotal>",
    el("cbc:TaxAmount", i2(importe), m),
    "<cac:TaxSubtotal>",
    el("cbc:TaxAmount", i2(importe), m),
    "<cac:TaxCategory>",
    "<cac:TaxScheme>",
    el("cbc:ID", codigo),
    el("cbc:Name", nombre),
    el("cbc:TaxTypeCode", tipo),
    "</cac:TaxScheme>",
    "</cac:TaxCategory>",
    "</cac:TaxSubtotal>",
    "</cac:TaxTotal>",
  ];
}

/** Construye el XML de la comunicación de baja. */
export function construirComunicacionBaja(b: ComunicacionBaja): string {
  if (b.items.length === 0) {
    throw new Error("una comunicación de baja sin comprobantes no tiene nada que anular");
  }
  const id = idResumen("RA", b.fechaEmision, b.correlativo);

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<VoidedDocuments xmlns="${NS.baja}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.0"),
    el("cbc:CustomizationID", "1.0"),
    el("cbc:ID", id),
    el("cbc:ReferenceDate", b.fechaReferencia),
    el("cbc:IssueDate", b.fechaEmision),
    firmante(b.emisor),
    parteEmisorResumen(b.emisor),
    ...b.items.map((it, i) =>
      [
        "<sac:VoidedDocumentsLine>",
        el("cbc:LineID", i + 1),
        el("cbc:DocumentTypeCode", it.tipoDocumento),
        el("sac:DocumentSerialID", it.serie),
        el("sac:DocumentNumberID", it.numero),
        // El motivo es obligatorio y lo lee una persona en SUNAT: "error en el
        // RUC" sirve, "anulación" no dice nada.
        el("sac:VoidReasonDescription", it.motivo),
        "</sac:VoidedDocumentsLine>",
      ].join(""),
    ),
    "</VoidedDocuments>",
  ].join("");
}

/**
 * Emisor del resumen.
 *
 * Es más escueto que el de la factura: SUNAT sólo pide el RUC y el nombre,
 * porque el resto ya lo tiene del padrón.
 */
function parteEmisorResumen(e: Emisor): string {
  return [
    "<cac:AccountingSupplierParty>",
    el("cbc:CustomerAssignedAccountID", e.ruc),
    el("cbc:AdditionalAccountID", "6"),
    "<cac:Party>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", e.razonSocial),
    "</cac:PartyLegalEntity>",
    "</cac:Party>",
    "</cac:AccountingSupplierParty>",
  ].join("");
}
