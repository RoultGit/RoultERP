/**
 * Guías de remisión electrónicas.
 *
 * Una guía documenta un traslado, no una venta: no lleva importes ni impuestos
 * y no genera asiento ni cuenta por cobrar. Lo que sí hace es mover
 * mercadería, y por eso la emisión descarga o transfiere inventario cuando el
 * motivo lo implica.
 *
 * El envío va por la API REST de la GRE, con credenciales propias y flujo
 * asíncrono: se envía, SUNAT devuelve un ticket y el CDR se recoge después.
 */
import { desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { money, cpe } from "@roulterp/core";
import { abrir, type SobreCifrado } from "@roulterp/core/auth";
import { enEmpresa, schema as s, type Conexion, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";
import { horaEnPeru } from "@roulterp/core/fecha";

const {
  guiasRemision, guiaItems, terceros, productos, unidadesMedida, almacenes, sucursales,
  empresas, comprobantes, seriesDocumento, certificadosDigitales, credencialesSunat,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");

export class GuiaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "GuiaInvalida");
  }
}

export const ESTADO_GUIA = {
  BORRADOR: "borrador",
  ENVIADA: "enviada",
  ACEPTADA: "aceptada",
  RECHAZADA: "rechazada",
  ANULADA: "anulada",
} as const;

export type LineaGuiaEntrada = {
  productoId?: string;
  codigo?: string;
  descripcion?: string;
  unidad?: string;
  cantidad: string;
};

export type DatosGuia = {
  serie: string;
  fechaEmision: string;
  destinatarioId: string;
  /** Catálogo 20. */
  motivo: string;
  descripcionMotivo: string;
  pesoBruto: string;
  unidadPeso?: string;
  bultos?: number;
  /** Catálogo 18: "01" público, "02" privado. */
  modoTransporte: string;
  fechaTraslado: string;
  partida: { ubigeo: string; direccion: string; establecimiento?: string };
  llegada: { ubigeo: string; direccion: string; establecimiento?: string };
  transportistaId?: string;
  registroMtc?: string;
  placa?: string;
  conductor?: {
    tipoDocumento: string;
    numeroDocumento: string;
    nombres: string;
    apellidos: string;
    licencia: string;
  };
  comprobanteId?: string;
  almacenId?: string;
  observaciones?: string;
  lineas: LineaGuiaEntrada[];
};

export type GuiaEmitida = {
  guiaId: string;
  serie: string;
  numero: string;
};

/**
 * Emite la guía.
 *
 * Se valida contra el dominio antes de guardar: lo que SUNAT exige según la
 * modalidad de transporte y el motivo del traslado se comprueba aquí, no al
 * enviar. Descubrirlo en el envío significaría tener guardada una guía que
 * nunca podrá salir.
 */
