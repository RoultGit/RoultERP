/**
 * Firma digital del comprobante (XMLDSig enveloped).
 *
 * SUNAT exige que el XML vaya firmado con el certificado tributario del emisor,
 * y que la firma quede dentro del propio documento, en el nodo
 * `ext:ExtensionContent`. Es la parte del sistema donde un error no se ve: el
 * XML parece correcto, y SUNAT lo rechaza con un código que sólo dice «la firma
 * no es válida».
 *
 * Tres cosas que hay que hacer bien y que no son evidentes:
 *
 * 1. **Canonicalización C14N exclusiva.** El XML se normaliza antes de calcular
 *    el resumen. Sin esto, un espacio en blanco de más rompe la verificación en
 *    el lado de SUNAT aunque el documento sea idéntico.
 *
 * 2. **La referencia va vacía (`URI=""`), es decir, a todo el documento**, con
 *    la transformación `enveloped-signature` para excluirse a sí misma. Firmar
 *    un fragmento hace que SUNAT no encuentre qué se firmó.
 *
 * 3. **El certificado viaja en la firma.** SUNAT valida la cadena contra el
 *    RUC del emisor; sin `X509Certificate` no puede.
 *
 * La llave privada nunca se guarda ni se registra: entra por parámetro, se usa
 * y se descarta. Quien la obtiene del almacén cifrado es responsable de no
 * dejarla en ninguna parte.
 */
import { SignedXml } from "xml-crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import forge from "node-forge";

export type Certificado = {
  /** Clave privada en PEM. */
  clavePrivadaPem: string;
  /** Certificado X.509 en PEM. */
  certificadoPem: string;
  /** RUC al que pertenece el certificado, para comprobarlo antes de firmar. */
  ruc?: string;
  /** Fin de vigencia, para avisar antes de que caduque. */
  vence?: Date;
};

/** OID del atributo `serialNumber` en el sujeto del certificado (X.520). */
const OID_SERIAL_NUMBER = "2.5.4.5";

export class CertificadoInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "CertificadoInvalido";
  }
}

/**
 * Abre un archivo `.pfx` (PKCS#12) y extrae la clave y el certificado.
 *
 * Es el formato en el que las entidades acreditadas peruanas entregan el
 * certificado tributario. La contraseña se usa aquí y no se conserva.
 */
export function abrirPfx(pfx: Uint8Array, password: string): Certificado {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pfx).toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    // No se distingue «contraseña incorrecta» de «archivo corrupto»: ninguna de
    // las dos le sirve a quien está subiendo el certificado, y la diferencia
    // sólo ayudaría a quien esté probando contraseñas.
    throw new CertificadoInvalido(
      "no se pudo abrir el certificado; revise el archivo y su contraseña",
    );
  }

  // Los OID de forge están tipados como opcionales; se fijan aquí para poder
  // indexar con ellos sin repetir la comprobación en tres sitios.
  const OID_CLAVE_CIFRADA = forge.pki.oids["pkcs8ShroudedKeyBag"]!;
  const OID_CLAVE = forge.pki.oids["keyBag"]!;
  const OID_CERT = forge.pki.oids["certBag"]!;

  const bolsaClave =
    p12.getBags({ bagType: OID_CLAVE_CIFRADA })[OID_CLAVE_CIFRADA]?.[0] ??
    p12.getBags({ bagType: OID_CLAVE })[OID_CLAVE]?.[0];
  const bolsaCert = p12.getBags({ bagType: OID_CERT })[OID_CERT]?.[0];

  if (!bolsaClave?.key || !bolsaCert?.cert) {
    throw new CertificadoInvalido("el archivo no contiene una clave privada y su certificado");
  }

  const cert = bolsaCert.cert;
  const vence = cert.validity.notAfter;

  // El RUC vive en el campo `serialNumber` del sujeto en los certificados
  // tributarios peruanos. Sirve para comprobar, antes de firmar, que el
  // certificado subido es realmente el de esta empresa.
  // Se busca por OID y no por nombre: `getField("serialNumber")` compara contra
  // el nombre corto del atributo, y el serialNumber no tiene uno, así que esa
  // vía devuelve siempre undefined.
  const serial = cert.subject.getField({ type: OID_SERIAL_NUMBER })?.value as string | undefined;
  const ruc = serial?.match(/\d{11}/)?.[0];

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(bolsaClave.key),
    certificadoPem: forge.pki.certificateToPem(cert),
    ...(ruc ? { ruc } : {}),
    vence,
  };
}

/** El certificado en base64, sin las líneas PEM, que es como va dentro del XML. */
export const certificadoBase64 = (pem: string): string =>
  pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

/**
 * Firma el XML e inserta la firma en `ext:ExtensionContent`.
 *
 * `idFirma` debe coincidir con el `cbc:URI` que el documento declaró en
 * `cac:Signature`: SUNAT los cruza, y si no coinciden rechaza el comprobante.
 */
