/**
 * Resúmenes diarios de boletas y comunicaciones de baja.
 *
 * Las boletas no se envían de una en una: se agrupan por día en un resumen. Las
 * facturas sí se envían sueltas, pero para anular una ya aceptada hace falta
 * una comunicación de baja. Los dos documentos viajan por `sendSummary`, que no
 * devuelve el CDR sino un ticket; el resultado se recoge después.
 *
 * Ese diferido gobierna el diseño del módulo: generar, enviar y recoger son
 * tres operaciones distintas, y entre la segunda y la tercera puede pasar un
 * minuto o una hora. Nada de eso ocurre dentro de la transacción de quien
 * llama.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { money, cpe } from "@roulterp/core";
import { abrir, type SobreCifrado } from "@roulterp/core/auth";
import { enEmpresa, schema as s, type Conexion, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";
import { hoyEnPeru } from "@roulterp/core/fecha";

const {
  resumenes, resumenItems, comprobantes, empresas,
  certificadosDigitales, credencialesSunat,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");

export class ResumenInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "ResumenInvalido");
  }
}

/** Estados por los que pasa un resumen. Los mismos nombres que un comprobante. */
export const ESTADO_RESUMEN_DOC = {
  BORRADOR: "borrador",
  ENVIADO: "enviado",
  ACEPTADO: "aceptado",
  ACEPTADO_CON_OBSERVACIONES: "aceptado_con_observaciones",
  RECHAZADO: "rechazado",
} as const;

/**
 * Boletas y sus notas pendientes de resumir, de un día concreto.
 *
 * Sólo entran los comprobantes en borrador: los que ya están en un resumen
 * enviado tienen estado propio y volver a informarlos duplicaría la venta.
 */
export async function boletasPendientes(db: Db, fecha: string) {
  const filas = (await db.execute(sql`
    SELECT c.id, c.tipo_documento, c.serie, c.numero, c.total::text AS total,
           c.moneda, c.estado, t.razon_social
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    WHERE c.fecha_emision = ${fecha}
      AND c.tipo_documento IN ('03', '07', '08')
      AND c.estado = 'borrador'
      AND NOT EXISTS (
        SELECT 1 FROM resumen_items ri
        JOIN resumenes r ON r.id = ri.resumen_id
        WHERE ri.comprobante_id = c.id AND r.estado <> 'rechazado')
    ORDER BY c.serie, c.numero`)) as unknown as {
    id: string; tipo_documento: string; serie: string; numero: string;
    total: string; moneda: string; estado: string; razon_social: string;
  }[];
  return [...filas];
}

/**
 * Correlativo del resumen dentro del día.
 *
 * SUNAT numera los resúmenes por día de emisión, no por día resumido: dos
 * resúmenes enviados el mismo día son el 1 y el 2 aunque informen días
 * distintos.
 */