export async function emitirGuia(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosGuia,
): Promise<GuiaEmitida> {
  const motivos: string[] = [];
  if (datos.lineas.length === 0) motivos.push("la guía necesita al menos un bien que trasladar");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEmision)) motivos.push("la fecha de emisión es inválida");
  if (motivos.length) throw new GuiaInvalida(motivos);

  const [destinatario] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, datos.destinatarioId))
    .limit(1);
  if (!destinatario) throw new GuiaInvalida(["el destinatario no existe en esta empresa"]);

  const transportista = datos.transportistaId
    ? (
        await db.select().from(terceros).where(eq(terceros.id, datos.transportistaId)).limit(1)
      )[0]
    : undefined;
  if (datos.transportistaId && !transportista) {
    throw new GuiaInvalida(["el transportista no existe en esta empresa"]);
  }

  const lineas = await resolverLineas(db, datos.lineas);
  const [emp] = await db.select().from(empresas).limit(1);
  if (!emp) throw new GuiaInvalida(["faltan los datos del emisor"]);

  const comprobante = datos.comprobanteId
    ? (
        await db
          .select({
            tipoDocumento: comprobantes.tipoDocumento,
            serie: comprobantes.serie,
            numero: comprobantes.numero,
          })
          .from(comprobantes)
          .where(eq(comprobantes.id, datos.comprobanteId))
          .limit(1)
      )[0]
    : undefined;

  const numero = await siguienteCorrelativo(db, "09", datos.serie);

  // El dominio decide si la guía es válida. Se arma el documento completo y se
  // valida antes de escribir nada.
  const documento: cpe.GuiaRemision = {
    serie: datos.serie,
    numero,
    fechaEmision: datos.fechaEmision,
    horaEmision: horaEnPeru(),
    tipoGuia: cpe.TIPO_GUIA.REMITENTE,
    emisor: { ruc: emp.ruc, razonSocial: emp.razonSocial },
    destinatario: {
      tipoDocumento: destinatario.tipoDocumento,
      numeroDocumento: destinatario.numeroDocumento,
      razonSocial: destinatario.razonSocial,
    },
    motivo: datos.motivo,
    descripcionMotivo: datos.descripcionMotivo,
    pesoBruto: dec(datos.pesoBruto),
    unidadPeso: datos.unidadPeso ?? "KGM",
    ...(datos.bultos ? { bultos: datos.bultos } : {}),
    modoTransporte: datos.modoTransporte,
    fechaTraslado: datos.fechaTraslado,
    partida: {
      ubigeo: datos.partida.ubigeo,
      direccion: datos.partida.direccion,
      ...(datos.partida.establecimiento
        ? { codigoEstablecimiento: datos.partida.establecimiento }
        : {}),
    },
    llegada: {
      ubigeo: datos.llegada.ubigeo,
      direccion: datos.llegada.direccion,
      ...(datos.llegada.establecimiento
        ? { codigoEstablecimiento: datos.llegada.establecimiento }
        : {}),
    },
    ...(transportista
      ? {
          transportista: {
            tipoDocumento: transportista.tipoDocumento,
            numeroDocumento: transportista.numeroDocumento,
            razonSocial: transportista.razonSocial,
            ...(datos.registroMtc ? { registroMtc: datos.registroMtc } : {}),
          },
        }
      : {}),
    ...(datos.placa ? { placa: datos.placa } : {}),
    ...(datos.conductor ? { conductor: datos.conductor } : {}),
    ...(comprobante
      ? {
          documentoRelacionado: {
            tipoDocumento: comprobante.tipoDocumento,
            serie: comprobante.serie,
            numero: comprobante.numero,
          },
        }
      : {}),
    lineas: lineas.map((l, i) => ({
      numero: i + 1,
      codigo: l.codigo,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: dec(l.cantidad),
    })),
    ...(datos.observaciones ? { observaciones: datos.observaciones } : {}),
  };

  const invalidez = cpe.validarGuia(documento);
  if (invalidez.length > 0) throw new GuiaInvalida(invalidez);

  const [cab] = await db
    .insert(guiasRemision)
    .values({
      empresaId,
      tipoGuia: cpe.TIPO_GUIA.REMITENTE,
      serie: datos.serie,
      numero,
      fechaEmision: datos.fechaEmision,
      horaEmision: documento.horaEmision ?? null,
      destinatarioId: datos.destinatarioId,
      motivo: datos.motivo,
      descripcionMotivo: datos.descripcionMotivo,
      pesoBruto: datos.pesoBruto,
      unidadPeso: datos.unidadPeso ?? "KGM",
      bultos: datos.bultos ?? null,
      modoTransporte: datos.modoTransporte,
      fechaTraslado: datos.fechaTraslado,
      partidaUbigeo: datos.partida.ubigeo,
      partidaDireccion: datos.partida.direccion,
      partidaEstablecimiento: datos.partida.establecimiento ?? null,
      llegadaUbigeo: datos.llegada.ubigeo,
      llegadaDireccion: datos.llegada.direccion,
      llegadaEstablecimiento: datos.llegada.establecimiento ?? null,
      transportistaId: datos.transportistaId ?? null,
      registroMtc: datos.registroMtc ?? null,
      placa: datos.placa ?? null,
      conductorTipoDoc: datos.conductor?.tipoDocumento ?? null,
      conductorNumDoc: datos.conductor?.numeroDocumento ?? null,
      conductorNombres: datos.conductor?.nombres ?? null,
      conductorApellidos: datos.conductor?.apellidos ?? null,
      conductorLicencia: datos.conductor?.licencia ?? null,
      comprobanteId: datos.comprobanteId ?? null,
      almacenId: datos.almacenId ?? null,
      observaciones: datos.observaciones ?? null,
      estado: ESTADO_GUIA.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: guiasRemision.id });

  await db.insert(guiaItems).values(
    lineas.map((l, i) => ({
      empresaId,
      guiaId: cab!.id,
      linea: i + 1,
      productoId: l.productoId ?? null,
      codigo: l.codigo,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
    })),
  );

  return { guiaId: cab!.id, serie: datos.serie, numero };
}

