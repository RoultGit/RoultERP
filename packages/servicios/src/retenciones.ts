/**
 * Comprobantes de retención y de percepción.
 *
 * Los dos nacen de un hecho que ya ocurrió: la retención, de un pago en el que
 * se retuvo; la percepción, de una venta que llevaba percepción y que ya se
 * cobró. Por eso no se capturan a mano —se generan a partir del pago o de la
 * cobranza— y por eso el importe no se recalcula aquí: se toma el que se
 * registró entonces, que es el que el proveedor o el cliente vio.
 *
 * El envío es el mismo `sendBill` de la factura: llega el CDR en el acto, sin
 * ticket de por medio.
 */
import { desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { money, cpe, tributario } from "@roulterp/core";
import { abrir, type SobreCifrado } from "@roulterp/core/auth";
import { enEmpresa, schema as s, type Conexion, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";
import { horaEnPeru } from "@roulterp/core/fecha";

const {
  comprobantesRetencion, retencionItems, pagos, letraPagos, letras, cobranzas, terceros, empresas,
  certificadosDigitales, credencialesSunat,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class RetencionInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "RetencionInvalida");
  }
}

export const TIPO_RETENCION = "20";
export const TIPO_PERCEPCION = "40";

export type RetencionEmitida = {
  id: string;
  serie: string;
  numero: string;
  importeTotal: string;
};

/**
 * Emite el comprobante de retención de un pago.
 *
 * El pago tiene que haber retenido algo: si no retuvo, no hay comprobante que
 * emitir, y forzarlo declararía ante SUNAT una retención que nunca ocurrió.
 */
export async function emitirRetencionDePago(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { pagoId: string; serie: string; fechaEmision?: string; observacion?: string },
): Promise<RetencionEmitida> {
  const [pago] = await db.select().from(pagos).where(eq(pagos.id, datos.pagoId)).limit(1);
  if (!pago) throw new RetencionInvalida(["el pago no existe"]);
  if (pago.estado !== "registrado") {
    throw new RetencionInvalida([`el pago está ${pago.estado}; no procede emitir la retención`]);
  }

  const retenido = dec(pago.retencionMonto);
  if (money.isZero(retenido)) {
    throw new RetencionInvalida(["este pago no retuvo nada; no hay comprobante que emitir"]);
  }

  const yaEmitido = await existeParaOrigen(db, "pago", datos.pagoId);
  if (yaEmitido) {
    throw new RetencionInvalida([`el pago ${pago.numero} ya tiene su comprobante de retención`]);
  }

  const [proveedor] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, pago.proveedorId))
    .limit(1);
  if (!proveedor) throw new RetencionInvalida(["el proveedor no existe"]);

  const aplicaciones = (await db.execute(sql`
    SELECT pa.importe_aplicado::text AS aplicado,
           d.id AS documento_id, d.tipo_documento, d.serie, d.numero,
           d.fecha_emision::text AS fecha_emision, d.moneda,
           d.total::text AS total
    FROM pago_aplicaciones pa
    JOIN documentos_cxp d ON d.id = pa.documento_id
    WHERE pa.pago_id = ${datos.pagoId}
    ORDER BY d.fecha_emision, d.serie, d.numero`)) as unknown as {
    aplicado: string; documento_id: string; tipo_documento: string;
    serie: string; numero: string; fecha_emision: string; moneda: string; total: string;
  }[];

  if (aplicaciones.length === 0) {
    throw new RetencionInvalida(["el pago no tiene documentos aplicados"]);
  }

  const tipoCambio = dec(pago.tipoCambio);
  const bruto = dec(pago.importeBruto);

  // La retención se repartió sobre el bruto del pago; aquí se distribuye entre
  // los documentos con el mismo criterio y sin perder un céntimo.
  const pesos = [...aplicaciones].map((a) => dec(a.aplicado));
  const repartido = money.distribute(retenido, pesos, 2);

  const fechaEmision = datos.fechaEmision ?? pago.fecha;
  const numero = await siguienteCorrelativo(db, TIPO_RETENCION, datos.serie);

  const items = [...aplicaciones].map((a, i) => {
    const aplicado = dec(a.aplicado);
    const importe = repartido[i]!;
    // Todo lo que se declara va en soles; lo pagado puede estar en dólares.
    const pagadoEnSoles = money.round(money.mul(aplicado, tipoCambio), 2);
    return {
      documentoCxpId: a.documento_id,
      tipoDocumento: a.tipo_documento,
      serie: a.serie,
      numero: a.numero,
      fechaDocumento: a.fecha_emision,
      moneda: a.moneda,
      totalDocumento: a.total,
      importePagado: txt2(aplicado),
      importe: txt2(importe),
      neto: txt2(money.sub(pagadoEnSoles, importe)),
      fecha: pago.fecha,
      tipoCambio: a.moneda === "PEN" ? null : pago.tipoCambio,
    };
  });

  const importeOperacion = money.round(money.mul(bruto, tipoCambio), 2);

  return guardar(db, empresaId, usuarioId, {
    tipoDocumento: TIPO_RETENCION,
    serie: datos.serie,
    numero,
    fechaEmision,
    terceroId: pago.proveedorId,
    regimen: cpe.REGIMEN_RETENCION.TASA_3,
    tasa: money.toString(tributario.TASA_RETENCION, 6),
    importeTotal: txt2(retenido),
    importeOperacion: txt2(importeOperacion),
    ...(datos.observacion ? { observacion: datos.observacion } : {}),
    items: items.map((it) => ({ ...it, pagoId: datos.pagoId })),
  });
}

