/**
 * Generación del XML UBL 2.1 para SUNAT.
 *
 * UBL es un estándar de OASIS y SUNAT lo usa con su propio perfil: espacios de
 * nombres fijos, elementos obligatorios que el estándar deja opcionales, y un
 * puñado de extensiones propias. El XML se construye a mano y no con una
 * plantilla porque el orden de los elementos importa —el XSD es una secuencia,
 * no un conjunto— y una plantilla invita a moverlos sin darse cuenta.
 *
 * Dos reglas que gobiernan todo el archivo:
 *
 * 1. **Los importes van como texto, ya redondeados.** Vienen de `money.ts`,
 *    donde son exactos, y se escriben tal cual. Convertirlos a `number` para
 *    formatearlos reintroduce el error que todo el sistema evita.
 *
 * 2. **Cada línea declara su tributo según su afectación.** Una línea exonerada
 *    con el código del IGV, o una gratuita sin el 9996, hace que SUNAT rechace
 *    el comprobante entero con un mensaje que no dice qué línea falló.
 */
import { type Dec, dec, add, mul, toString as dtoa, ZERO, gt } from "../money.ts";
import {
  TIPO_DOCUMENTO, TRIBUTOS, tributoDeAfectacion, codigoPrecio,
  type TipoDocumento,
} from "./catalogos.ts";

export type Emisor = {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string;
  /** Ubigeo de seis dígitos del domicilio fiscal. */
  ubigeo?: string;
  direccion?: string;
  distrito?: string;
  provincia?: string;
  departamento?: string;
  /** Código del establecimiento anexo. "0000" es el domicilio fiscal. */
  codigoAnexo?: string;
};

export type Receptor = {
  /** Catálogo 06. */
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  direccion?: string;
};

export type LineaCpe = {
  /** Número de orden, empezando en 1. */
  numero: number;
  codigo: string;
  descripcion: string;
  /** Código de la unidad de medida, catálogo 03. */
  unidad: string;
  cantidad: Dec;
  /** Valor unitario sin impuestos. */
  valorUnitario: Dec;
  /** Precio unitario con impuestos. En gratuitas, el precio referencial. */
  precioUnitario: Dec;
  /** Catálogo 07. */
  afectacion: string;
  valorVenta: Dec;
  igv: Dec;
  /** Tasa aplicada, como fracción: 0.18. */
  tasaIgv: Dec;
  descuento?: Dec;
  codigoSunat?: string;
};

export type Detraccion = {
  /** Catálogo 54. */
  codigo: string;
  /** Cuenta del Banco de la Nación del proveedor. */
  cuenta: string;
  porcentaje: Dec;
  monto: Dec;
};

export type ComprobanteCpe = {
  tipoDocumento: TipoDocumento;
  serie: string;
  numero: string;
  /** AAAA-MM-DD */
  fechaEmision: string;
  /** HH:MM:SS */
  horaEmision?: string;
  fechaVencimiento?: string;
  moneda: string;
  emisor: Emisor;
  receptor: Receptor;
  lineas: LineaCpe[];

  gravadas: Dec;
  exoneradas: Dec;
  inafectas: Dec;
  exportacion: Dec;
  gratuitas: Dec;
  igv: Dec;
  isc?: Dec;
  otrosCargos?: Dec;
  descuentoGlobal?: Dec;
  total: Dec;

  /** Catálogo 51. */
  tipoOperacion?: string;
  /** Texto del importe en letras, obligatorio en la representación impresa. */
  totalEnLetras?: string;
  detraccion?: Detraccion;
  observaciones?: string;

  /** Sólo en notas de crédito y débito. */
  notaModificada?: {
    tipoDocumento: string;
    serie: string;
    numero: string;
    /** Catálogo 09 o 10 según el tipo de nota. */
    motivo: string;
    descripcionMotivo: string;
  };
};

const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  creditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  debitNote: "urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

/**
 * Escapa el texto para XML.
 *
 * Una razón social con `&` o `<` —«MARTÍNEZ & HIJOS S.A.»— produce un XML
 * malformado que SUNAT rechaza antes de validar nada. Se escapan también las
 * comillas porque el mismo helper se usa para atributos.
 */