async function resolverLineas(db: Db, lineas: LineaGuiaEntrada[]) {
  const resueltas: {
    productoId?: string;
    codigo: string;
    descripcion: string;
    unidad: string;
    cantidad: string;
  }[] = [];

  for (const [i, l] of lineas.entries()) {
    if (!money.gt(dec(l.cantidad), money.ZERO)) {
      throw new GuiaInvalida([`línea ${i + 1}: la cantidad debe ser mayor que cero`]);
    }
    if (l.productoId) {
      const [p] = await db
        .select({
          codigo: productos.codigo,
          descripcion: productos.descripcion,
          unidad: unidadesMedida.codigo,
        })
        .from(productos)
        .leftJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
        .where(eq(productos.id, l.productoId))
        .limit(1);
      if (!p) throw new GuiaInvalida([`línea ${i + 1}: el producto no existe`]);
      resueltas.push({
        productoId: l.productoId,
        codigo: l.codigo ?? p.codigo,
        descripcion: l.descripcion ?? p.descripcion,
        unidad: l.unidad ?? p.unidad ?? "NIU",
        cantidad: l.cantidad,
      });
      continue;
    }
    if (!l.descripcion) {
      throw new GuiaInvalida([`línea ${i + 1}: indique un producto o una descripción`]);
    }
    resueltas.push({
      codigo: l.codigo ?? "SERV",
      descripcion: l.descripcion,
      unidad: l.unidad ?? "NIU",
      cantidad: l.cantidad,
    });
  }
  return resueltas;
}

async function siguienteCorrelativo(db: Db, tipo: string, serie: string): Promise<string> {
  const filas = (await db.execute(sql`
    UPDATE series_documento
    SET correlativo = correlativo + 1
    WHERE tipo_documento = ${tipo} AND serie = ${serie} AND activa
    RETURNING correlativo`)) as unknown as { correlativo: number }[];
  const fila = filas[0];
  if (!fila) {
    throw new GuiaInvalida([`la serie ${serie} no está registrada para guías de remisión`]);
  }
  return String(fila.correlativo).padStart(8, "0");
}

export type ResultadoGuia = {
  estado: string;
  ticket?: string;
  codigo?: string;
  mensaje?: string;
};

/**
 * Firma la guía y la envía por la API de la GRE.
 *
 * Tres fases, como todo lo que habla con SUNAT: leer y firmar, hablar, guardar.
 * El token se pide dentro de la fase 2 y se descarta al terminar: dura una hora
 * y guardarlo obligaría a cifrarlo y a vigilar su caducidad para no ganar nada.
 */