/**
 * Emite el comprobante de retención del pago de una letra.
 *
 * La norma es clara con las letras: cuando la deuda se canjeó por una, la
 * retención no se hace al canjear —ahí no se pagó nada— sino al vencimiento o
 * cuando la letra se hace efectiva, lo que ocurra primero. Por eso el
 * comprobante nace del pago de la letra y no del canje.
 *
 * Los documentos que lista son **las facturas que se canjearon**, que son las
 * que el proveedor tiene que ver acreditadas: la letra es la forma de la deuda,
 * no su origen. Lo retenido se reparte entre ellas en proporción a lo que cada
 * una aportó a la letra, y por reparto exacto: no se pierde un céntimo.
 */
export async function emitirRetencionDeLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { letraPagoId: string; serie: string; fechaEmision?: string; observacion?: string },
): Promise<RetencionEmitida> {
  const [pago] = await db
    .select()
    .from(letraPagos)
    .where(eq(letraPagos.id, datos.letraPagoId))
    .limit(1);
  if (!pago) throw new RetencionInvalida(["el pago de la letra no existe"]);

  const retenido = dec(pago.retencionMonto);
  if (money.isZero(retenido)) {
    throw new RetencionInvalida(["este pago no retuvo nada; no hay comprobante que emitir"]);
  }

  if (await existeParaOrigen(db, "letra_pago", datos.letraPagoId)) {
    throw new RetencionInvalida(["este pago de letra ya tiene su comprobante de retención"]);
  }

  const [letra] = await db.select().from(letras).where(eq(letras.id, pago.letraId)).limit(1);
  if (!letra) throw new RetencionInvalida(["la letra no existe"]);

  const canjeados = (await db.execute(sql`
    SELECT ld.importe::text AS aportado,
           d.id AS documento_id, d.tipo_documento, d.serie, d.numero,
           d.fecha_emision::text AS fecha_emision, d.moneda, d.total::text AS total
    FROM letra_documentos ld
    JOIN documentos_cxp d ON d.id = ld.documento_id
    WHERE ld.letra_id = ${pago.letraId}
    ORDER BY d.fecha_emision, d.serie, d.numero`)) as unknown as {
    aportado: string; documento_id: string; tipo_documento: string;
    serie: string; numero: string; fecha_emision: string; moneda: string; total: string;
  }[];

  if (canjeados.length === 0) {
    throw new RetencionInvalida([
      "la letra no tiene facturas canjeadas: no hay documentos que acreditar en el comprobante",
    ]);
  }

  const tipoCambio = dec(pago.tipoCambio);
  const importePagado = dec(pago.importe);
  const aportes = [...canjeados].map((c) => dec(c.aportado));

  // Lo retenido y lo pagado se reparten con el mismo criterio y por reparto de
  // resto mayor: sumados tienen que dar exactamente el total, no «casi».
  const repartoRetencion = money.distribute(retenido, aportes, 2);
  const repartoPagado = money.distribute(importePagado, aportes, 2);

  const items = [...canjeados].map((c, i) => {
    const pagadoDoc = repartoPagado[i]!;
    const importe = repartoRetencion[i]!;
    const pagadoEnSoles = money.round(money.mul(pagadoDoc, tipoCambio), 2);
    return {
      documentoCxpId: c.documento_id,
      letraPagoId: datos.letraPagoId,
      tipoDocumento: c.tipo_documento,
      serie: c.serie,
      numero: c.numero,
      fechaDocumento: c.fecha_emision,
      moneda: c.moneda,
      totalDocumento: c.total,
      importePagado: txt2(pagadoDoc),
      importe: txt2(importe),
      neto: txt2(money.sub(pagadoEnSoles, importe)),
      fecha: pago.fecha,
      tipoCambio: c.moneda === "PEN" ? null : pago.tipoCambio,
    };
  });

  const numero = await siguienteCorrelativo(db, TIPO_RETENCION, datos.serie);
  const importeOperacion = money.round(money.mul(importePagado, tipoCambio), 2);

  return guardar(db, empresaId, usuarioId, {
    tipoDocumento: TIPO_RETENCION,
    serie: datos.serie,
    numero,
    fechaEmision: datos.fechaEmision ?? pago.fecha,
    terceroId: letra.terceroId,
    regimen: cpe.REGIMEN_RETENCION.TASA_3,
    tasa: money.toString(tributario.TASA_RETENCION, 6),
    importeTotal: txt2(retenido),
    importeOperacion: txt2(importeOperacion),
    observacion: datos.observacion ?? `Pago de la letra ${letra.numero}`,
    items,
  });
}