export function esc(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** SUNAT quiere las tasas como porcentaje (18.00), no como fracción (0.18). */
const CIEN = dec("100");
const porcentaje = (fraccion: Dec): string => dtoa(mul(fraccion, CIEN), 2);

/** Importe con dos decimales, que es lo que SUNAT espera en los totales. */
const i2 = (v: Dec): string => dtoa(v, 2);
/** Valores unitarios: hasta diez decimales admite SUNAT; se usan seis. */
const i6 = (v: Dec): string => dtoa(v, 6);

const el = (nombre: string, valor: string | number, attrs = ""): string =>
  `<${nombre}${attrs}>${esc(valor)}</${nombre}>`;

/** El nodo de extensión donde después se inserta la firma. */
const extensiones = (): string =>
  `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;

function firmante(emisor: Emisor): string {
  return [
    "<cac:Signature>",
    el("cbc:ID", `${emisor.ruc}`),
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

function parteEmisor(e: Emisor): string {
  return [
    "<cac:AccountingSupplierParty>",
    "<cac:Party>",
    "<cac:PartyIdentification>",
    el("cbc:ID", e.ruc, ' schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06"'),
    "</cac:PartyIdentification>",
    "<cac:PartyName>",
    el("cbc:Name", e.nombreComercial ?? e.razonSocial),
    "</cac:PartyName>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", e.razonSocial),
    "<cac:RegistrationAddress>",
    el("cbc:ID", e.ubigeo ?? "150101"),
    el("cbc:AddressTypeCode", e.codigoAnexo ?? "0000"),
    el("cbc:CityName", e.provincia ?? ""),
    el("cbc:CountrySubentity", e.departamento ?? ""),
    el("cbc:District", e.distrito ?? ""),
    "<cac:AddressLine>",
    el("cbc:Line", e.direccion ?? "-"),
    "</cac:AddressLine>",
    "<cac:Country>",
    el("cbc:IdentificationCode", "PE"),
    "</cac:Country>",
    "</cac:RegistrationAddress>",
    "</cac:PartyLegalEntity>",
    "</cac:Party>",
    "</cac:AccountingSupplierParty>",
  ].join("");
}

function parteReceptor(r: Receptor): string {
  return [
    "<cac:AccountingCustomerParty>",
    "<cac:Party>",
    "<cac:PartyIdentification>",
    el("cbc:ID", r.numeroDocumento, ` schemeID="${esc(r.tipoDocumento)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06"`),
    "</cac:PartyIdentification>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", r.razonSocial),
    ...(r.direccion
      ? [
          "<cac:RegistrationAddress>",
          "<cac:AddressLine>",
          el("cbc:Line", r.direccion),
          "</cac:AddressLine>",
          "</cac:RegistrationAddress>",
        ]
      : []),
    "</cac:PartyLegalEntity>",
    "</cac:Party>",
    "</cac:AccountingCustomerParty>",
  ].join("");
}

/**
 * Totales por tipo de operación.
 *
 * Sólo se emiten los que tienen importe: SUNAT rechaza un `TaxSubtotal` en cero
 * para una categoría que la factura no usa.
 */
function totalesImpuestos(c: ComprobanteCpe): string {
  const partes: string[] = [];
  const moneda = ` currencyID="${esc(c.moneda)}"`;

  const subtotal = (base: Dec, monto: Dec, t: { codigo: string; nombre: string; tipo: string }) =>
    [
      "<cac:TaxSubtotal>",
      el("cbc:TaxableAmount", i2(base), moneda),
      el("cbc:TaxAmount", i2(monto), moneda),
      "<cac:TaxCategory>",
      "<cac:TaxScheme>",
      el("cbc:ID", t.codigo),
      el("cbc:Name", t.nombre),
      el("cbc:TaxTypeCode", t.tipo),
      "</cac:TaxScheme>",
      "</cac:TaxCategory>",
      "</cac:TaxSubtotal>",
    ].join("");

  if (gt(c.gravadas, ZERO) || gt(c.igv, ZERO)) {
    partes.push(subtotal(c.gravadas, c.igv, TRIBUTOS.IGV));
  }
  if (gt(c.exoneradas, ZERO)) partes.push(subtotal(c.exoneradas, ZERO, TRIBUTOS.EXONERADO));
  if (gt(c.inafectas, ZERO)) partes.push(subtotal(c.inafectas, ZERO, TRIBUTOS.INAFECTO));
  if (gt(c.exportacion, ZERO)) partes.push(subtotal(c.exportacion, ZERO, TRIBUTOS.EXPORTACION));
  if (gt(c.gratuitas, ZERO)) partes.push(subtotal(c.gratuitas, ZERO, TRIBUTOS.GRATUITO));

  const totalImpuestos = add(c.igv, c.isc ?? ZERO);
  return [
    "<cac:TaxTotal>",
    el("cbc:TaxAmount", i2(totalImpuestos), moneda),
    ...partes,
    "</cac:TaxTotal>",
  ].join("");
}

function lineaXml(c: ComprobanteCpe, l: LineaCpe, etiqueta: string): string {
  const moneda = ` currencyID="${esc(c.moneda)}"`;
  const tributo = tributoDeAfectacion(l.afectacion);
  const gratuita = tributo.codigo === TRIBUTOS.GRATUITO.codigo;

  return [
    `<${etiqueta}>`,
    el("cbc:ID", l.numero),
    el(
      etiqueta === "cac:InvoiceLine" ? "cbc:InvoicedQuantity" : "cbc:CreditedQuantity",
      i6(l.cantidad),
      ` unitCode="${esc(l.unidad)}" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe"`,
    ),
    // En una gratuita el valor de venta es cero: no se cobra nada, aunque el
    // IGV que habría correspondido sí se informa más abajo.
    el("cbc:LineExtensionAmount", i2(gratuita ? ZERO : l.valorVenta), moneda),
    "<cac:PricingReference>",
    "<cac:AlternativeConditionPrice>",
    el("cbc:PriceAmount", i6(l.precioUnitario), moneda),
    el("cbc:PriceTypeCode", codigoPrecio(gratuita)),
    "</cac:AlternativeConditionPrice>",
    "</cac:PricingReference>",
    "<cac:TaxTotal>",
    el("cbc:TaxAmount", i2(l.igv), moneda),
    "<cac:TaxSubtotal>",
    el("cbc:TaxableAmount", i2(l.valorVenta), moneda),
    el("cbc:TaxAmount", i2(l.igv), moneda),
    "<cac:TaxCategory>",
    el("cbc:Percent", porcentaje(l.tasaIgv)),
    el("cbc:TaxExemptionReasonCode", l.afectacion),
    "<cac:TaxScheme>",
    el("cbc:ID", tributo.codigo),
    el("cbc:Name", tributo.nombre),
    el("cbc:TaxTypeCode", tributo.tipo),
    "</cac:TaxScheme>",
    "</cac:TaxCategory>",
    "</cac:TaxSubtotal>",
    "</cac:TaxTotal>",
    "<cac:Item>",
    el("cbc:Description", l.descripcion),
    "<cac:SellersItemIdentification>",
    el("cbc:ID", l.codigo),
    "</cac:SellersItemIdentification>",
    ...(l.codigoSunat
      ? [
          "<cac:CommodityClassification>",
          el("cbc:ItemClassificationCode", l.codigoSunat, ' listID="UNSPSC" listAgencyName="GS1 US" listName="Item Classification"'),
          "</cac:CommodityClassification>",
        ]
      : []),
    "</cac:Item>",
    "<cac:Price>",
    el("cbc:PriceAmount", i6(gratuita ? ZERO : l.valorUnitario), moneda),
    "</cac:Price>",
    `</${etiqueta}>`,
  ].join("");
}