export async function enviarGuiaASunat(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  guiaId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpointToken?: string; endpointCpe?: string } = {},
): Promise<ResultadoGuia> {
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [g] = await db.select().from(guiasRemision).where(eq(guiasRemision.id, guiaId)).limit(1);
    if (!g) throw new GuiaInvalida(["la guía no existe"]);
    if (g.ticket) return { yaEnviada: { estado: g.estado, ticket: g.ticket } };

    const { certificado, credenciales } = await materialGre(db, ctx.empresaId, kek);
    const documento = await armarGuia(db, g);
    const xml = cpe.construirGuia(documento);
    const firmado = cpe.firmarXml(xml, certificado, { rucEsperado: credenciales.ruc });
    const hash = createHash("sha256").update(firmado).digest("hex");

    await db
      .update(guiasRemision)
      .set({ xmlFirmado: firmado, hashXml: hash })
      .where(eq(guiasRemision.id, guiaId));

    return {
      envio: {
        credenciales,
        firmado,
        nombre: cpe.nombreGuia(credenciales.ruc, {
          tipoGuia: g.tipoGuia,
          serie: g.serie,
          numero: g.numero,
        }),
      },
    };
  });

  if ("yaEnviada" in preparado) return preparado.yaEnviada;
  const { credenciales, firmado, nombre } = preparado.envio;

  let resultado: ResultadoGuia;
  try {
    const { token } = await cpe.obtenerToken(credenciales, opts);
    const { ticket } = await cpe.enviarGuia(token, nombre, firmado, opts);
    resultado = { estado: ESTADO_GUIA.ENVIADA, ticket };
  } catch (e) {
    if (!(e instanceof cpe.ErrorSunat) || e.reintentable) throw e;
    resultado = { estado: ESTADO_GUIA.RECHAZADA, codigo: String(e.codigo), mensaje: e.message };
  }

  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(guiasRemision)
      .set({
        estado: resultado.estado,
        ticket: resultado.ticket ?? null,
        codigoSunat: resultado.codigo ?? null,
        mensajeSunat: resultado.mensaje ?? null,
        enviadoEn: new Date(),
      })
      .where(eq(guiasRemision.id, guiaId)),
  );

  return resultado;
}

/** Recoge el resultado del ticket de la guía. */
export async function recogerTicketGuia(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  guiaId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpointToken?: string; endpointCpe?: string } = {},
): Promise<ResultadoGuia & { enProceso?: boolean }> {
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [g] = await db.select().from(guiasRemision).where(eq(guiasRemision.id, guiaId)).limit(1);
    if (!g) throw new GuiaInvalida(["la guía no existe"]);
    if (!g.ticket) throw new GuiaInvalida(["la guía todavía no se ha enviado"]);
    if (g.cdrBase64 || g.estado === ESTADO_GUIA.ACEPTADA) {
      return {
        yaResuelta: {
          estado: g.estado,
          codigo: g.codigoSunat ?? "0",
          mensaje: g.mensajeSunat ?? "",
        },
      };
    }
    const { credenciales } = await materialGre(db, ctx.empresaId, kek);
    return { consulta: { credenciales, ticket: g.ticket } };
  });

  if ("yaResuelta" in preparado) return preparado.yaResuelta;
  const { credenciales, ticket } = preparado.consulta;

  const { token } = await cpe.obtenerToken(credenciales, opts);
  const estado = await cpe.consultarEnvioGuia(token, ticket, opts);

  if (estado.enProceso) return { estado: ESTADO_GUIA.ENVIADA, ticket, enProceso: true };

  const resultado: ResultadoGuia = {
    estado: estado.aceptada ? ESTADO_GUIA.ACEPTADA : ESTADO_GUIA.RECHAZADA,
    codigo: estado.codigo,
    mensaje: estado.mensaje,
  };

  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(guiasRemision)
      .set({
        estado: resultado.estado,
        codigoSunat: resultado.codigo ?? null,
        mensajeSunat: resultado.mensaje ?? null,
        ...(estado.cdrZip ? { cdrBase64: Buffer.from(estado.cdrZip).toString("base64") } : {}),
      })
      .where(eq(guiasRemision.id, guiaId)),
  );

  return resultado;
}