/**
 * Emite el comprobante de percepción de una cobranza.
 *
 * La percepción se cobró al emitir el comprobante de venta —viene en su campo
 * `percepcion_monto`— y se documenta cuando el cliente paga. Sólo entran los
 * comprobantes de la cobranza que llevaban percepción.
 */
export async function emitirPercepcionDeCobranza(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { cobranzaId: string; serie: string; fechaEmision?: string; observacion?: string },
): Promise<RetencionEmitida> {
  const [cobranza] = await db
    .select()
    .from(cobranzas)
    .where(eq(cobranzas.id, datos.cobranzaId))
    .limit(1);
  if (!cobranza) throw new RetencionInvalida(["la cobranza no existe"]);
  if (cobranza.estado !== "registrada") {
    throw new RetencionInvalida([`la cobranza está ${cobranza.estado}`]);
  }

  const yaEmitido = await existeParaOrigen(db, "cobranza", datos.cobranzaId);
  if (yaEmitido) {
    throw new RetencionInvalida([
      `la cobranza ${cobranza.numero} ya tiene su comprobante de percepción`,
    ]);
  }

  const filas = (await db.execute(sql`
    SELECT ca.importe::text AS aplicado,
           c.id AS comprobante_id, c.tipo_documento, c.serie, c.numero,
           c.fecha_emision::text AS fecha_emision, c.moneda,
           c.total::text AS total, c.percepcion_monto::text AS percepcion
    FROM cobranza_aplicaciones ca
    JOIN comprobantes c ON c.id = ca.comprobante_id
    WHERE ca.cobranza_id = ${datos.cobranzaId}
      AND c.percepcion_monto > 0
    ORDER BY c.fecha_emision, c.serie, c.numero`)) as unknown as {
    aplicado: string; comprobante_id: string; tipo_documento: string;
    serie: string; numero: string; fecha_emision: string; moneda: string;
    total: string; percepcion: string;
  }[];

  if (filas.length === 0) {
    throw new RetencionInvalida([
      "ningún comprobante de esta cobranza llevaba percepción; no hay nada que documentar",
    ]);
  }

  const tipoCambio = dec(cobranza.tipoCambio);
  const fechaEmision = datos.fechaEmision ?? cobranza.fecha;
  const numero = await siguienteCorrelativo(db, TIPO_PERCEPCION, datos.serie);

  let total = money.ZERO;
  let operacion = money.ZERO;

  const items = [...filas].map((f) => {
    const percibido = dec(f.percepcion);
    const cobrado = dec(f.aplicado);
    const cobradoEnSoles = money.round(money.mul(cobrado, tipoCambio), 2);
    total = money.add(total, percibido);
    operacion = money.add(operacion, cobradoEnSoles);
    return {
      comprobanteId: f.comprobante_id,
      tipoDocumento: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      fechaDocumento: f.fecha_emision,
      moneda: f.moneda,
      totalDocumento: f.total,
      importePagado: txt2(cobrado),
      importe: txt2(percibido),
      // En la percepción el neto es lo cobrado *más* lo percibido: el agente
      // cobra de más, al revés que en la retención.
      neto: txt2(money.add(cobradoEnSoles, percibido)),
      fecha: cobranza.fecha,
      tipoCambio: f.moneda === "PEN" ? null : cobranza.tipoCambio,
      cobranzaId: datos.cobranzaId,
    };
  });

  return guardar(db, empresaId, usuarioId, {
    tipoDocumento: TIPO_PERCEPCION,
    serie: datos.serie,
    numero,
    fechaEmision,
    terceroId: cobranza.clienteId,
    regimen: cpe.REGIMEN_PERCEPCION.VENTA_INTERNA,
    tasa: money.toString(tributario.PERCEPCION.VENTA_INTERNA.tasa, 6),
    importeTotal: txt2(total),
    importeOperacion: txt2(operacion),
    ...(datos.observacion ? { observacion: datos.observacion } : {}),
    items,
  });
}

