/**
 * Comprobantes de pago electrónicos.
 *
 * SUNAT rechaza el comprobante entero por un código de tributo equivocado o una
 * firma mal armada, con un mensaje que no dice qué línea falló. Estas pruebas
 * fijan las decisiones que más rechazos causan.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as gre from "../src/cpe/guia.ts";
import * as ret from "../src/cpe/retencion.ts";
import * as cpe from "../src/cpe/impresion.ts";
import { money } from "../src/index.ts";
import { DOMParser } from "@xmldom/xmldom";
import { dec, toString } from "../src/money.ts";
import {
  construirXml, construirFactura, construirNotaCredito, construirNotaDebito, esc, nombreCpe,
  TIPO_DOCUMENTO, TRIBUTOS, tributoDeAfectacion, codigoPrecio,
  interpretarRespuesta, esReintentable, ESTADO_CPE,
  type ComprobanteCpe, type LineaCpe,
} from "../src/cpe/index.ts";
import {
  certificadoDePrueba, pfxDePrueba, abrirPfx, firmarXml, verificarFirma,
  certificadoBase64, CertificadoInvalido,
} from "../src/cpe/firma.ts";
import {
  empaquetar, desempaquetar, leerCdr, enviarComprobante, consultarTicket,
  ErrorSunat,
} from "../src/cpe/sunat.ts";
import { zipSync } from "fflate";

const EMISOR = {
  ruc: "20303051831",
  razonSocial: "SERVIDIVERSOS MARINA S.R.LTDA.",
  nombreComercial: "SERVIDIMAR",
  ubigeo: "150103",
  direccion: "Av. Prolong. Sede secundaria, Ate",
  distrito: "ATE",
  provincia: "LIMA",
  departamento: "LIMA",
};

const RECEPTOR = {
  tipoDocumento: "6",
  numeroDocumento: "20522633721",
  razonSocial: "HIDRAULICA DEL SUR S.A.C.",
  direccion: "Av. Industrial 455, Arequipa",
};

const linea = (over: Partial<LineaCpe> = {}): LineaCpe => ({
  numero: 1,
  codigo: "P001",
  descripcion: "Bomba centrífuga 2HP monofásica",
  unidad: "NIU",
  cantidad: dec("10"),
  valorUnitario: dec("500"),
  precioUnitario: dec("590"),
  afectacion: "10",
  valorVenta: dec("5000"),
  igv: dec("900"),
  tasaIgv: dec("0.18"),
  ...over,
});

const factura = (over: Partial<ComprobanteCpe> = {}): ComprobanteCpe => ({
  tipoDocumento: TIPO_DOCUMENTO.FACTURA,
  serie: "F001",
  numero: "00000123",
  fechaEmision: "2026-09-09",
  horaEmision: "10:30:00",
  moneda: "PEN",
  emisor: EMISOR,
  receptor: RECEPTOR,
  lineas: [linea()],
  gravadas: dec("5000"),
  exoneradas: dec("0"),
  inafectas: dec("0"),
  exportacion: dec("0"),
  gratuitas: dec("0"),
  igv: dec("900"),
  total: dec("5900"),
  totalEnLetras: "CINCO MIL NOVECIENTOS CON 00/100 SOLES",
  ...over,
});

const parsear = (xml: string) => new DOMParser().parseFromString(xml, "text/xml");
const texto = (xml: string, tag: string): string =>
  parsear(xml).getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() ?? "";
const todos = (xml: string, tag: string): string[] => {
  const nodos = parsear(xml).getElementsByTagNameNS("*", tag);
  return Array.from({ length: nodos.length }, (_, i) => nodos[i]?.textContent?.trim() ?? "");
};

// ─── Estructura del XML ───────────────────────────────────────────────────

describe("XML UBL 2.1", () => {
  test("la factura declara la versión y el perfil que exige SUNAT", () => {
    const xml = construirXml(factura());
    assert.equal(texto(xml, "UBLVersionID"), "2.1");
    assert.equal(texto(xml, "CustomizationID"), "2.0");
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"'));
  });

  test("el identificador es serie-número", () => {
    assert.equal(texto(construirXml(factura()), "ID"), "F001-00000123");
  });

  test("lleva el nodo de extensión donde después va la firma", () => {
    const xml = construirXml(factura());
    assert.ok(xml.includes("<ext:ExtensionContent></ext:ExtensionContent>"));
  });

  test("emisor y receptor van con su tipo de documento del catálogo 06", () => {
    const xml = construirXml(factura());
    assert.ok(xml.includes('schemeID="6"'), "RUC del emisor");
    assert.ok(xml.includes("20303051831"));
    assert.ok(xml.includes("20522633721"));
    assert.match(xml, /HIDRAULICA DEL SUR/);
  });

  test("los importes van con dos decimales", () => {
    const xml = construirXml(factura());
    assert.equal(texto(xml, "PayableAmount"), "5900.00");
    assert.equal(texto(xml, "TaxInclusiveAmount"), "5900.00");
    assert.equal(texto(xml, "LineExtensionAmount"), "5000.00");
  });

  test("la moneda se declara en la cabecera y en cada importe", () => {
    const xml = construirXml(factura({ moneda: "USD" }));
    assert.equal(texto(xml, "DocumentCurrencyCode"), "USD");
    assert.ok(xml.includes('currencyID="USD"'));
  });

  test("el importe en letras va como nota con el locale 1000", () => {
    const xml = construirXml(factura());
    assert.ok(xml.includes('languageLocaleID="1000"'));
    assert.match(xml, /CINCO MIL NOVECIENTOS/);
  });

  test("una razón social con & no rompe el XML", () => {
    // «MARTÍNEZ & HIJOS» sin escapar produce un XML malformado que SUNAT
    // rechaza antes de validar nada.
    const xml = construirXml(
      factura({ receptor: { ...RECEPTOR, razonSocial: "MARTÍNEZ & HIJOS <S.A.>" } }),
    );
    assert.ok(xml.includes("&amp;"));
    assert.ok(!xml.includes("& HIJOS"));
    const doc = parsear(xml);
    assert.equal(doc.getElementsByTagNameNS("*", "RegistrationName")[1]?.textContent,
      "MARTÍNEZ & HIJOS <S.A.>", "al parsear vuelve el texto original");
  });

  test("esc escapa los cinco caracteres que importan", () => {
    assert.equal(esc(`& < > " '`), "&amp; &lt; &gt; &quot; &apos;");
    assert.equal(esc(null), "");
  });

  test("el nombre del comprobante sigue el formato RUC-TIPO-SERIE-NUMERO", () => {
    assert.equal(
      nombreCpe("20303051831", "01", "F001", "00000123"),
      "20303051831-01-F001-00000123",
    );
  });
});

// ─── Tributos por afectación ──────────────────────────────────────────────

describe("tributos según la afectación", () => {
  test("una línea gravada lleva el código 1000 del IGV", () => {
    const t = tributoDeAfectacion("10");
    assert.equal(t.codigo, "1000");
    assert.equal(t.nombre, "IGV");
    assert.equal(t.tipo, "VAT");
  });

  test("una exonerada lleva 9997, no el del IGV", () => {
    assert.equal(tributoDeAfectacion("20").codigo, "9997");
  });

  test("una inafecta lleva 9998", () => {
    assert.equal(tributoDeAfectacion("30").codigo, "9998");
  });

  test("una exportación lleva 9995", () => {
    assert.equal(tributoDeAfectacion("40").codigo, "9995");
  });

  test("toda gratuita lleva 9996, venga de donde venga", () => {
    // Es el error clásico: una bonificación de un producto gravado se marca
    // con el código del IGV y SUNAT rebota el comprobante entero.
    for (const afectacion of ["11", "15", "21", "31", "33", "36"]) {
      assert.equal(
        tributoDeAfectacion(afectacion).codigo,
        "9996",
        `la afectación ${afectacion} debe llevar el tributo gratuito`,
      );
    }
  });

  test("el código de precio distingue lo cobrado de lo gratuito", () => {
    assert.equal(codigoPrecio(false), "01");
    assert.equal(codigoPrecio(true), "02");
  });

  test("en el XML, la línea exonerada no declara el tributo del IGV", () => {
    const xml = construirXml(
      factura({
        lineas: [linea({ afectacion: "20", igv: dec("0"), tasaIgv: dec("0") })],
        gravadas: dec("0"),
        exoneradas: dec("5000"),
        igv: dec("0"),
        total: dec("5000"),
      }),
    );
    const codigos = todos(xml, "ID").filter((v) => /^\d{4}$/.test(v));
    assert.ok(codigos.includes("9997"), "debe aparecer el tributo de exonerado");
    assert.ok(!codigos.includes("1000"), "no debe aparecer el del IGV");
  });

  test("una línea gratuita tiene valor de venta cero y precio referencial", () => {
    const xml = construirXml(
      factura({
        lineas: [
          linea({ afectacion: "15", valorVenta: dec("500"), igv: dec("90") }),
        ],
        gravadas: dec("0"),
        gratuitas: dec("500"),
        igv: dec("0"),
        total: dec("0"),
      }),
    );
    const lineExt = todos(xml, "LineExtensionAmount");
    assert.equal(lineExt.at(-1), "0.00", "la gratuita no suma al valor de venta");
    assert.ok(xml.includes("<cbc:PriceTypeCode>02</cbc:PriceTypeCode>"));
  });

  test("sólo se emiten los subtotales de impuesto que tienen importe", () => {
    const xml = construirXml(factura());
    const codigos = todos(xml, "ID").filter((v) => /^9\d{3}$/.test(v));
    assert.deepEqual(codigos, [], "una factura sólo gravada no declara 9997 ni 9998");
  });

  test("la tasa del IGV va como porcentaje, no como fracción", () => {
    const xml = construirXml(factura());
    assert.equal(texto(xml, "Percent"), "18.00");
  });
});

// ─── Detracción ───────────────────────────────────────────────────────────

describe("detracción en el comprobante", () => {
  test("se informan la cuenta, el código, el porcentaje y el monto", () => {
    const xml = construirXml(
      factura({
        detraccion: {
          codigo: "037",
          cuenta: "00-123-456789",
          porcentaje: dec("0.12"),
          monto: dec("708"),
        },
      }),
    );
    assert.ok(xml.includes("00-123-456789"));
    assert.equal(texto(xml, "PaymentMeansID"), "037");
    assert.equal(texto(xml, "PaymentPercent"), "12.00");
    assert.equal(texto(xml, "Amount"), "708.00");
  });

  test("sin detracción no aparece el bloque de medios de pago", () => {
    const xml = construirXml(factura());
    assert.ok(!xml.includes("PaymentMeans"));
  });
});

// ─── Nota de crédito ──────────────────────────────────────────────────────

describe("nota de crédito", () => {
  const nota = () =>
    factura({
      tipoDocumento: TIPO_DOCUMENTO.NOTA_CREDITO,
      serie: "FC01",
      numero: "00000007",
      notaModificada: {
        tipoDocumento: "01",
        serie: "F001",
        numero: "00000123",
        motivo: "06",
        descripcionMotivo: "Devolución total",
      },
    });

  test("referencia el comprobante que modifica y su motivo", () => {
    const xml = construirXml(nota());
    assert.ok(xml.startsWith('<?xml version="1.0"'));
    assert.ok(xml.includes("<CreditNote"));
    assert.equal(texto(xml, "ReferenceID"), "F001-00000123");
    assert.equal(texto(xml, "ResponseCode"), "06");
    assert.equal(texto(xml, "Description"), "Devolución total");
    assert.equal(texto(xml, "DocumentTypeCode"), "01");
  });

  test("sus líneas usan CreditNoteLine y CreditedQuantity", () => {
    const xml = construirXml(nota());
    assert.ok(xml.includes("cac:CreditNoteLine"));
    assert.ok(xml.includes("cbc:CreditedQuantity"));
    assert.ok(!xml.includes("cbc:InvoicedQuantity"));
  });

  test("una nota sin el comprobante que modifica se rechaza", () => {
    const sinReferencia = { ...nota() };
    delete sinReferencia.notaModificada;
    assert.throws(() => construirNotaCredito(sinReferencia), /debe indicar el comprobante/);
  });

  test("la nota de débito usa DebitNote, DebitedQuantity y el total solicitado", () => {
    const xml = construirXml(
      factura({
        tipoDocumento: TIPO_DOCUMENTO.NOTA_DEBITO,
        serie: "FD01",
        numero: "00000003",
        notaModificada: {
          tipoDocumento: "01",
          serie: "F001",
          numero: "00000123",
          motivo: "01",
          descripcionMotivo: "Intereses por mora",
        },
      }),
    );
    assert.ok(xml.includes("<DebitNote"));
    assert.ok(xml.includes("cac:DebitNoteLine"));
    assert.ok(xml.includes("cbc:DebitedQuantity"));
    // SUNAT distingue el total de una nota de débito del de una factura: aquí
    // es RequestedMonetaryTotal, no LegalMonetaryTotal.
    assert.ok(xml.includes("cac:RequestedMonetaryTotal"));
    assert.ok(!xml.includes("cac:LegalMonetaryTotal"));
    assert.equal(texto(xml, "ResponseCode"), "01");
  });

  test("una nota de débito sin referencia también se rechaza", () => {
    const sinReferencia = factura({ tipoDocumento: TIPO_DOCUMENTO.NOTA_DEBITO });
    delete sinReferencia.notaModificada;
    assert.throws(() => construirNotaDebito(sinReferencia), /debe indicar el comprobante/);
  });

  test("un tipo de comprobante no soportado falla con un mensaje claro", () => {
    assert.throws(
      () => construirXml(factura({ tipoDocumento: TIPO_DOCUMENTO.GUIA_REMISION_REMITENTE })),
      /no soportado todavía/,
    );
  });
});

// ─── Firma digital ────────────────────────────────────────────────────────

describe("firma digital", () => {
  // Generar un par RSA de 2048 bits tarda; se hace una vez para toda la suite.
  const cert = certificadoDePrueba("20303051831");

  test("el XML firmado sigue siendo válido y verifica contra su certificado", () => {
    const firmado = firmarXml(construirXml(factura()), cert);
    assert.ok(firmado.includes("SignatureValue"));
    assert.ok(firmado.includes("X509Certificate"));
    assert.equal(verificarFirma(firmado), true);
  });

  test("la firma va dentro de ExtensionContent, no al final del documento", () => {
    const firmado = firmarXml(construirXml(factura()), cert);
    const posFirma = firmado.indexOf("SignatureValue");
    const posCierreExt = firmado.indexOf("</ext:UBLExtensions>");
    assert.ok(posFirma > 0 && posFirma < posCierreExt, "la firma debe quedar en la extensión");
  });

  test("alterar un importe después de firmar invalida la firma", () => {
    // Es lo que la firma existe para detectar: que nadie cambie el total
    // después de que el emisor lo aprobó.
    const firmado = firmarXml(construirXml(factura()), cert);
    const alterado = firmado.replace("5900.00", "5000.00");
    assert.notEqual(alterado, firmado);
    assert.equal(verificarFirma(alterado), false);
  });

  test("la firma lleva el Id que el documento declaró en cac:Signature", () => {
    const firmado = firmarXml(construirXml(factura()), cert, { idFirma: "SIGN-20303051831" });
    assert.ok(firmado.includes('Id="SIGN-20303051831"'));
    assert.ok(firmado.includes("#SIGN-20303051831"), "el cbc:URI debe apuntar al mismo Id");
  });

  test("un certificado de otro RUC no firma para esta empresa", () => {
    assert.throws(
      () => firmarXml(construirXml(factura()), cert, { rucEsperado: "20100066603" }),
      (e: unknown) => e instanceof CertificadoInvalido && /pertenece al RUC/.test(e.message),
    );
  });

  test("un certificado vencido no firma", () => {
    const vencido = { ...cert, vence: new Date("2020-01-01") };
    assert.throws(
      () => firmarXml(construirXml(factura()), vencido),
      (e: unknown) => e instanceof CertificadoInvalido && /venció/.test(e.message),
    );
  });

  test("un XML sin firma no verifica", () => {
    assert.equal(verificarFirma(construirXml(factura())), false);
  });

  test("el certificado en base64 va sin las líneas PEM", () => {
    const b64 = certificadoBase64(cert.certificadoPem);
    assert.ok(!b64.includes("BEGIN"));
    assert.ok(!b64.includes("\n"));
    assert.ok(b64.length > 100);
  });

  describe("archivo PKCS#12", () => {
    test("se abre con su contraseña y trae la clave, el certificado y el RUC", () => {
      const pfx = pfxDePrueba(cert, "clave-del-certificado");
      const abierto = abrirPfx(pfx, "clave-del-certificado");
      assert.match(abierto.clavePrivadaPem, /BEGIN (RSA )?PRIVATE KEY/);
      assert.match(abierto.certificadoPem, /BEGIN CERTIFICATE/);
      assert.equal(abierto.ruc, "20303051831", "el RUC sale del serialNumber del sujeto");
      assert.ok(abierto.vence instanceof Date);
    });

    test("firma igual de bien abierto desde el PFX", () => {
      const pfx = pfxDePrueba(cert, "clave-del-certificado");
      const abierto = abrirPfx(pfx, "clave-del-certificado");
      assert.equal(verificarFirma(firmarXml(construirXml(factura()), abierto)), true);
    });

    test("con la contraseña equivocada no se abre, y el error no delata cuál falló", () => {
      const pfx = pfxDePrueba(cert, "clave-correcta");
      assert.throws(
        () => abrirPfx(pfx, "clave-equivocada"),
        (e: unknown) =>
          e instanceof CertificadoInvalido && /revise el archivo y su contraseña/.test(e.message),
      );
    });

    test("un archivo que no es un PFX se rechaza sin reventar", () => {
      assert.throws(
        () => abrirPfx(new Uint8Array([1, 2, 3, 4]), "x"),
        CertificadoInvalido,
      );
    });
  });
});

// ─── Empaquetado y envío ──────────────────────────────────────────────────

describe("empaquetado", () => {
  test("el XML va dentro del ZIP con el mismo nombre y extensión .xml", () => {
    const nombre = "20303051831-01-F001-00000123";
    const zip = empaquetar(nombre, "<Invoice/>");
    const dentro = desempaquetar(zip);
    assert.equal(dentro?.nombre, `${nombre}.xml`);
    assert.equal(dentro?.contenido, "<Invoice/>");
  });

  test("un ZIP sin XML devuelve null en vez de reventar", () => {
    const zip = zipSync({ "algo.txt": new TextEncoder().encode("hola") });
    assert.equal(desempaquetar(zip), null);
  });
});

describe("interpretación de la respuesta de SUNAT", () => {
  test("el código 0 es aceptado", () => {
    assert.equal(interpretarRespuesta(0), ESTADO_CPE.ACEPTADO);
  });

  test("de 2000 en adelante es rechazo definitivo", () => {
    assert.equal(interpretarRespuesta(2335), ESTADO_CPE.RECHAZADO);
  });

  test("de 4000 en adelante es aceptado con observaciones", () => {
    assert.equal(interpretarRespuesta(4000), ESTADO_CPE.ACEPTADO_CON_OBSERVACIONES);
  });

  test("sólo los errores del servicio se reintentan", () => {
    assert.equal(esReintentable(100), true, "servicio no disponible");
    assert.equal(esReintentable(2335), false, "un error del comprobante no se arregla reintentando");
    assert.equal(esReintentable(0), false);
  });
});

describe("CDR", () => {
  const cdrXml = (codigo: string, descripcion: string, notas: string[] = []) => `<?xml version="1.0"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cac:DocumentResponse><cac:Response>
    <cbc:ResponseCode>${codigo}</cbc:ResponseCode>
    <cbc:Description>${descripcion}</cbc:Description>
  </cac:Response></cac:DocumentResponse>
  ${notas.map((n) => `<cbc:Note>${n}</cbc:Note>`).join("")}
</ApplicationResponse>`;

  const cdrZip = (codigo: string, descripcion: string, notas: string[] = []) =>
    zipSync({ "R-20303051831-01-F001-123.xml": new TextEncoder().encode(cdrXml(codigo, descripcion, notas)) });

  test("una aceptación devuelve el estado y conserva el ZIP original", () => {
    const zip = cdrZip("0", "La Factura numero F001-123, ha sido aceptada");
    const r = leerCdr(zip);
    assert.equal(r.estado, ESTADO_CPE.ACEPTADO);
    assert.equal(r.codigo, 0);
    assert.match(r.descripcion, /ha sido aceptada/);
    assert.deepEqual(r.cdrZip, zip, "el CDR es el documento que hay que conservar");
  });

  test("una aceptación con observaciones sigue siendo válida y las expone", () => {
    const r = leerCdr(cdrZip("0", "aceptada", ["4267 - El dato ingresado no cumple"]));
    assert.equal(r.estado, ESTADO_CPE.ACEPTADO);
    assert.equal(r.observaciones.length, 1);
    assert.match(r.observaciones[0]!, /4267/);
  });

  test("un rechazo lanza con su código, no se guarda como si fuera bueno", () => {
    assert.throws(
      () => leerCdr(cdrZip("2335", "El comprobante contiene un valor no permitido")),
      (e: unknown) => e instanceof ErrorSunat && e.codigo === 2335 && !e.reintentable,
    );
  });

  test("un CDR ilegible se detecta", () => {
    assert.throws(
      () => leerCdr(zipSync({ "vacio.txt": new TextEncoder().encode("") })),
      /vacío o ilegible/,
    );
  });
});

describe("envío a SUNAT", () => {
  const credenciales = { ruc: "20303051831", usuarioSol: "MODDATOS", claveSol: "MODDATOS" };

  const cdrBase64 = () => {
    const xml = `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x"><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>aceptada</cbc:Description></ApplicationResponse>`;
    const zip = zipSync({ "R-1.xml": new TextEncoder().encode(xml) });
    return Buffer.from(zip).toString("base64");
  };

  test("envía el comprobante y devuelve el CDR interpretado", async () => {
    let peticion: { url: string; body: string; headers: Record<string, string> } | null = null;
    const fetchFalso = (async (url: string, init: RequestInit) => {
      peticion = {
        url,
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      };
      return new Response(
        `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><applicationResponse>${cdrBase64()}</applicationResponse></soap:Body></soap:Envelope>`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const r = await enviarComprobante(credenciales, "20303051831-01-F001-123", "<Invoice/>", {
      fetchImpl: fetchFalso,
    });

    assert.equal(r.estado, ESTADO_CPE.ACEPTADO);
    assert.ok(peticion);
    assert.match(peticion!.body, /sendBill/);
    assert.equal(peticion!.headers["SOAPAction"], "urn:sendBill");
    assert.match(
      peticion!.body,
      /20303051831MODDATOS/,
      "el usuario es RUC + usuario SOL, todo junto",
    );
  });

  test("un soap:Fault se traduce a un error con su código", async () => {
    const fetchFalso = (async () =>
      new Response(
        `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap-env:Client.0103</faultcode><faultstring>El Usuario no existe</faultstring></soap:Fault></soap:Body></soap:Envelope>`,
        { status: 500 },
      )) as unknown as typeof fetch;

    await assert.rejects(
      () =>
        enviarComprobante(credenciales, "x", "<Invoice/>", { fetchImpl: fetchFalso }),
      (e: unknown) => e instanceof ErrorSunat && e.codigo === 103 && /Usuario no existe/.test(e.message),
    );
  });

  test("un ticket en proceso no es un error, hay que volver a preguntar", async () => {
    const fetchFalso = (async () =>
      new Response(
        `<soap:Envelope xmlns:soap="http://x"><soap:Body><statusCode>98</statusCode></soap:Body></soap:Envelope>`,
        { status: 200 },
      )) as unknown as typeof fetch;

    const r = await consultarTicket(credenciales, "123456", { fetchImpl: fetchFalso });
    assert.deepEqual(r, { enProceso: true });
  });

  test("un tiempo agotado avisa de que hay que consultar antes de reenviar", async () => {
    const fetchFalso = (async () => {
      const e = new Error("abortado");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => enviarComprobante(credenciales, "x", "<Invoice/>", { fetchImpl: fetchFalso }),
      (e: unknown) =>
        e instanceof ErrorSunat && e.reintentable && /consulte antes de reenviar/.test(e.message),
    );
  });

  test("la clave SOL no aparece en el mensaje de error", async () => {
    const fetchFalso = (async () => {
      throw new Error("fallo de red");
    }) as unknown as typeof fetch;

    const error = await enviarComprobante(credenciales, "x", "<Invoice/>", {
      fetchImpl: fetchFalso,
    }).catch((e: Error) => e);

    assert.ok(!error.message.includes("MODDATOS"), "la credencial no debe filtrarse al error");
  });
});

// ─── Guía de remisión electrónica ─────────────────────────────────────────

describe("guía de remisión", () => {
  const guiaBase = (cambios: Partial<gre.GuiaRemision> = {}): gre.GuiaRemision => ({
    serie: "T001",
    numero: "00000001",
    fechaEmision: "2026-09-12",
    horaEmision: "10:30:00",
    tipoGuia: gre.TIPO_GUIA.REMITENTE,
    emisor: { ruc: "20303051831", razonSocial: "SERVIDIMAR" },
    destinatario: {
      tipoDocumento: "6",
      numeroDocumento: "20522633721",
      razonSocial: "HIDRÁULICA DEL SUR S.A.C.",
    },
    motivo: gre.MOTIVO_TRASLADO.VENTA,
    descripcionMotivo: "Venta de mercadería",
    pesoBruto: money.dec("120.5"),
    unidadPeso: "KGM",
    modoTransporte: gre.MODO_TRANSPORTE.PRIVADO,
    fechaTraslado: "2026-09-13",
    partida: { ubigeo: "150103", direccion: "Av. Nicolás Ayllón 3820, Ate" },
    llegada: { ubigeo: "150132", direccion: "Av. Argentina 2000, San Miguel" },
    placa: "ABC-123",
    conductor: {
      tipoDocumento: "1",
      numeroDocumento: "45678912",
      nombres: "Juan",
      apellidos: "Pérez",
      licencia: "Q45678912",
    },
    documentoRelacionado: { tipoDocumento: "01", serie: "F001", numero: "00000123" },
    lineas: [
      {
        numero: 1,
        codigo: "P001",
        descripcion: "Bomba centrífuga 2HP",
        unidad: "NIU",
        cantidad: money.dec("4"),
      },
    ],
    ...cambios,
  });

  test("es un DespatchAdvice con el motivo y el peso del traslado", () => {
    const xml = gre.construirGuia(guiaBase());
    assert.ok(xml.includes("<DespatchAdvice"));
    assert.equal(texto(xml, "DespatchAdviceTypeCode"), "09");
    assert.equal(texto(xml, "HandlingCode"), "01");
    assert.equal(texto(xml, "GrossWeightMeasure"), "120.500");
    assert.equal(texto(xml, "StartDate"), "2026-09-13");
  });

  test("no lleva importes: una guía documenta un traslado, no una venta", () => {
    const xml = gre.construirGuia(guiaBase());
    assert.ok(!xml.includes("TaxTotal"));
    assert.ok(!xml.includes("PayableAmount"));
    assert.ok(!xml.includes("currencyID"));
  });

  test("en transporte privado van la placa y el conductor", () => {
    const xml = gre.construirGuia(guiaBase());
    assert.equal(texto(xml, "LicensePlateID"), "ABC-123");
    assert.ok(xml.includes("<cac:DriverPerson>"));
    assert.equal(texto(xml, "FamilyName"), "Pérez");
  });

  test("en transporte público va el transportista, no el conductor", () => {
    const xml = gre.construirGuia(
      guiaBase({
        modoTransporte: gre.MODO_TRANSPORTE.PUBLICO,
        transportista: {
          tipoDocumento: "6",
          numeroDocumento: "20100047218",
          razonSocial: "TRANSPORTES DEL SUR S.A.",
          registroMtc: "MTC-0001",
        },
      }),
    );
    assert.ok(xml.includes("<cac:CarrierParty>"));
    assert.ok(!xml.includes("<cac:DriverPerson>"), "el conductor lo pone el transportista");
    assert.ok(xml.includes("TRANSPORTES DEL SUR"));
  });

  test("el transporte privado sin placa se rechaza antes de firmar", () => {
    const sinPlaca = guiaBase();
    delete sinPlaca.placa;
    assert.throws(() => gre.construirGuia(sinPlaca), /placa del vehículo/);
  });

  test("el transporte público sin transportista se rechaza", () => {
    assert.throws(
      () => gre.construirGuia(guiaBase({ modoTransporte: gre.MODO_TRANSPORTE.PUBLICO })),
      /identificar al transportista/,
    );
  });

  test("un traslado por venta necesita el comprobante que lo sustenta", () => {
    const sinDoc = guiaBase();
    delete sinDoc.documentoRelacionado;
    assert.throws(() => gre.construirGuia(sinDoc), /comprobante que lo sustenta/);
  });

  test("un traslado entre almacenes propios no necesita comprobante", () => {
    const interno = guiaBase({
      motivo: gre.MOTIVO_TRASLADO.TRASLADO_ENTRE_ESTABLECIMIENTOS,
      descripcionMotivo: "Traslado entre almacenes",
    });
    delete interno.documentoRelacionado;
    const xml = gre.construirGuia(interno);
    assert.equal(texto(xml, "HandlingCode"), "04");
  });

  test("el traslado no puede empezar antes de emitir la guía", () => {
    assert.throws(
      () => gre.construirGuia(guiaBase({ fechaTraslado: "2026-09-11" })),
      /antes de emitir/,
    );
  });

  test("un ubigeo que no tiene seis dígitos se rechaza", () => {
    assert.throws(
      () => gre.construirGuia(guiaBase({ llegada: { ubigeo: "1501", direccion: "x" } })),
      /ubigeo del punto de llegada/,
    );
  });

  test("cada bien es una DespatchLine con su cantidad y unidad", () => {
    const xml = gre.construirGuia(
      guiaBase({
        lineas: [
          { numero: 1, codigo: "P001", descripcion: "Bomba", unidad: "NIU", cantidad: money.dec("4") },
          { numero: 2, codigo: "P002", descripcion: "Válvula", unidad: "NIU", cantidad: money.dec("10") },
        ],
      }),
    );
    assert.equal(xml.match(/<cac:DespatchLine>/g)?.length, 2);
    assert.ok(xml.includes('<cbc:DeliveredQuantity unitCode="NIU">10.000000</cbc:DeliveredQuantity>'));
  });

  test("la guía firmada verifica", () => {
    const xml = gre.construirGuia(guiaBase());
    const firmado = firmarXml(xml, certificadoDePrueba("20303051831"), {
      rucEsperado: "20303051831",
    });
    assert.ok(verificarFirma(firmado));
  });

  test("el nombre del archivo sigue el patrón RUC-TIPO-SERIE-NUMERO", () => {
    assert.equal(
      gre.nombreGuia("20303051831", { tipoGuia: "09", serie: "T001", numero: "00000001" }),
      "20303051831-09-T001-00000001",
    );
  });
});

// ─── Retención y percepción ───────────────────────────────────────────────

describe("comprobantes de retención y percepción", () => {
  const base = (cambios: Partial<ret.ComprobanteRetencion> = {}): ret.ComprobanteRetencion => ({
    serie: "R001",
    numero: "00000001",
    fechaEmision: "2026-09-15",
    horaEmision: "09:00:00",
    emisor: { ruc: "20303051831", razonSocial: "SERVIDIMAR", ubigeo: "150103" },
    contraparte: {
      tipoDocumento: "6",
      numeroDocumento: "20100047218",
      razonSocial: "FERRETERÍA SAN MARTÍN S.A.C.",
    },
    regimen: ret.REGIMEN_RETENCION.TASA_3,
    tasa: money.dec("0.03"),
    importeTotal: money.dec("30.00"),
    importeOperacion: money.dec("1000.00"),
    documentos: [
      {
        tipoDocumento: "01",
        serie: "F001",
        numero: "00000123",
        fechaEmision: "2026-09-01",
        moneda: "PEN",
        total: money.dec("1000.00"),
        importe: money.dec("30.00"),
        fecha: "2026-09-15",
        neto: money.dec("970.00"),
        pagos: [{ importe: money.dec("1000.00"), moneda: "PEN", fecha: "2026-09-15" }],
      },
    ],
    ...cambios,
  });

  test("la retención es un Retention con su régimen y su tasa en porcentaje", () => {
    const xml = ret.construirRetencion(base());
    assert.ok(xml.includes("<Retention"));
    assert.equal(texto(xml, "SUNATRetentionSystemCode"), "01");
    // La tasa se emite como 3.00, no como 0.03: es el error que más rechaza.
    assert.equal(texto(xml, "SUNATRetentionPercent"), "3.00");
    assert.equal(texto(xml, "SUNATRetentionAmount"), "30.00");
    assert.equal(texto(xml, "SUNATNetTotalPaid"), "970.00");
  });

  test("la firma va antes del identificador, al revés que en la factura", () => {
    const xml = ret.construirRetencion(base());
    assert.ok(
      xml.indexOf("<cac:Signature>") < xml.indexOf("<cbc:ID>R001-00000001</cbc:ID>"),
      "el orden de los elementos es parte del esquema",
    );
  });

  test("los importes retenidos van en soles aunque la factura esté en dólares", () => {
    const xml = ret.construirRetencion(
      base({
        importeTotal: money.dec("112.56"),
        importeOperacion: money.dec("3752.00"),
        documentos: [
          {
            tipoDocumento: "01",
            serie: "F001",
            numero: "00000123",
            fechaEmision: "2026-09-01",
            moneda: "USD",
            total: money.dec("1000.00"),
            importe: money.dec("112.56"),
            fecha: "2026-09-15",
            neto: money.dec("3639.44"),
            pagos: [{ importe: money.dec("1000.00"), moneda: "USD", fecha: "2026-09-15" }],
            tipoCambio: {
              monedaOrigen: "USD",
              monedaDestino: "PEN",
              factor: money.dec("3.752"),
              fecha: "2026-09-15",
            },
          },
        ],
      }),
    );
    assert.ok(xml.includes('<sac:SUNATRetentionAmount currencyID="PEN">112.56'));
    assert.ok(xml.includes('<cbc:TotalInvoiceAmount currencyID="USD">1000.00'));
    assert.equal(texto(xml, "CalculationRate"), "3.752");
  });

  test("un documento en dólares sin tipo de cambio se rechaza", () => {
    const malo = base();
    malo.documentos[0]!.moneda = "USD";
    assert.throws(() => ret.construirRetencion(malo), /necesita el tipo de cambio/);
  });

  test("el total tiene que ser la suma de sus documentos", () => {
    assert.throws(
      () => ret.construirRetencion(base({ importeTotal: money.dec("99.00") })),
      /no coincide con la suma/,
    );
  });

  test("la percepción es un Perception con sus propias etiquetas", () => {
    const xml = ret.construirPercepcion(
      base({
        regimen: ret.REGIMEN_PERCEPCION.VENTA_INTERNA,
        tasa: money.dec("0.02"),
        importeTotal: money.dec("20.00"),
        documentos: [
          {
            tipoDocumento: "01",
            serie: "F001",
            numero: "00000500",
            fechaEmision: "2026-09-01",
            moneda: "PEN",
            total: money.dec("1000.00"),
            importe: money.dec("20.00"),
            fecha: "2026-09-15",
            neto: money.dec("1020.00"),
            pagos: [{ importe: money.dec("1020.00"), moneda: "PEN", fecha: "2026-09-15" }],
          },
        ],
      }),
    );
    assert.ok(xml.includes("<Perception"));
    assert.equal(texto(xml, "SUNATPerceptionPercent"), "2.00");
    assert.equal(texto(xml, "SUNATPerceptionAmount"), "20.00");
    // La percepción aumenta lo que cobra el agente: el neto es mayor que el
    // total del documento, al revés que en la retención.
    assert.equal(texto(xml, "SUNATNetTotalCashed"), "1020.00");
    assert.ok(!xml.includes("Retention"));
  });

  test("varios documentos en un solo comprobante", () => {
    const xml = ret.construirRetencion(
      base({
        importeTotal: money.dec("50.00"),
        importeOperacion: money.dec("1666.67"),
        documentos: [
          {
            tipoDocumento: "01", serie: "F001", numero: "00000123",
            fechaEmision: "2026-09-01", moneda: "PEN", total: money.dec("1000.00"),
            importe: money.dec("30.00"), fecha: "2026-09-15", neto: money.dec("970.00"),
            pagos: [{ importe: money.dec("1000.00"), moneda: "PEN", fecha: "2026-09-15" }],
          },
          {
            tipoDocumento: "01", serie: "F001", numero: "00000124",
            fechaEmision: "2026-09-02", moneda: "PEN", total: money.dec("666.67"),
            importe: money.dec("20.00"), fecha: "2026-09-15", neto: money.dec("646.67"),
            pagos: [{ importe: money.dec("666.67"), moneda: "PEN", fecha: "2026-09-15" }],
          },
        ],
      }),
    );
    assert.equal(xml.match(/<sac:SUNATRetentionDocumentReference>/g)?.length, 2);
  });

  test("el comprobante firmado verifica", () => {
    const xml = ret.construirRetencion(base());
    const firmado = firmarXml(xml, certificadoDePrueba("20303051831"), {
      rucEsperado: "20303051831",
    });
    assert.ok(verificarFirma(firmado));
  });
});

// ─── Representación impresa ───────────────────────────────────────────────

describe("representación impresa", () => {
  /**
   * El orden de los campos del QR lo lee una aplicación, no una persona: uno
   * cambiado de sitio da un comprobante que no valida y la hoja se ve igual.
   */
  test("el QR lleva los nueve campos y el resumen, en orden", () => {
    const qr = cpe.contenidoQr({
      rucEmisor: "20303051831",
      tipoComprobante: "01",
      serie: "F001",
      numero: "00000123",
      igv: "180.00",
      total: "1180.00",
      fechaEmision: "2026-09-20",
      tipoDocAdquirente: "6",
      numeroDocAdquirente: "20522633721",
      hash: "abc123",
    });
    assert.equal(
      qr,
      "20303051831|01|F001|00000123|180.00|1180.00|2026-09-20|6|20522633721|abc123",
    );
  });

  test("sin resumen no deja una barra suelta al final", () => {
    const qr = cpe.contenidoQr({
      rucEmisor: "20303051831", tipoComprobante: "03", serie: "B001", numero: "00000001",
      igv: "18.00", total: "118.00", fechaEmision: "2026-09-20",
      tipoDocAdquirente: "1", numeroDocAdquirente: "45678912", hash: null,
    });
    assert.ok(!qr.endsWith("|"), qr);
    assert.equal(qr.split("|").length, 9);
  });

  /** El QR se dibuja en la hoja; no es una imagen que haya que ir a buscar. */
  test("el QR sale como SVG dibujado, sin imágenes externas", async () => {
    const svg = await cpe.qrSvg("20303051831|01|F001|00000123");
    assert.match(svg, /^<svg/);
    assert.match(svg, /<path/, "el código tiene que venir dibujado");
    // El único http del archivo es el espacio de nombres de SVG.
    assert.doesNotMatch(svg, /<image|src=|xlink:href/);
  });

});