export function firmarXml(
  xml: string,
  cert: Certificado,
  opts: { idFirma?: string; rucEsperado?: string } = {},
): string {
  if (opts.rucEsperado && cert.ruc && cert.ruc !== opts.rucEsperado) {
    throw new CertificadoInvalido(
      `el certificado pertenece al RUC ${cert.ruc} y se está emitiendo para ${opts.rucEsperado}`,
    );
  }
  if (cert.vence && cert.vence.getTime() < Date.now()) {
    throw new CertificadoInvalido(
      `el certificado venció el ${cert.vence.toISOString().slice(0, 10)}`,
    );
  }

  const idFirma = opts.idFirma ?? `SIGN-${cert.ruc ?? "EMISOR"}`;

  const firma = new SignedXml({
    privateKey: cert.clavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });

  firma.addReference({
    xpath: "/*",
    transforms: [
      // El orden importa: primero se quita la propia firma del documento, y
      // sólo entonces se canonicaliza lo que queda.
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      // Sin la canonicalización explícita, el resumen que se calcula al firmar
      // no coincide con el que calcula quien verifica, y SUNAT responde que la
      // firma es inválida sin decir por qué.
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    uri: "",
    // `URI=""` significa «todo el documento». Sin esta bandera, xml-crypto
    // inventa un identificador y se lo añade como atributo al elemento raíz;
    // SUNAT espera la referencia vacía y el `Invoice` sin atributos ajenos.
    isEmptyUri: true,
  });

  firma.computeSignature(xml, {
    location: {
      // La firma va dentro del nodo de extensión, no al final del documento.
      reference: "//*[local-name(.)='ExtensionContent']",
      action: "append",
    },
    // El `Id` tiene que coincidir con el `cbc:URI` que el documento declaró en
    // `cac:Signature`: SUNAT los cruza. Se pasa aquí, y no editando el XML
    // después, porque tocar el documento ya firmado invalidaría el resumen.
    attrs: { Id: idFirma },
  });

  return firma.getSignedXml();
}

/**
 * Verifica una firma contra el certificado que la acompaña.
 *
 * Se usa en las pruebas y para diagnosticar un rechazo: si aquí la firma es
 * válida, el problema está en el contenido y no en el firmado.
 */
export function verificarFirma(xmlFirmado: string): boolean {
  const doc = new DOMParser().parseFromString(xmlFirmado, "text/xml");
  const nodo = doc.getElementsByTagNameNS(
    "http://www.w3.org/2000/09/xmldsig#",
    "Signature",
  )[0];
  if (!nodo) return false;

  const certBase64 = doc
    .getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "X509Certificate")[0]
    ?.textContent?.replace(/\s+/g, "");
  if (!certBase64) return false;

  const pem = `-----BEGIN CERTIFICATE-----\n${certBase64.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`;
  const firma = new SignedXml({ publicCert: pem });
  try {
    // Se le pasa el nodo, no su texto: reserializarlo cambiaría la forma
    // canónica y la verificación fallaría aunque la firma fuese correcta.
    firma.loadSignature(nodo as unknown as Parameters<SignedXml["loadSignature"]>[0]);
    return firma.checkSignature(xmlFirmado);
  } catch {
    return false;
  }
}

/**
 * Genera un certificado autofirmado para pruebas.
 *
 * No sirve para emitir de verdad —SUNAT valida la cadena contra entidades
 * acreditadas— pero permite probar todo el camino de firmado y envío sin tener
 * que manejar el certificado real del cliente en desarrollo.
 */
export function certificadoDePrueba(ruc = "20303051831"): Certificado {
  const claves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = claves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const atributos = [
    { name: "commonName", value: "CERTIFICADO DE PRUEBA ROULTERP" },
    { name: "countryName", value: "PE" },
    { name: "organizationName", value: "PRUEBAS" },
    { name: "serialNumber", value: ruc },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.sign(claves.privateKey, forge.md.sha256.create());

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(claves.privateKey),
    certificadoPem: forge.pki.certificateToPem(cert),
    ruc,
    vence: cert.validity.notAfter,
  };
}

/** Empaqueta el certificado de prueba como PFX, para ejercitar `abrirPfx`. */
export function pfxDePrueba(cert: Certificado, password: string): Uint8Array {
  const p12 = forge.pkcs12.toPkcs12Asn1(
    forge.pki.privateKeyFromPem(cert.clavePrivadaPem),
    [forge.pki.certificateFromPem(cert.certificadoPem)],
    password,
    { algorithm: "3des" },
  );
  const der = forge.asn1.toDer(p12).getBytes();
  return new Uint8Array(Buffer.from(der, "binary"));
}