function detraccionXml(c: ComprobanteCpe): string {
  if (!c.detraccion) return "";
  const moneda = ` currencyID="${esc(c.moneda)}"`;
  return [
    "<cac:PaymentMeans>",
    el("cbc:ID", "Detraccion"),
    el("cbc:PaymentMeansCode", "001"),
    "<cac:PayeeFinancialAccount>",
    el("cbc:ID", c.detraccion.cuenta),
    "</cac:PayeeFinancialAccount>",
    "</cac:PaymentMeans>",
    "<cac:PaymentTerms>",
    el("cbc:ID", "Detraccion"),
    el("cbc:PaymentMeansID", c.detraccion.codigo),
    el("cbc:PaymentPercent", porcentaje(c.detraccion.porcentaje)),
    el("cbc:Amount", i2(c.detraccion.monto), moneda),
    "</cac:PaymentTerms>",
  ].join("");
}

/**
 * Construye el XML de una factura o boleta.
 *
 * El resultado no está firmado: lleva el nodo `ExtensionContent` vacío donde
 * después se inserta la firma. Separar ambos pasos permite probar la estructura
 * sin necesitar un certificado.
 */
export function construirFactura(c: ComprobanteCpe): string {
  const moneda = ` currencyID="${esc(c.moneda)}"`;
  const id = `${c.serie}-${c.numero}`;

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.1"),
    el("cbc:CustomizationID", "2.0"),
    el("cbc:ID", id),
    el("cbc:IssueDate", c.fechaEmision),
    el("cbc:IssueTime", c.horaEmision ?? "00:00:00"),
    ...(c.fechaVencimiento ? [el("cbc:DueDate", c.fechaVencimiento)] : []),
    el("cbc:InvoiceTypeCode", c.tipoDocumento, ' listID="' + esc(c.tipoOperacion ?? "0101") + '" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01"'),
    ...(c.totalEnLetras ? [el("cbc:Note", c.totalEnLetras, ' languageLocaleID="1000"')] : []),
    ...(c.observaciones ? [el("cbc:Note", c.observaciones, ' languageLocaleID="2006"')] : []),
    el("cbc:DocumentCurrencyCode", c.moneda, ' listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe"'),
    firmante(c.emisor),
    parteEmisor(c.emisor),
    parteReceptor(c.receptor),
    detraccionXml(c),
    totalesImpuestos(c),
    "<cac:LegalMonetaryTotal>",
    el("cbc:LineExtensionAmount", i2(sumaValorVenta(c)), moneda),
    el("cbc:TaxInclusiveAmount", i2(c.total), moneda),
    ...(c.descuentoGlobal && gt(c.descuentoGlobal, ZERO)
      ? [el("cbc:AllowanceTotalAmount", i2(c.descuentoGlobal), moneda)]
      : []),
    ...(c.otrosCargos && gt(c.otrosCargos, ZERO)
      ? [el("cbc:ChargeTotalAmount", i2(c.otrosCargos), moneda)]
      : []),
    el("cbc:PayableAmount", i2(c.total), moneda),
    "</cac:LegalMonetaryTotal>",
    ...c.lineas.map((l) => lineaXml(c, l, "cac:InvoiceLine")),
    "</Invoice>",
  ].join("");
}