/** Reconstruye el documento desde lo guardado. */
async function armarGuia(
  db: Db,
  g: typeof guiasRemision.$inferSelect,
): Promise<cpe.GuiaRemision> {
  const [emp] = await db.select().from(empresas).limit(1);
  const [dest] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, g.destinatarioId))
    .limit(1);
  if (!emp || !dest) throw new GuiaInvalida(["faltan datos del emisor o del destinatario"]);

  const transportista = g.transportistaId
    ? (await db.select().from(terceros).where(eq(terceros.id, g.transportistaId)).limit(1))[0]
    : undefined;

  const comprobante = g.comprobanteId
    ? (
        await db
          .select({
            tipoDocumento: comprobantes.tipoDocumento,
            serie: comprobantes.serie,
            numero: comprobantes.numero,
          })
          .from(comprobantes)
          .where(eq(comprobantes.id, g.comprobanteId))
          .limit(1)
      )[0]
    : undefined;

  const items = await db
    .select()
    .from(guiaItems)
    .where(eq(guiaItems.guiaId, g.id))
    .orderBy(guiaItems.linea);

  return {
    serie: g.serie,
    numero: g.numero,
    fechaEmision: g.fechaEmision,
    ...(g.horaEmision ? { horaEmision: g.horaEmision } : {}),
    tipoGuia: g.tipoGuia,
    emisor: { ruc: emp.ruc, razonSocial: emp.razonSocial },
    destinatario: {
      tipoDocumento: dest.tipoDocumento,
      numeroDocumento: dest.numeroDocumento,
      razonSocial: dest.razonSocial,
    },
    motivo: g.motivo,
    descripcionMotivo: g.descripcionMotivo,
    pesoBruto: dec(g.pesoBruto),
    unidadPeso: g.unidadPeso,
    ...(g.bultos ? { bultos: g.bultos } : {}),
    modoTransporte: g.modoTransporte,
    fechaTraslado: g.fechaTraslado,
    partida: {
      ubigeo: g.partidaUbigeo,
      direccion: g.partidaDireccion,
      ...(g.partidaEstablecimiento ? { codigoEstablecimiento: g.partidaEstablecimiento } : {}),
    },
    llegada: {
      ubigeo: g.llegadaUbigeo,
      direccion: g.llegadaDireccion,
      ...(g.llegadaEstablecimiento ? { codigoEstablecimiento: g.llegadaEstablecimiento } : {}),
    },
    ...(transportista
      ? {
          transportista: {
            tipoDocumento: transportista.tipoDocumento,
            numeroDocumento: transportista.numeroDocumento,
            razonSocial: transportista.razonSocial,
            ...(g.registroMtc ? { registroMtc: g.registroMtc } : {}),
          },
        }
      : {}),
    ...(g.placa ? { placa: g.placa } : {}),
    ...(g.conductorNumDoc
      ? {
          conductor: {
            tipoDocumento: g.conductorTipoDoc ?? "1",
            numeroDocumento: g.conductorNumDoc,
            nombres: g.conductorNombres ?? "",
            apellidos: g.conductorApellidos ?? "",
            licencia: g.conductorLicencia ?? "",
          },
        }
      : {}),
    ...(comprobante
      ? {
          documentoRelacionado: {
            tipoDocumento: comprobante.tipoDocumento,
            serie: comprobante.serie,
            numero: comprobante.numero,
          },
        }
      : {}),
    lineas: items.map((it) => ({
      numero: it.linea,
      codigo: it.codigo,
      descripcion: it.descripcion,
      unidad: it.unidad,
      cantidad: dec(it.cantidad),
    })),
    ...(g.observaciones ? { observaciones: g.observaciones } : {}),
  };
}