type ItemGuardado = {
  documentoCxpId?: string;
  comprobanteId?: string;
  pagoId?: string;
  letraPagoId?: string;
  cobranzaId?: string;
  tipoDocumento: string;
  serie: string;
  numero: string;
  fechaDocumento: string;
  moneda: string;
  totalDocumento: string;
  importePagado: string;
  importe: string;
  neto: string;
  fecha: string;
  tipoCambio: string | null;
};

async function guardar(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    tipoDocumento: string;
    serie: string;
    numero: string;
    fechaEmision: string;
    terceroId: string;
    regimen: string;
    tasa: string;
    importeTotal: string;
    importeOperacion: string;
    observacion?: string;
    items: ItemGuardado[];
  },
): Promise<RetencionEmitida> {
  const [cab] = await db
    .insert(comprobantesRetencion)
    .values({
      empresaId,
      tipoDocumento: datos.tipoDocumento,
      serie: datos.serie,
      numero: datos.numero,
      fechaEmision: datos.fechaEmision,
      horaEmision: horaEnPeru(),
      terceroId: datos.terceroId,
      regimen: datos.regimen,
      tasa: datos.tasa,
      importeTotal: datos.importeTotal,
      importeOperacion: datos.importeOperacion,
      observacion: datos.observacion ?? null,
      estado: cpe.ESTADO_CPE.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: comprobantesRetencion.id });

  await db.insert(retencionItems).values(
    datos.items.map((it, i) => ({
      empresaId,
      retencionId: cab!.id,
      linea: i + 1,
      documentoCxpId: it.documentoCxpId ?? null,
      comprobanteId: it.comprobanteId ?? null,
      pagoId: it.pagoId ?? null,
      letraPagoId: it.letraPagoId ?? null,
      cobranzaId: it.cobranzaId ?? null,
      tipoDocumento: it.tipoDocumento,
      serie: it.serie,
      numero: it.numero,
      fechaDocumento: it.fechaDocumento,
      moneda: it.moneda,
      totalDocumento: it.totalDocumento,
      importePagado: it.importePagado,
      importe: it.importe,
      neto: it.neto,
      fecha: it.fecha,
      tipoCambio: it.tipoCambio,
    })),
  );

  return {
    id: cab!.id,
    serie: datos.serie,
    numero: datos.numero,
    importeTotal: datos.importeTotal,
  };
}