async function siguienteCorrelativo(db: Db, tipo: string, fechaEmision: string): Promise<number> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(max(correlativo), 0) + 1 AS siguiente
    FROM resumenes
    WHERE tipo = ${tipo} AND fecha_emision = ${fechaEmision}`)) as unknown as [
    { siguiente: number },
  ];
  return fila!.siguiente;
}

export type ResumenGenerado = {
  resumenId: string;
  identificador: string;
  comprobantes: number;
};

/**
 * Genera el resumen diario de las boletas de un día.
 *
 * Se genera pero no se envía: enviarlo es un acto aparte, porque implica hablar
 * con SUNAT y eso no puede ocurrir dentro de la transacción que crea el
 * resumen.
 */
export async function generarResumenDiario(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { fechaReferencia: string; fechaEmision?: string },
): Promise<ResumenGenerado> {
  const fechaEmision = datos.fechaEmision ?? hoyEnPeru();
  if (fechaEmision < datos.fechaReferencia) {
    throw new ResumenInvalido([
      "la fecha del resumen no puede ser anterior al día que resume",
    ]);
  }

  const pendientes = await boletasPendientes(db, datos.fechaReferencia);
  if (pendientes.length === 0) {
    throw new ResumenInvalido([`no hay boletas sin resumir del ${datos.fechaReferencia}`]);
  }

  const correlativo = await siguienteCorrelativo(db, "RC", fechaEmision);
  const identificador = cpe.idResumen("RC", fechaEmision, correlativo);

  const [cab] = await db
    .insert(resumenes)
    .values({
      empresaId,
      tipo: "RC",
      identificador,
      fechaReferencia: datos.fechaReferencia,
      fechaEmision,
      correlativo,
      estado: ESTADO_RESUMEN_DOC.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: resumenes.id });

  await db.insert(resumenItems).values(
    pendientes.map((p, i) => ({
      empresaId,
      resumenId: cab!.id,
      comprobanteId: p.id,
      linea: i + 1,
      // Todo lo que entra por aquí es alta: una anulación se informa por
      // `anularEnResumen`, que marca el comprobante antes de generarlo.
      estadoItem: cpe.ESTADO_RESUMEN.ADICIONAR,
    })),
  );

  return { resumenId: cab!.id, identificador, comprobantes: pendientes.length };
}

/**
 * Genera la comunicación de baja de facturas ya aceptadas.
 *
 * Sólo facturas y notas: una boleta se anula dentro de su resumen diario, y
 * mandarla por aquí es el error más repetido con estos documentos.
 */
export async function generarComunicacionBaja(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    comprobantes: { comprobanteId: string; motivo: string }[];
    fechaEmision?: string;
  },
): Promise<ResumenGenerado> {
  if (datos.comprobantes.length === 0) {
    throw new ResumenInvalido(["indique al menos un comprobante que dar de baja"]);
  }

  const ids = datos.comprobantes.map((c) => c.comprobanteId);
  const docs = await db.select().from(comprobantes).where(inArray(comprobantes.id, ids));

  const motivos: string[] = [];
  for (const d of docs) {
    if (d.tipoDocumento === cpe.TIPO_DOCUMENTO.BOLETA) {
      motivos.push(
        `${d.serie}-${d.numero} es una boleta: se anula en su resumen diario, no por comunicación de baja`,
      );
    }
    if (
      d.estado !== cpe.ESTADO_CPE.ACEPTADO &&
      d.estado !== cpe.ESTADO_CPE.ACEPTADO_CON_OBSERVACIONES
    ) {
      motivos.push(`${d.serie}-${d.numero} no está aceptado por SUNAT; no hay nada que dar de baja`);
    }
  }
  if (docs.length !== ids.length) motivos.push("algún comprobante no existe en esta empresa");
  for (const c of datos.comprobantes) {
    if (!c.motivo.trim()) motivos.push("cada baja necesita un motivo; SUNAT lo lee");
  }
  if (motivos.length > 0) throw new ResumenInvalido(motivos);

  // La fecha de referencia es la de emisión de los comprobantes, y SUNAT exige
  // que todos los de una misma comunicación sean del mismo día.
  const dias = [...new Set(docs.map((d) => d.fechaEmision))];
  if (dias.length > 1) {
    throw new ResumenInvalido([
      `una comunicación de baja agrupa comprobantes de un solo día; hay de ${dias.length}`,
    ]);
  }

  const fechaEmision = datos.fechaEmision ?? hoyEnPeru();
  const correlativo = await siguienteCorrelativo(db, "RA", fechaEmision);
  const identificador = cpe.idResumen("RA", fechaEmision, correlativo);

  const [cab] = await db
    .insert(resumenes)
    .values({
      empresaId,
      tipo: "RA",
      identificador,
      fechaReferencia: dias[0]!,
      fechaEmision,
      correlativo,
      estado: ESTADO_RESUMEN_DOC.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: resumenes.id });

  await db.insert(resumenItems).values(
    datos.comprobantes.map((c, i) => ({
      empresaId,
      resumenId: cab!.id,
      comprobanteId: c.comprobanteId,
      linea: i + 1,
      estadoItem: cpe.ESTADO_RESUMEN.ANULAR,
      motivo: c.motivo.trim(),
    })),
  );

  // El comprobante queda marcado en cuanto se pide la baja. Si se esperara al
  // CDR, alguien podría cobrarlo mientras SUNAT contesta.
  await db
    .update(comprobantes)
    .set({ estado: cpe.ESTADO_CPE.BAJA_SOLICITADA })
    .where(inArray(comprobantes.id, ids));

  return { resumenId: cab!.id, identificador, comprobantes: datos.comprobantes.length };
}

export type ResultadoResumen = {
  estado: string;
  ticket?: string;
  codigo?: number;
  mensaje?: string;
  observaciones?: string[];
};

/**
 * Firma el resumen y lo envía a SUNAT.
 *
 * Tres fases, como el envío de un comprobante y por las mismas razones: leer y
 * firmar en su transacción, hablar con SUNAT sin ninguna abierta, y guardar el
 * ticket en otra. Aquí no llega el CDR: llega un ticket, y el resultado se
 * recoge con `recogerTicket`.
 */
export async function enviarResumenASunat(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  resumenId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<ResultadoResumen> {
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [r] = await db.select().from(resumenes).where(eq(resumenes.id, resumenId)).limit(1);
    if (!r) throw new ResumenInvalido(["el resumen no existe"]);
    if (r.ticket) {
      return { yaEnviado: { estado: r.estado, ticket: r.ticket } };
    }

    const { certificado, credenciales, entorno } = await materialDeFirma(db, ctx.empresaId, kek);
    const xml =
      r.tipo === "RC"
        ? cpe.construirResumenDiario(await armarResumen(db, r))
        : cpe.construirComunicacionBaja(await armarBaja(db, r));

    const firmado = cpe.firmarXml(xml, certificado, { rucEsperado: credenciales.ruc });
    const hash = createHash("sha256").update(firmado).digest("hex");

    await db
      .update(resumenes)
      .set({ xmlFirmado: firmado, hashXml: hash })
      .where(eq(resumenes.id, resumenId));

    return {
      envio: {
        credenciales,
        firmado,
        entorno,
        nombre: cpe.nombreResumen(credenciales.ruc, r.identificador),
      },
    };
  });

  if ("yaEnviado" in preparado) return preparado.yaEnviado;
  const { credenciales, firmado, entorno, nombre } = preparado.envio;

  let resultado: ResultadoResumen;
  try {
    const { ticket } = await cpe.enviarResumen(credenciales, nombre, firmado, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      endpoint:
        opts.endpoint ?? (entorno === "produccion" ? cpe.ENDPOINT_PRODUCCION : cpe.ENDPOINT_BETA),
    });
    resultado = { estado: ESTADO_RESUMEN_DOC.ENVIADO, ticket };
  } catch (e) {
    if (!(e instanceof cpe.ErrorSunat)) throw e;
    // Un fallo reintentable no deja nada que guardar: el resumen sigue como
    // estaba y se vuelve a intentar.
    if (e.reintentable) throw e;
    resultado = {
      estado: ESTADO_RESUMEN_DOC.RECHAZADO,
      codigo: e.codigo,
      mensaje: e.message,
      observaciones: [],
    };
  }

  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(resumenes)
      .set({
        estado: resultado.estado,
        ...(resultado.ticket ? { ticket: resultado.ticket } : {}),
        ...(resultado.codigo !== undefined ? { codigoSunat: resultado.codigo } : {}),
        ...(resultado.mensaje ? { mensajeSunat: resultado.mensaje } : {}),
        enviadoEn: new Date(),
      })
      .where(eq(resumenes.id, resumenId)),
  );

  return resultado;
}

/**
 * Recoge el resultado de un ticket.
 *
 * SUNAT responde 98 mientras procesa. Eso no es un error ni un rechazo: es que
 * todavía no ha terminado, y hay que volver a preguntar. Se devuelve tal cual
 * para que quien llama decida cuándo reintentar.
 */
export async function recogerTicket(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  resumenId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<ResultadoResumen & { enProceso?: boolean }> {
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [r] = await db.select().from(resumenes).where(eq(resumenes.id, resumenId)).limit(1);
    if (!r) throw new ResumenInvalido(["el resumen no existe"]);
    if (!r.ticket) throw new ResumenInvalido(["el resumen todavía no se ha enviado"]);
    if (r.cdrBase64) {
      return {
        yaResuelto: {
          estado: r.estado,
          codigo: r.codigoSunat ?? 0,
          mensaje: r.mensajeSunat ?? "",
          observaciones: r.observacionesSunat ?? [],
        },
      };
    }
    const { credenciales, entorno } = await materialDeFirma(db, ctx.empresaId, kek);
    return { consulta: { credenciales, entorno, ticket: r.ticket, tipo: r.tipo } };
  });

  if ("yaResuelto" in preparado) return preparado.yaResuelto;
  const { credenciales, entorno, ticket, tipo } = preparado.consulta;

  // Un rechazo llega como excepción desde `leerCdr`, pero aquí es un desenlace
  // legítimo que hay que registrar: si se dejara escapar, el resumen se
  // quedaría «enviado» para siempre y nadie sabría que SUNAT lo rechazó.
  let respuesta: Awaited<ReturnType<typeof cpe.consultarTicket>>;
  let resultado: ResultadoResumen;
  try {
    respuesta = await cpe.consultarTicket(credenciales, ticket, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      endpoint:
        opts.endpoint ?? (entorno === "produccion" ? cpe.ENDPOINT_PRODUCCION : cpe.ENDPOINT_BETA),
    });
  } catch (e) {
    if (!(e instanceof cpe.ErrorSunat) || e.reintentable) throw e;
    await guardarDesenlace(conexion, ctx, resumenId, tipo, {
      estado: ESTADO_RESUMEN_DOC.RECHAZADO,
      codigo: e.codigo,
      mensaje: e.message,
      observaciones: [],
    });
    return { estado: ESTADO_RESUMEN_DOC.RECHAZADO, codigo: e.codigo, mensaje: e.message };
  }

  if ("enProceso" in respuesta) {
    return { estado: ESTADO_RESUMEN_DOC.ENVIADO, ticket, enProceso: true };
  }

  resultado = {
    estado: respuesta.estado,
    codigo: respuesta.codigo,
    mensaje: respuesta.descripcion,
    observaciones: respuesta.observaciones,
  };

  await guardarDesenlace(conexion, ctx, resumenId, tipo, resultado, respuesta.cdrZip);
  return resultado;
}

/**
 * Guarda el desenlace del resumen y lo propaga a sus comprobantes.
 *
 * El desenlace del resumen es el de cada comprobante que agrupa: aceptado el
 * resumen, la boleta está declarada; rechazado, no lo está. Dejarlas en
 * borrador tras un resumen aceptado haría creer al contribuyente que declaró
 * algo que no declaró.
 */
async function guardarDesenlace(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  resumenId: string,
  tipo: string,
  resultado: ResultadoResumen,
  cdrZip?: Uint8Array,
): Promise<void> {
  await enEmpresa(conexion, ctx, async (db) => {
    await db
      .update(resumenes)
      .set({
        estado: resultado.estado,
        codigoSunat: resultado.codigo ?? null,
        mensajeSunat: resultado.mensaje ?? null,
        observacionesSunat: resultado.observaciones ?? [],
        ...(cdrZip ? { cdrBase64: Buffer.from(cdrZip).toString("base64") } : {}),
      })
      .where(eq(resumenes.id, resumenId));

    const aceptado =
      resultado.estado === ESTADO_RESUMEN_DOC.ACEPTADO ||
      resultado.estado === ESTADO_RESUMEN_DOC.ACEPTADO_CON_OBSERVACIONES;

    const items = await db
      .select({ comprobanteId: resumenItems.comprobanteId })
      .from(resumenItems)
      .where(eq(resumenItems.resumenId, resumenId));
    const ids = items.map((i) => i.comprobanteId).filter((i): i is string => !!i);
    if (ids.length === 0) return;

    // Rechazada una baja, la factura sigue existiendo para SUNAT: tiene que
    // volver a estar vigente aquí, no quedarse en «baja solicitada».
    const nuevoEstado =
      tipo === "RA"
        ? aceptado
          ? cpe.ESTADO_CPE.DADO_DE_BAJA
          : cpe.ESTADO_CPE.ACEPTADO
        : aceptado
          ? resultado.estado
          : cpe.ESTADO_CPE.RECHAZADO;

    await db
      .update(comprobantes)
      .set({
        estado: nuevoEstado,
        codigoSunat: resultado.codigo ?? null,
        mensajeSunat: resultado.mensaje ?? null,
      })
      .where(inArray(comprobantes.id, ids));
  });
}

/** Arma el resumen diario a partir de lo guardado. */
async function armarResumen(db: Db, r: typeof resumenes.$inferSelect): Promise<cpe.ResumenDiario> {
  const [emp] = await db.select().from(empresas).limit(1);
  if (!emp) throw new ResumenInvalido(["faltan los datos del emisor"]);

  const filas = (await db.execute(sql`
    SELECT ri.estado_item, c.tipo_documento, c.serie, c.numero, c.moneda,
           c.total::text AS total, c.gravadas::text AS gravadas,
           c.exoneradas::text AS exoneradas, c.inafectas::text AS inafectas,
           c.exportacion::text AS exportacion, c.gratuitas::text AS gratuitas,
           c.isc::text AS isc, c.igv::text AS igv, c.otros_cargos::text AS otros_cargos,
           t.tipo_documento AS tipo_doc_cliente, t.numero_documento AS num_doc_cliente,
           o.tipo_documento AS tipo_original, o.serie AS serie_original,
           o.numero AS numero_original
    FROM resumen_items ri
    JOIN comprobantes c ON c.id = ri.comprobante_id
    JOIN terceros t ON t.id = c.cliente_id
    LEFT JOIN comprobantes o ON o.id = c.modifica_a
    WHERE ri.resumen_id = ${r.id}
    ORDER BY ri.linea`)) as unknown as {
    estado_item: string; tipo_documento: string; serie: string; numero: string;
    moneda: string; total: string; gravadas: string; exoneradas: string;
    inafectas: string; exportacion: string; gratuitas: string; isc: string;
    igv: string; otros_cargos: string;
    tipo_doc_cliente: string; num_doc_cliente: string;
    tipo_original: string | null; serie_original: string | null;
    numero_original: string | null;
  }[];

  return {
    emisor: emisorDe(emp),
    fechaReferencia: r.fechaReferencia,
    fechaEmision: r.fechaEmision,
    correlativo: r.correlativo,
    items: [...filas].map((f) => ({
      tipoDocumento: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      estado: f.estado_item,
      receptor: { tipoDocumento: f.tipo_doc_cliente, numeroDocumento: f.num_doc_cliente },
      moneda: f.moneda,
      total: dec(f.total),
      gravadas: dec(f.gravadas),
      exoneradas: dec(f.exoneradas),
      inafectas: dec(f.inafectas),
      exportacion: dec(f.exportacion),
      gratuitas: dec(f.gratuitas),
      isc: dec(f.isc),
      igv: dec(f.igv),
      otrosCargos: dec(f.otros_cargos),
      ...(f.tipo_original
        ? {
            documentoModificado: {
              tipoDocumento: f.tipo_original,
              serie: f.serie_original!,
              numero: f.numero_original!,
            },
          }
        : {}),
    })),
  };
}

async function armarBaja(db: Db, r: typeof resumenes.$inferSelect): Promise<cpe.ComunicacionBaja> {
  const [emp] = await db.select().from(empresas).limit(1);
  if (!emp) throw new ResumenInvalido(["faltan los datos del emisor"]);

  const filas = (await db.execute(sql`
    SELECT ri.motivo, c.tipo_documento, c.serie, c.numero
    FROM resumen_items ri
    JOIN comprobantes c ON c.id = ri.comprobante_id
    WHERE ri.resumen_id = ${r.id}
    ORDER BY ri.linea`)) as unknown as {
    motivo: string | null; tipo_documento: string; serie: string; numero: string;
  }[];

  return {
    emisor: emisorDe(emp),
    fechaReferencia: r.fechaReferencia,
    fechaEmision: r.fechaEmision,
    correlativo: r.correlativo,
    items: [...filas].map((f) => ({
      tipoDocumento: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      motivo: f.motivo ?? "Anulación de la operación",
    })),
  };
}

const emisorDe = (emp: typeof empresas.$inferSelect): cpe.Emisor => ({
  ruc: emp.ruc,
  razonSocial: emp.razonSocial,
  ...(emp.nombreComercial ? { nombreComercial: emp.nombreComercial } : {}),
  ...(emp.ubigeo ? { ubigeo: emp.ubigeo } : {}),
  ...(emp.direccion ? { direccion: emp.direccion } : {}),
});

/** Igual que en ventas: los secretos se descifran, se usan y se descartan. */
async function materialDeFirma(db: Db, empresaId: string, kek: Uint8Array) {
  const [cert] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .orderBy(desc(certificadosDigitales.creadoEn))
    .limit(1);
  if (!cert) throw new ResumenInvalido(["esta empresa no tiene un certificado digital cargado"]);

  const [cred] = await db.select().from(credencialesSunat).limit(1);
  if (!cred) throw new ResumenInvalido(["faltan las credenciales SOL de esta empresa"]);

  const contexto = `empresa:${empresaId}:certificado`;
  const pfx = abrir(kek, cert.pfxCifrado as SobreCifrado, contexto);
  const password = new TextDecoder().decode(
    abrir(kek, cert.passwordCifrado as SobreCifrado, contexto),
  );
  const claveSol = new TextDecoder().decode(
    abrir(kek, cred.claveCifrada as SobreCifrado, `empresa:${empresaId}:sol`),
  );
  const [emp] = await db.select({ ruc: empresas.ruc }).from(empresas).limit(1);

  return {
    certificado: cpe.abrirPfx(pfx, password),
    credenciales: { ruc: emp?.ruc ?? "", usuarioSol: cred.usuarioSol, claveSol },
    entorno: cred.entorno,
  };
}

/** Resúmenes de la empresa, del más reciente al más antiguo. */
export const listarResumenes = (db: Db, tipo?: string) =>
  db
    .select()
    .from(resumenes)
    .where(tipo ? eq(resumenes.tipo, tipo) : undefined)
    .orderBy(desc(resumenes.fechaEmision), desc(resumenes.correlativo))
    .limit(100);

export async function cargarResumen(db: Db, id: string) {
  const [cabecera] = await db.select().from(resumenes).where(eq(resumenes.id, id)).limit(1);
  if (!cabecera) throw new ResumenInvalido(["el resumen no existe"]);
  const items = (await db.execute(sql`
    SELECT ri.linea, ri.estado_item, ri.motivo,
           c.id AS comprobante_id, c.tipo_documento, c.serie, c.numero,
           c.total::text AS total, c.moneda, c.estado
    FROM resumen_items ri
    LEFT JOIN comprobantes c ON c.id = ri.comprobante_id
    WHERE ri.resumen_id = ${id}
    ORDER BY ri.linea`)) as unknown as {
    linea: number; estado_item: string; motivo: string | null;
    comprobante_id: string | null; tipo_documento: string; serie: string;
    numero: string; total: string; moneda: string; estado: string;
  }[];
  return { cabecera, items: [...items] };
}

/** Días con boletas todavía sin resumir. Es la cola de trabajo del módulo. */
export async function diasPendientesDeResumen(db: Db) {
  const filas = (await db.execute(sql`
    SELECT c.fecha_emision::text AS fecha, count(*)::int AS boletas,
           sum(c.total)::text AS total
    FROM comprobantes c
    WHERE c.tipo_documento IN ('03', '07', '08')
      AND c.estado = 'borrador'
      AND NOT EXISTS (
        SELECT 1 FROM resumen_items ri
        JOIN resumenes r ON r.id = ri.resumen_id
        WHERE ri.comprobante_id = c.id AND r.estado <> 'rechazado')
    GROUP BY c.fecha_emision
    ORDER BY c.fecha_emision DESC
    LIMIT 60`)) as unknown as { fecha: string; boletas: number; total: string }[];
  return [...filas];
}
