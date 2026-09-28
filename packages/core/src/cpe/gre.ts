/**
 * Guía de remisión electrónica (GRE), plataforma nueva.
 *
 * No comparte nada con el resto de la facturación electrónica salvo el
 * certificado: la GRE no viaja por SOAP sino por una API REST propia, con
 * OAuth2 y credenciales distintas de las SOL —un `client_id` y un
 * `client_secret` que se generan aparte en el menú SOL—. Confundir unas con
 * otras es el primer tropiezo de toda integración de GRE.
 *
 * El flujo es asíncrono, como el resumen diario: se envía el ZIP, SUNAT
 * devuelve un ticket y el CDR se recoge después.
 *
 * Contrato tomado de la especificación pública de la plataforma nueva GRE
 * (MANUAL DE SERVICIO WEB - PLATAFORMA NUEVA GRE).
 */
import { ErrorSunat, empaquetar } from "./sunat.ts";

export const ENDPOINT_TOKEN_GRE = "https://api-seguridad.sunat.gob.pe/v1";
export const ENDPOINT_GRE = "https://api-cpe.sunat.gob.pe/v1";

export type CredencialesGre = {
  ruc: string;
  usuarioSol: string;
  claveSol: string;
  clientId: string;
  clientSecret: string;
};

export type OpcionesGre = {
  fetchImpl?: typeof fetch;
  /** Base de la API de seguridad. Se sobreescribe en pruebas. */
  endpointToken?: string;
  /** Base de la API de comprobantes. */
  endpointCpe?: string;
};

const f = (opts: OpcionesGre): typeof fetch => opts.fetchImpl ?? fetch;

/**
 * Pide un token de acceso.
 *
 * `username` es el RUC pegado al usuario SOL, sin separador. Es el detalle que
 * más veces devuelve un 401 sin explicación.
 */
export async function obtenerToken(
  cred: CredencialesGre,
  opts: OpcionesGre = {},
): Promise<{ token: string; expiraEn: number }> {
  const base = opts.endpointToken ?? ENDPOINT_TOKEN_GRE;
  const url = `${base}/clientessol/${encodeURIComponent(cred.clientId)}/oauth2/token/`;

  const cuerpo = new URLSearchParams({
    grant_type: "password",
    scope: "https://api-cpe.sunat.gob.pe",
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    username: `${cred.ruc}${cred.usuarioSol}`,
    password: cred.claveSol,
  });

  const respuesta = await f(opts)(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: cuerpo.toString(),
  });

  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => "");
    throw new ErrorSunat(
      respuesta.status,
      `no se pudo obtener el token de la GRE (${respuesta.status}): ${texto.slice(0, 200)}`,
    );
  }

  const json = (await respuesta.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ErrorSunat(-1, "SUNAT devolvió un token vacío");
  return { token: json.access_token, expiraEn: json.expires_in ?? 3600 };
}

/**
 * Envía la guía firmada.
 *
 * El nombre del archivo es `RUC-09-SERIE-NUMERO`, igual que en la facturación
 * por SOAP, y viaja tres veces: en la ruta, en `nomArchivo` y dentro del ZIP.
 */
export async function enviarGuia(
  token: string,
  nombre: string,
  xmlFirmado: string,
  opts: OpcionesGre = {},
): Promise<{ ticket: string; recibidoEn?: string }> {
  const zip = empaquetar(nombre, xmlFirmado);
  const base = opts.endpointCpe ?? ENDPOINT_GRE;

  const respuesta = await f(opts)(
    `${base}/contribuyente/gem/comprobantes/${encodeURIComponent(nombre)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        archivo: {
          nomArchivo: `${nombre}.zip`,
          arcGreZip: Buffer.from(zip).toString("base64"),
          hashZip: await sha256Base64(zip),
        },
      }),
    },
  );

  const json = (await leerJson(respuesta)) as {
    numTicket?: string;
    fecRecepcion?: string;
    cod?: string;
    msg?: string;
    errors?: { cod: string; msg: string }[];
  };

  if (!respuesta.ok || !json.numTicket) {
    const detalle = json.errors?.map((e) => `${e.cod}: ${e.msg}`).join("; ");
    throw new ErrorSunat(
      Number(json.cod ?? respuesta.status),
      detalle ?? json.msg ?? `la GRE no fue aceptada (${respuesta.status})`,
    );
  }

  return {
    ticket: json.numTicket,
    ...(json.fecRecepcion ? { recibidoEn: json.fecRecepcion } : {}),
  };
}

export type EstadoGre =
  | { enProceso: true }
  | { enProceso: false; aceptada: boolean; codigo: string; mensaje: string; cdrZip?: Uint8Array };

/**
 * Consulta el estado del envío.
 *
 * `codRespuesta` manda: 98 sigue en proceso, 0 aceptada, 99 con error. Un 99
 * trae el detalle en `error`, y puede venir con CDR o sin él —de ahí
 * `indCdrGenerado`—.
 */
export async function consultarEnvioGuia(
  token: string,
  ticket: string,
  opts: OpcionesGre = {},
): Promise<EstadoGre> {
  const base = opts.endpointCpe ?? ENDPOINT_GRE;
  const respuesta = await f(opts)(
    `${base}/contribuyente/gem/comprobantes/envios/${encodeURIComponent(ticket)}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );

  const json = (await leerJson(respuesta)) as {
    codRespuesta?: string;
    error?: { numError?: string; desError?: string };
    arcCdr?: string;
    indCdrGenerado?: string;
    cod?: string;
    msg?: string;
  };

  if (!respuesta.ok) {
    throw new ErrorSunat(
      Number(json.cod ?? respuesta.status),
      json.msg ?? `no se pudo consultar el envío (${respuesta.status})`,
    );
  }

  if (json.codRespuesta === "98") return { enProceso: true };

  const cdr =
    json.indCdrGenerado === "1" && json.arcCdr
      ? new Uint8Array(Buffer.from(json.arcCdr, "base64"))
      : undefined;

  if (json.codRespuesta === "0") {
    return {
      enProceso: false,
      aceptada: true,
      codigo: "0",
      mensaje: "La guía de remisión ha sido aceptada",
      ...(cdr ? { cdrZip: cdr } : {}),
    };
  }

  return {
    enProceso: false,
    aceptada: false,
    codigo: json.error?.numError ?? json.codRespuesta ?? "99",
    mensaje: json.error?.desError ?? "SUNAT rechazó la guía",
    ...(cdr ? { cdrZip: cdr } : {}),
  };
}

/** Lee el JSON tolerando una respuesta vacía o que no lo sea. */
async function leerJson(r: Response): Promise<unknown> {
  const texto = await r.text().catch(() => "");
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    // Un proxy caído devuelve HTML. Se conserva el principio del cuerpo porque
    // es lo único que permite entender qué contestó de verdad.
    return { msg: texto.slice(0, 200) };
  }
}

async function sha256Base64(datos: Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(datos).digest("hex");
}