/** ¿Ya se emitió el comprobante de este pago, pago de letra o cobranza? */
async function existeParaOrigen(
  db: Db,
  origen: "pago" | "letra_pago" | "cobranza",
  id: string,
): Promise<boolean> {
  const columna =
    origen === "pago"
      ? sql`ri.pago_id`
      : origen === "letra_pago"
        ? sql`ri.letra_pago_id`
        : sql`ri.cobranza_id`;
  const filas = (await db.execute(sql`
    SELECT 1 AS existe
    FROM retencion_items ri
    JOIN comprobantes_retencion cr ON cr.id = ri.retencion_id
    WHERE ${columna} = ${id} AND cr.estado <> 'rechazado'
    LIMIT 1`)) as unknown as unknown[];
  return [...filas].length > 0;
}

async function siguienteCorrelativo(db: Db, tipo: string, serie: string): Promise<string> {
  const filas = (await db.execute(sql`
    UPDATE series_documento
    SET correlativo = correlativo + 1
    WHERE tipo_documento = ${tipo} AND serie = ${serie} AND activa
    RETURNING correlativo`)) as unknown as { correlativo: number }[];
  const fila = filas[0];
  if (!fila) {
    throw new RetencionInvalida([
      `la serie ${serie} no está registrada para el tipo de documento ${tipo}`,
    ]);
  }
  return String(fila.correlativo).padStart(8, "0");
}

export type ResultadoEnvioRetencion = {
  estado: string;
  codigo: number;
  mensaje: string;
  observaciones: string[];
};

/**
 * Firma y envía el comprobante por `sendBill`.
 *
 * Tres fases, como el envío de una factura, y por los mismos motivos: un
 * rechazo se devuelve en vez de lanzarse, porque es un desenlace que hay que
 * registrar.
 */
export async function enviarRetencionASunat(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  retencionId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<ResultadoEnvioRetencion> {
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [c] = await db
      .select()
      .from(comprobantesRetencion)
      .where(eq(comprobantesRetencion.id, retencionId))
      .limit(1);
    if (!c) throw new RetencionInvalida(["el comprobante no existe"]);
    if (
      c.estado === cpe.ESTADO_CPE.ACEPTADO ||
      c.estado === cpe.ESTADO_CPE.ACEPTADO_CON_OBSERVACIONES
    ) {
      return {
        yaAceptado: {
          estado: c.estado,
          codigo: c.codigoSunat ?? 0,
          mensaje: c.mensajeSunat ?? "ya aceptado",
          observaciones: c.observacionesSunat ?? [],
        },
      };
    }

    const { certificado, credenciales, entorno } = await materialDeFirma(db, ctx.empresaId, kek);
    const documento = await armarDocumento(db, c);
    const xml =
      c.tipoDocumento === TIPO_RETENCION
        ? cpe.construirRetencion(documento)
        : cpe.construirPercepcion(documento);
    const firmado = cpe.firmarXml(xml, certificado, { rucEsperado: credenciales.ruc });
    const hash = createHash("sha256").update(firmado).digest("hex");

    await db
      .update(comprobantesRetencion)
      .set({ xmlFirmado: firmado, hashXml: hash, estado: cpe.ESTADO_CPE.FIRMADO })
      .where(eq(comprobantesRetencion.id, retencionId));

    return {
      envio: {
        credenciales,
        firmado,
        entorno,
        nombre: cpe.nombreCpe(credenciales.ruc, c.tipoDocumento, c.serie, c.numero),
      },
    };
  });

  if ("yaAceptado" in preparado) return preparado.yaAceptado;
  const { credenciales, firmado, entorno, nombre } = preparado.envio;

  let resultado: ResultadoEnvioRetencion;
  let cdrZip: Uint8Array | null = null;
  try {
    const cdr = await cpe.enviarComprobante(credenciales, nombre, firmado, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      endpoint:
        opts.endpoint ??
        (entorno === "produccion" ? cpe.ENDPOINT_PRODUCCION : cpe.ENDPOINT_BETA),
    });
    cdrZip = cdr.cdrZip;
    resultado = {
      estado: cdr.estado,
      codigo: cdr.codigo,
      mensaje: cdr.descripcion,
      observaciones: cdr.observaciones,
    };
  } catch (e) {
    if (!(e instanceof cpe.ErrorSunat)) throw e;
    if (e.reintentable) throw e;
    resultado = {
      estado: e.codigo === 1033 ? cpe.ESTADO_CPE.ACEPTADO : cpe.ESTADO_CPE.RECHAZADO,
      codigo: e.codigo,
      mensaje: e.codigo === 1033 ? "ya registrado en SUNAT" : e.message,
      observaciones: [],
    };
  }

  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(comprobantesRetencion)
      .set({
        estado: resultado.estado,
        codigoSunat: resultado.codigo,
        mensajeSunat: resultado.mensaje,
        observacionesSunat: resultado.observaciones,
        ...(cdrZip ? { cdrBase64: Buffer.from(cdrZip).toString("base64") } : {}),
        enviadoEn: new Date(),
      })
      .where(eq(comprobantesRetencion.id, retencionId)),
  );

  return resultado;
}

