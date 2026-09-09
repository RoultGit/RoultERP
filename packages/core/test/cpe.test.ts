/**
 * Comprobantes de pago electrónicos.
 *
 * SUNAT rechaza el comprobante entero por un código de tributo equivocado o una
 * firma mal armada, con un mensaje que no dice qué línea falló. Estas pruebas
 * fijan las decisiones que más rechazos causan.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { dec, toString } from "../src/money.ts";
import {
  construirXml, construirFactura, construirNotaCredito, esc, nombreCpe,
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
  direccion: "Av. Prolong. Mariscal Nieto 108, Ate",
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