/**
 * Certificado y credenciales de la GRE.
 *
 * El certificado es el mismo de la facturación; las credenciales, no: la GRE
 * usa un `client_id` y un `client_secret` propios que se generan aparte.
 */
async function materialGre(db: Db, empresaId: string, kek: Uint8Array) {
  const [cert] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .orderBy(desc(certificadosDigitales.creadoEn))
    .limit(1);
  if (!cert) throw new GuiaInvalida(["esta empresa no tiene un certificado digital cargado"]);

  const [cred] = await db.select().from(credencialesSunat).limit(1);
  if (!cred) throw new GuiaInvalida(["faltan las credenciales SOL de esta empresa"]);
  if (!cred.greClientId || !cred.greClientSecretCifrado) {
    throw new GuiaInvalida([
      "faltan las credenciales de la API de guías (client_id y client_secret); se generan aparte en el menú SOL",
    ]);
  }

  const contexto = `empresa:${empresaId}:certificado`;
  const pfx = abrir(kek, cert.pfxCifrado as SobreCifrado, contexto);
  const password = new TextDecoder().decode(
    abrir(kek, cert.passwordCifrado as SobreCifrado, contexto),
  );
  const claveSol = new TextDecoder().decode(
    abrir(kek, cred.claveCifrada as SobreCifrado, `empresa:${empresaId}:sol`),
  );
  const clientSecret = new TextDecoder().decode(
    abrir(kek, cred.greClientSecretCifrado as SobreCifrado, `empresa:${empresaId}:gre`),
  );
  const [emp] = await db.select({ ruc: empresas.ruc }).from(empresas).limit(1);

  return {
    certificado: cpe.abrirPfx(pfx, password),
    credenciales: {
      ruc: emp?.ruc ?? "",
      usuarioSol: cred.usuarioSol,
      claveSol,
      clientId: cred.greClientId,
      clientSecret,
    },
  };
}

export const listarGuias = (db: Db) =>
  db
    .select({
      id: guiasRemision.id,
      serie: guiasRemision.serie,
      numero: guiasRemision.numero,
      fechaEmision: guiasRemision.fechaEmision,
      fechaTraslado: guiasRemision.fechaTraslado,
      motivo: guiasRemision.motivo,
      estado: guiasRemision.estado,
      ticket: guiasRemision.ticket,
      mensajeSunat: guiasRemision.mensajeSunat,
      destinatario: terceros.razonSocial,
    })
    .from(guiasRemision)
    .leftJoin(terceros, eq(terceros.id, guiasRemision.destinatarioId))
    .orderBy(desc(guiasRemision.fechaEmision), desc(guiasRemision.numero))
    .limit(200);

export async function cargarGuia(db: Db, id: string) {
  const [cabecera] = await db.select().from(guiasRemision).where(eq(guiasRemision.id, id)).limit(1);
  if (!cabecera) throw new GuiaInvalida(["la guía no existe"]);
  const items = await db
    .select()
    .from(guiaItems)
    .where(eq(guiaItems.guiaId, id))
    .orderBy(guiaItems.linea);
  const [destinatario] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, cabecera.destinatarioId))
    .limit(1);
  return { cabecera, items, destinatario };
}

/** Dirección del almacén, para proponerla como punto de partida. */
export const puntosDePartida = (db: Db) =>
  db
    .select({
      almacenId: almacenes.id,
      nombre: almacenes.nombre,
      ubigeo: sucursales.ubigeo,
      direccion: sucursales.direccion,
      establecimiento: sucursales.codigoSunat,
    })
    .from(almacenes)
    .leftJoin(sucursales, eq(sucursales.id, almacenes.sucursalId))
    .where(eq(almacenes.activo, true));

/** Series activas de guía de remisión. */
export const seriesDeGuia = (db: Db) =>
  db
    .select({ serie: seriesDocumento.serie })
    .from(seriesDocumento)
    .where(eq(seriesDocumento.tipoDocumento, "09"));
