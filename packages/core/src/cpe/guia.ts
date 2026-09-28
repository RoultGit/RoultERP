/**
 * Guía de remisión electrónica: el documento.
 *
 * Es un `DespatchAdvice` de UBL 2.1, y a diferencia de la factura no lleva ni
 * importes ni impuestos: describe un traslado. Lo que sustenta es que la
 * mercadería iba de un sitio a otro con un motivo, no cuánto valía.
 *
 * Las dos decisiones que gobiernan el contenido:
 *
 * - **El modo de transporte** decide qué datos son obligatorios. En transporte
 *   público hace falta el RUC del transportista; en privado, la placa del
 *   vehículo y la licencia del conductor. Faltando uno, SUNAT rechaza.
 *
 * - **El motivo del traslado** (catálogo 20) decide si hace falta declarar un
 *   comprobante relacionado. Una venta lo lleva; un traslado entre almacenes
 *   propios, no.
 */
import { esc, el, extensiones, firmante, type Emisor } from "./ubl.ts";
import type { Dec } from "../money.ts";
import { toString as dtoa } from "../money.ts";

const NS = {
  guia: "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
} as const;

/** Catálogo 20: motivo del traslado. */
export const MOTIVO_TRASLADO = {
  VENTA: "01",
  COMPRA: "02",
  VENTA_ENTREGA_A_TERCEROS: "03",
  TRASLADO_ENTRE_ESTABLECIMIENTOS: "04",
  CONSIGNACION: "05",
  DEVOLUCION: "06",
  RECOJO_BIENES_TRANSFORMADOS: "07",
  IMPORTACION: "08",
  EXPORTACION: "09",
  OTROS: "13",
  VENTA_SUJETA_A_CONFIRMACION: "14",
  TRASLADO_EMISOR_ITINERANTE: "18",
  TRASLADO_ZONA_PRIMARIA: "19",
} as const;

/** Catálogo 18: modalidad de transporte. */
export const MODO_TRANSPORTE = {
  PUBLICO: "01",
  PRIVADO: "02",
} as const;

/** Catálogo 21: tipo de la guía. */
export const TIPO_GUIA = {
  REMITENTE: "09",
  TRANSPORTISTA: "31",
} as const;

export type Direccion = {
  /** Ubigeo de seis dígitos. */
  ubigeo: string;
  direccion: string;
  /** Código de establecimiento anexo del RUC, cuando el punto es propio. */
  codigoEstablecimiento?: string;
};

export type Transportista = {
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  /** Registro del MTC, obligatorio para el transporte público de carga. */
  registroMtc?: string;
};

export type Conductor = {
  tipoDocumento: string;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  licencia: string;
};

export type LineaGuia = {
  numero: number;
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: Dec;
};

export type GuiaRemision = {
  serie: string;
  numero: string;
  fechaEmision: string;
  horaEmision?: string;
  /** Catálogo 21. Este módulo emite la del remitente. */
  tipoGuia: string;
  emisor: Emisor;
  destinatario: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
  };
  /** Catálogo 20. */
  motivo: string;
  descripcionMotivo: string;
  /** Peso bruto total del envío, en la unidad indicada. */
  pesoBruto: Dec;
  unidadPeso: string;
  /** Número de bultos. Obligatorio cuando el motivo es importación. */
  bultos?: number;
  modoTransporte: string;
  fechaTraslado: string;
  partida: Direccion;
  llegada: Direccion;
  /** Obligatorio en transporte público. */
  transportista?: Transportista;
  /** Obligatorios en transporte privado. */
  placa?: string;
  conductor?: Conductor;
  /** Comprobante que sustenta el traslado, cuando el motivo lo exige. */
  documentoRelacionado?: { tipoDocumento: string; serie: string; numero: string };
  lineas: LineaGuia[];
  observaciones?: string;
};

/** Nombre del archivo, igual que en la facturación: RUC-TIPO-SERIE-NUMERO. */
export const nombreGuia = (ruc: string, g: { tipoGuia: string; serie: string; numero: string }): string =>
  `${ruc}-${g.tipoGuia}-${g.serie}-${g.numero}`;