async function armarDocumento(
  db: Db,
  c: typeof comprobantesRetencion.$inferSelect,
): Promise<cpe.ComprobanteRetencion> {
  const [emp] = await db.select().from(empresas).limit(1);
  const [tercero] = await db.select().from(terceros).where(eq(terceros.id, c.terceroId)).limit(1);
  if (!emp || !tercero) throw new RetencionInvalida(["faltan datos del emisor o de la contraparte"]);

  const items = await db
    .select()
    .from(retencionItems)
    .where(eq(retencionItems.retencionId, c.id))
    .orderBy(retencionItems.linea);

  return {
    serie: c.serie,
    numero: c.numero,
    fechaEmision: c.fechaEmision,
    ...(c.horaEmision ? { horaEmision: c.horaEmision } : {}),
    emisor: {
      ruc: emp.ruc,
      razonSocial: emp.razonSocial,
      ...(emp.nombreComercial ? { nombreComercial: emp.nombreComercial } : {}),
      ...(emp.ubigeo ? { ubigeo: emp.ubigeo } : {}),
      ...(emp.direccion ? { direccion: emp.direccion } : {}),
    },
    contraparte: {
      tipoDocumento: tercero.tipoDocumento,
      numeroDocumento: tercero.numeroDocumento,
      razonSocial: tercero.razonSocial,
    },
    regimen: c.regimen,
    tasa: dec(c.tasa),
    importeTotal: dec(c.importeTotal),
    importeOperacion: dec(c.importeOperacion),
    ...(c.observacion ? { observacion: c.observacion } : {}),
    documentos: items.map((it) => ({
      tipoDocumento: it.tipoDocumento,
      serie: it.serie,
      numero: it.numero,
      fechaEmision: it.fechaDocumento,
      moneda: it.moneda,
      total: dec(it.totalDocumento),
      importe: dec(it.importe),
      fecha: it.fecha,
      neto: dec(it.neto),
      pagos: [{ importe: dec(it.importePagado), moneda: it.moneda, fecha: it.fecha }],
      ...(it.tipoCambio
        ? {
            tipoCambio: {
              monedaOrigen: it.moneda,
              monedaDestino: "PEN",
              factor: dec(it.tipoCambio),
              fecha: it.fecha,
            },
          }
        : {}),
    })),
  };
}

async function materialDeFirma(db: Db, empresaId: string, kek: Uint8Array) {
  const [cert] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .orderBy(desc(certificadosDigitales.creadoEn))
    .limit(1);
  if (!cert) throw new RetencionInvalida(["esta empresa no tiene un certificado digital cargado"]);

  const [cred] = await db.select().from(credencialesSunat).limit(1);
  if (!cred) throw new RetencionInvalida(["faltan las credenciales SOL de esta empresa"]);

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

export const listarRetenciones = (db: Db, tipo?: string) =>
  db
    .select({
      id: comprobantesRetencion.id,
      tipoDocumento: comprobantesRetencion.tipoDocumento,
      serie: comprobantesRetencion.serie,
      numero: comprobantesRetencion.numero,
      fechaEmision: comprobantesRetencion.fechaEmision,
      importeTotal: comprobantesRetencion.importeTotal,
      importeOperacion: comprobantesRetencion.importeOperacion,
      estado: comprobantesRetencion.estado,
      mensajeSunat: comprobantesRetencion.mensajeSunat,
      tercero: terceros.razonSocial,
    })
    .from(comprobantesRetencion)
    .leftJoin(terceros, eq(terceros.id, comprobantesRetencion.terceroId))
    .where(tipo ? eq(comprobantesRetencion.tipoDocumento, tipo) : undefined)
    .orderBy(desc(comprobantesRetencion.fechaEmision), desc(comprobantesRetencion.numero))
    .limit(200);

export async function cargarRetencion(db: Db, id: string) {
  const [cabecera] = await db
    .select()
    .from(comprobantesRetencion)
    .where(eq(comprobantesRetencion.id, id))
    .limit(1);
  if (!cabecera) throw new RetencionInvalida(["el comprobante no existe"]);
  const items = await db
    .select()
    .from(retencionItems)
    .where(eq(retencionItems.retencionId, id))
    .orderBy(retencionItems.linea);
  const [tercero] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, cabecera.terceroId))
    .limit(1);
  return { cabecera, items, tercero };
}