/** Construye el XML de una nota de crédito. */
export function construirNotaCredito(c: ComprobanteCpe): string {
  if (!c.notaModificada) {
    throw new Error("una nota de crédito debe indicar el comprobante que modifica");
  }
  const moneda = ` currencyID="${esc(c.moneda)}"`;
  const id = `${c.serie}-${c.numero}`;
  const m = c.notaModificada;

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<CreditNote xmlns="${NS.creditNote}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.1"),
    el("cbc:CustomizationID", "2.0"),
    el("cbc:ID", id),
    el("cbc:IssueDate", c.fechaEmision),
    el("cbc:IssueTime", c.horaEmision ?? "00:00:00"),
    ...(c.totalEnLetras ? [el("cbc:Note", c.totalEnLetras, ' languageLocaleID="1000"')] : []),
    el("cbc:DocumentCurrencyCode", c.moneda),
    "<cac:DiscrepancyResponse>",
    el("cbc:ReferenceID", `${m.serie}-${m.numero}`),
    el("cbc:ResponseCode", m.motivo),
    el("cbc:Description", m.descripcionMotivo),
    "</cac:DiscrepancyResponse>",
    "<cac:BillingReference>",
    "<cac:InvoiceDocumentReference>",
    el("cbc:ID", `${m.serie}-${m.numero}`),
    el("cbc:DocumentTypeCode", m.tipoDocumento),
    "</cac:InvoiceDocumentReference>",
    "</cac:BillingReference>",
    firmante(c.emisor),
    parteEmisor(c.emisor),
    parteReceptor(c.receptor),
    totalesImpuestos(c),
    "<cac:LegalMonetaryTotal>",
    el("cbc:LineExtensionAmount", i2(sumaValorVenta(c)), moneda),
    el("cbc:TaxInclusiveAmount", i2(c.total), moneda),
    el("cbc:PayableAmount", i2(c.total), moneda),
    "</cac:LegalMonetaryTotal>",
    ...c.lineas.map((l) => lineaXml(c, l, "cac:CreditNoteLine")),
    "</CreditNote>",
  ].join("");
}

const sumaValorVenta = (c: ComprobanteCpe): Dec =>
  add(add(c.gravadas, c.exoneradas), add(c.inafectas, c.exportacion));

/**
 * Elige el constructor según el tipo de documento.
 *
 * Las boletas usan la misma estructura `Invoice` que las facturas; sólo cambia
 * el `InvoiceTypeCode` y las reglas de identificación del receptor.
 */
export function construirXml(c: ComprobanteCpe): string {
  switch (c.tipoDocumento) {
    case TIPO_DOCUMENTO.FACTURA:
    case TIPO_DOCUMENTO.BOLETA:
      return construirFactura(c);
    case TIPO_DOCUMENTO.NOTA_CREDITO:
      return construirNotaCredito(c);
    default:
      throw new Error(`tipo de comprobante no soportado todavía: ${c.tipoDocumento}`);
  }
}

/**
 * Nombre del archivo del comprobante, tal como lo exige SUNAT.
 *
 * `RUC-TIPO-SERIE-NUMERO`. Es el nombre del XML, del ZIP que lo envuelve y del
 * CDR que devuelve SUNAT, así que un error aquí rompe los tres.
 */
export const nombreCpe = (ruc: string, tipo: string, serie: string, numero: string): string =>
  `${ruc}-${tipo}-${serie}-${numero}`;

export { TIPO_DOCUMENTO };