/** Comprueba lo que SUNAT exige según la modalidad y el motivo. */
export function validarGuia(g: GuiaRemision): string[] {
  const motivos: string[] = [];

  if (g.lineas.length === 0) motivos.push("la guía necesita al menos un bien que trasladar");
  if (g.pesoBruto <= 0n) motivos.push("el peso bruto debe ser mayor que cero");
  if (!/^\d{6}$/.test(g.partida.ubigeo)) motivos.push("el ubigeo del punto de partida es inválido");
  if (!/^\d{6}$/.test(g.llegada.ubigeo)) motivos.push("el ubigeo del punto de llegada es inválido");
  if (g.fechaTraslado < g.fechaEmision) {
    motivos.push("el traslado no puede empezar antes de emitir la guía");
  }

  if (g.modoTransporte === MODO_TRANSPORTE.PUBLICO) {
    if (!g.transportista) {
      motivos.push("el transporte público exige identificar al transportista");
    }
  } else {
    // En transporte privado el vehículo y el conductor son del remitente, y
    // SUNAT los quiere identificados: son quienes responden en un control.
    if (!g.placa) motivos.push("el transporte privado exige la placa del vehículo");
    if (!g.conductor) motivos.push("el transporte privado exige los datos del conductor");
  }

  if (g.motivo === MOTIVO_TRASLADO.VENTA && !g.documentoRelacionado) {
    motivos.push("un traslado por venta debe indicar el comprobante que lo sustenta");
  }
  if (g.motivo === MOTIVO_TRASLADO.IMPORTACION && !g.bultos) {
    motivos.push("un traslado por importación debe indicar el número de bultos");
  }

  return motivos;
}

export function construirGuia(g: GuiaRemision): string {
  const motivos = validarGuia(g);
  if (motivos.length > 0) throw new Error(motivos.join("; "));

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<DespatchAdvice xmlns="${NS.guia}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:ds="${NS.ds}">`,
    extensiones(),
    el("cbc:UBLVersionID", "2.1"),
    el("cbc:CustomizationID", "2.0"),
    el("cbc:ID", `${g.serie}-${g.numero}`),
    el("cbc:IssueDate", g.fechaEmision),
    el("cbc:IssueTime", g.horaEmision ?? "00:00:00"),
    el("cbc:DespatchAdviceTypeCode", g.tipoGuia),
    ...(g.observaciones ? [el("cbc:Note", g.observaciones)] : []),
    ...(g.documentoRelacionado
      ? [
          "<cac:AdditionalDocumentReference>",
          el("cbc:ID", `${g.documentoRelacionado.serie}-${g.documentoRelacionado.numero}`),
          el("cbc:DocumentTypeCode", g.documentoRelacionado.tipoDocumento),
          "</cac:AdditionalDocumentReference>",
        ]
      : []),
    firmante(g.emisor),
    parte("cac:DespatchSupplierParty", g.emisor.ruc, "6", g.emisor.razonSocial),
    parte(
      "cac:DeliveryCustomerParty",
      g.destinatario.numeroDocumento,
      g.destinatario.tipoDocumento,
      g.destinatario.razonSocial,
    ),
    envio(g),
    ...g.lineas.map((l) => lineaGuia(l)),
    "</DespatchAdvice>",
  ].join("");
}

function parte(etiqueta: string, numero: string, tipo: string, nombre: string): string {
  return [
    `<${etiqueta}>`,
    "<cac:Party>",
    "<cac:PartyIdentification>",
    el("cbc:ID", numero, ` schemeID="${esc(tipo)}"`),
    "</cac:PartyIdentification>",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", nombre),
    "</cac:PartyLegalEntity>",
    "</cac:Party>",
    `</${etiqueta}>`,
  ].join("");
}