/** Pagos con retención que todavía no tienen su comprobante. */
export async function pagosSinRetencion(db: Db) {
  const filas = (await db.execute(sql`
    SELECT p.id, 'pago' AS origen, p.numero, p.fecha::text AS fecha, p.moneda,
           p.importe_bruto::text AS bruto, p.retencion_monto::text AS retencion,
           t.razon_social AS proveedor
    FROM pagos p
    JOIN terceros t ON t.id = p.proveedor_id
    WHERE p.estado = 'registrado' AND p.retencion_monto > 0
      AND NOT EXISTS (
        SELECT 1 FROM retencion_items ri
        JOIN comprobantes_retencion cr ON cr.id = ri.retencion_id
        WHERE ri.pago_id = p.id AND cr.estado <> 'rechazado')

    UNION ALL

    -- El pago de una letra retiene igual que el de una factura, y también debe
    -- su comprobante: la norma manda retener cuando la letra se hace efectiva.
    SELECT lp.id, 'letra' AS origen, 'Letra ' || l.numero AS numero,
           lp.fecha::text, lp.moneda,
           lp.importe::text AS bruto, lp.retencion_monto::text AS retencion,
           t.razon_social AS proveedor
    FROM letra_pagos lp
    JOIN letras l ON l.id = lp.letra_id
    JOIN terceros t ON t.id = l.tercero_id
    WHERE lp.retencion_monto > 0
      AND NOT EXISTS (
        SELECT 1 FROM retencion_items ri
        JOIN comprobantes_retencion cr ON cr.id = ri.retencion_id
        WHERE ri.letra_pago_id = lp.id AND cr.estado <> 'rechazado')

    ORDER BY fecha DESC
    LIMIT 100`)) as unknown as {
    id: string; origen: "pago" | "letra"; numero: string; fecha: string; moneda: string;
    bruto: string; retencion: string; proveedor: string;
  }[];
  return [...filas];
}

/** Cobranzas de comprobantes con percepción, todavía sin documentar. */
export async function cobranzasSinPercepcion(db: Db) {
  const filas = (await db.execute(sql`
    SELECT cb.id, cb.numero, cb.fecha::text AS fecha, cb.moneda,
           cb.importe::text AS importe,
           sum(c.percepcion_monto)::text AS percepcion,
           t.razon_social AS cliente
    FROM cobranzas cb
    JOIN terceros t ON t.id = cb.cliente_id
    JOIN cobranza_aplicaciones ca ON ca.cobranza_id = cb.id
    JOIN comprobantes c ON c.id = ca.comprobante_id
    WHERE cb.estado = 'registrada' AND c.percepcion_monto > 0
      AND NOT EXISTS (
        SELECT 1 FROM retencion_items ri
        JOIN comprobantes_retencion cr ON cr.id = ri.retencion_id
        WHERE ri.cobranza_id = cb.id AND cr.estado <> 'rechazado')
    GROUP BY cb.id, cb.numero, cb.fecha, cb.moneda, cb.importe, t.razon_social
    ORDER BY cb.fecha DESC
    LIMIT 100`)) as unknown as {
    id: string; numero: string; fecha: string; moneda: string;
    importe: string; percepcion: string; cliente: string;
  }[];
  return [...filas];
}