function envio(g: GuiaRemision): string {
  const publico = g.modoTransporte === MODO_TRANSPORTE.PUBLICO;

  return [
    "<cac:Shipment>",
    el("cbc:ID", "SHIPMENT-1"),
    el("cbc:HandlingCode", g.motivo),
    el("cbc:HandlingInstructions", g.descripcionMotivo),
    el("cbc:GrossWeightMeasure", dtoa(g.pesoBruto, 3), ` unitCode="${esc(g.unidadPeso)}"`),
    ...(g.bultos ? [el("cbc:TotalTransportHandlingUnitQuantity", g.bultos)] : []),
    // Un envío no se parte en varias guías: si se partiera, cada tramo sería
    // una guía distinta y SUNAT las trataría por separado.
    el("cbc:SplitConsignmentIndicator", "false"),
    "<cac:ShipmentStage>",
    el("cbc:TransportModeCode", g.modoTransporte),
    "<cac:TransitPeriod>",
    el("cbc:StartDate", g.fechaTraslado),
    "</cac:TransitPeriod>",
    ...(publico && g.transportista
      ? [
          "<cac:CarrierParty>",
          "<cac:PartyIdentification>",
          el("cbc:ID", g.transportista.numeroDocumento, ` schemeID="${esc(g.transportista.tipoDocumento)}"`),
          "</cac:PartyIdentification>",
          "<cac:PartyLegalEntity>",
          el("cbc:RegistrationName", g.transportista.razonSocial),
          "</cac:PartyLegalEntity>",
          "</cac:CarrierParty>",
          ...(g.transportista.registroMtc
            ? [
                "<cac:TransportMeans>",
                "<cac:RoadTransport>",
                el("cbc:LicensePlateID", g.transportista.registroMtc),
                "</cac:RoadTransport>",
                "</cac:TransportMeans>",
              ]
            : []),
        ]
      : [
          "<cac:TransportMeans>",
          "<cac:RoadTransport>",
          el("cbc:LicensePlateID", g.placa ?? ""),
          "</cac:RoadTransport>",
          "</cac:TransportMeans>",
          ...(g.conductor
            ? [
                "<cac:DriverPerson>",
                el("cbc:ID", g.conductor.numeroDocumento, ` schemeID="${esc(g.conductor.tipoDocumento)}"`),
                el("cbc:FirstName", g.conductor.nombres),
                el("cbc:FamilyName", g.conductor.apellidos),
                el("cbc:JobTitle", "Principal"),
                "<cac:IdentityDocumentReference>",
                el("cbc:ID", g.conductor.licencia),
                "</cac:IdentityDocumentReference>",
                "</cac:DriverPerson>",
              ]
            : []),
        ]),
    "</cac:ShipmentStage>",
    "<cac:Delivery>",
    direccion("cac:DeliveryAddress", g.llegada),
    "<cac:Despatch>",
    direccion("cac:DespatchAddress", g.partida),
    "</cac:Despatch>",
    "</cac:Delivery>",
    "</cac:Shipment>",
  ].join("");
}

function direccion(etiqueta: string, d: Direccion): string {
  return [
    `<${etiqueta}>`,
    el("cbc:ID", d.ubigeo),
    ...(d.codigoEstablecimiento ? [el("cbc:AddressTypeCode", d.codigoEstablecimiento)] : []),
    "<cac:AddressLine>",
    el("cbc:Line", d.direccion),
    "</cac:AddressLine>",
    `</${etiqueta}>`,
  ].join("");
}

function lineaGuia(l: LineaGuia): string {
  return [
    "<cac:DespatchLine>",
    el("cbc:ID", l.numero),
    el("cbc:DeliveredQuantity", dtoa(l.cantidad, 6), ` unitCode="${esc(l.unidad)}"`),
    "<cac:OrderLineReference>",
    el("cbc:LineID", l.numero),
    "</cac:OrderLineReference>",
    "<cac:Item>",
    el("cbc:Name", l.descripcion),
    "<cac:SellersItemIdentification>",
    el("cbc:ID", l.codigo),
    "</cac:SellersItemIdentification>",
    "</cac:Item>",
    "</cac:DespatchLine>",
  ].join("");
}
