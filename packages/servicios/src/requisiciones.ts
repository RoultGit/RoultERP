/**
 * Lo que ocurre antes de la orden de compra.
 *
 * En Starsoft comprar no empieza por la orden: un área levanta una requisición,
 * alguien la aprueba, compras manda una solicitud de cotización a varios
 * proveedores, registra lo que cada uno respondió, mira el cuadro comparativo y
 * recién entonces emite la orden. RoautERP empezaba en la orden, y con eso
 * desaparecía toda la trazabilidad: quién pidió, quién autorizó y por qué se
 * eligió a ese proveedor y no al otro.
 *
 * Ninguno de estos documentos toca inventario ni contabilidad. Son papeles de
 * decisión: el primer hecho contable sigue siendo la factura del proveedor.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { money, tributario } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { siguienteNumero } from "./correlativos.ts";
import { crearOrden } from "./compras.ts";
import { ErrorDeNegocio } from "@roulterp/core";
import { hoyEnPeru } from "@roulterp/core/fecha";

const {
  requisiciones, requisicionItems, solicitudesCotizacion, solicitudCotizacionItems,
  cotizacionesProveedor, cotizacionProveedorItems, ordenesCompra,
  productos, unidadesMedida, terceros, usuarios,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class RequisicionInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "RequisicionInvalida");
  }
}

export const ESTADO_REQUISICION = {
  PENDIENTE: "pendiente",
  APROBADA: "aprobada",
  RECHAZADA: "rechazada",
  ATENDIDA: "atendida",
  ANULADA: "anulada",
} as const;

export type LineaPedida = {
  productoId?: string;
  descripcion?: string;
  unidad?: string;
  cantidad: string;
  observaciones?: string;
};

type LineaResuelta = {
  productoId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  observaciones: string | null;
};

/**
 * Completa descripción y unidad desde el maestro.
 *
 * Una requisición puede pedir algo que todavía no existe como producto —«un
 * torno de banco»—, así que la línea sin producto se acepta con su descripción
 * en texto. Es lo que hace útil al documento: se pide antes de saber qué se
 * compra exactamente.
 */
async function resolverLineas(db: Db, lineas: LineaPedida[]): Promise<LineaResuelta[]> {
  const resueltas: LineaResuelta[] = [];
  for (const [i, l] of lineas.entries()) {
    if (!money.gt(dec(l.cantidad), money.ZERO)) {
      throw new RequisicionInvalida([`línea ${i + 1}: la cantidad debe ser positiva`]);
    }
    if (!l.productoId) {
      if (!l.descripcion) {
        throw new RequisicionInvalida([`línea ${i + 1}: indique un producto o una descripción`]);
      }
      resueltas.push({
        productoId: null,
        descripcion: l.descripcion,
        unidad: l.unidad ?? "ZZ",
        cantidad: l.cantidad,
        observaciones: l.observaciones ?? null,
      });
      continue;
    }
    const [p] = await db
      .select({
        descripcion: productos.descripcion,
        unidad: unidadesMedida.codigo,
      })
      .from(productos)
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
      .where(eq(productos.id, l.productoId))
      .limit(1);
    if (!p) throw new RequisicionInvalida([`línea ${i + 1}: el producto no existe en esta empresa`]);
    resueltas.push({
      productoId: l.productoId,
      descripcion: l.descripcion ?? p.descripcion,
      unidad: l.unidad ?? p.unidad,
      cantidad: l.cantidad,
      observaciones: l.observaciones ?? null,
    });
  }
  return resueltas;
}

// ─── Requisiciones ────────────────────────────────────────────────────────

export type DatosRequisicion = {
  /** compra (bienes) o servicio. */
  tipo?: string;
  fecha: string;
  fechaRequerida?: string;
  area?: string;
  almacenId?: string;
  centroCostoId?: string;
  observaciones?: string;
  lineas: LineaPedida[];
};

export async function crearRequisicion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosRequisicion,
): Promise<{ id: string; numero: string }> {
  if (datos.lineas.length === 0) {
    throw new RequisicionInvalida(["una requisición necesita al menos una línea"]);
  }
  const tipo = datos.tipo ?? "compra";
  if (tipo !== "compra" && tipo !== "servicio") {
    throw new RequisicionInvalida(["el tipo debe ser compra o servicio"]);
  }
  const lineas = await resolverLineas(db, datos.lineas);
  const numero = await siguienteNumero(
    db, requisiciones, requisiciones.numero, "REQ", datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(requisiciones)
    .values({
      empresaId,
      numero,
      tipo,
      fecha: datos.fecha,
      fechaRequerida: datos.fechaRequerida ?? null,
      area: datos.area ?? null,
      solicitanteId: usuarioId,
      almacenId: datos.almacenId ?? null,
      centroCostoId: datos.centroCostoId ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: requisiciones.id });

  await db.insert(requisicionItems).values(
    lineas.map((l, i) => ({
      empresaId,
      requisicionId: cab!.id,
      linea: i + 1,
      productoId: l.productoId,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      observaciones: l.observaciones,
    })),
  );

  return { id: cab!.id, numero };
}

/**
 * Aprueba o rechaza.
 *
 * Quien aprueba queda registrado: es la razón de ser del documento. Rechazar
 * exige motivo, porque una requisición rechazada sin explicación vuelve tal
 * cual la semana siguiente.
 */
export async function resolverRequisicion(
  db: Db,
  requisicionId: string,
  usuarioId: string,
  decision: { estado: "aprobada" | "rechazada"; motivo?: string },
): Promise<void> {
  const [r] = await db
    .select({ estado: requisiciones.estado })
    .from(requisiciones)
    .where(eq(requisiciones.id, requisicionId))
    .limit(1);
  if (!r) throw new RequisicionInvalida(["la requisición no existe"]);
  if (r.estado !== ESTADO_REQUISICION.PENDIENTE) {
    throw new RequisicionInvalida([`la requisición está ${r.estado} y ya no se resuelve`]);
  }
  if (decision.estado === "rechazada" && !decision.motivo?.trim()) {
    throw new RequisicionInvalida(["indique el motivo del rechazo"]);
  }

  await db
    .update(requisiciones)
    .set({
      estado: decision.estado,
      aprobadaPor: usuarioId,
      aprobadaEn: new Date(),
      motivoRechazo: decision.estado === "rechazada" ? decision.motivo!.trim() : null,
    })
    .where(eq(requisiciones.id, requisicionId));
}

export async function anularRequisicion(db: Db, requisicionId: string): Promise<void> {
  const [r] = await db
    .select({ estado: requisiciones.estado })
    .from(requisiciones)
    .where(eq(requisiciones.id, requisicionId))
    .limit(1);
  if (!r) throw new RequisicionInvalida(["la requisición no existe"]);
  if (r.estado === ESTADO_REQUISICION.ATENDIDA) {
    throw new RequisicionInvalida(["la requisición ya fue atendida y no se anula"]);
  }
  await db
    .update(requisiciones)
    .set({ estado: ESTADO_REQUISICION.ANULADA })
    .where(eq(requisiciones.id, requisicionId));
}

export const listarRequisiciones = (db: Db, estado?: string) =>
  db
    .select({
      id: requisiciones.id,
      numero: requisiciones.numero,
      tipo: requisiciones.tipo,
      fecha: requisiciones.fecha,
      fechaRequerida: requisiciones.fechaRequerida,
      area: requisiciones.area,
      solicitante: usuarios.nombre,
      estado: requisiciones.estado,
      motivoRechazo: requisiciones.motivoRechazo,
    })
    .from(requisiciones)
    .leftJoin(usuarios, eq(usuarios.id, requisiciones.solicitanteId))
    .where(estado ? eq(requisiciones.estado, estado) : sql`true`)
    .orderBy(desc(requisiciones.fecha), desc(requisiciones.numero))
    .limit(300);

export async function cargarRequisicion(db: Db, requisicionId: string) {
  const [cabecera] = await db
    .select()
    .from(requisiciones)
    .where(eq(requisiciones.id, requisicionId))
    .limit(1);
  if (!cabecera) throw new RequisicionInvalida(["la requisición no existe"]);

  const lineas = await db
    .select()
    .from(requisicionItems)
    .where(eq(requisicionItems.requisicionId, requisicionId))
    .orderBy(asc(requisicionItems.linea));

  return { cabecera, lineas };
}

// ─── Solicitudes de cotización ────────────────────────────────────────────

export type DatosSolicitud = {
  fecha: string;
  fechaLimite?: string;
  requisicionId?: string;
  observaciones?: string;
  /** Si viene de una requisición aprobada, se omite: se copian sus líneas. */
  lineas?: LineaPedida[];
};

export async function crearSolicitud(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosSolicitud,
): Promise<{ id: string; numero: string }> {
  let lineas: LineaResuelta[];

  if (datos.requisicionId) {
    const { cabecera, lineas: pedidas } = await cargarRequisicion(db, datos.requisicionId);
    // Sólo se cotiza lo aprobado. Salir a pedir precios por algo que nadie
    // autorizó es el atajo que convierte la aprobación en un trámite vacío.
    if (cabecera.estado !== ESTADO_REQUISICION.APROBADA) {
      throw new RequisicionInvalida([
        `la requisición está ${cabecera.estado}: sólo se cotiza lo aprobado`,
      ]);
    }
    lineas = pedidas.map((l) => ({
      productoId: l.productoId,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      observaciones: l.observaciones,
    }));
  } else {
    if (!datos.lineas?.length) {
      throw new RequisicionInvalida(["indique una requisición o al menos una línea"]);
    }
    lineas = await resolverLineas(db, datos.lineas);
  }

  const numero = await siguienteNumero(
    db, solicitudesCotizacion, solicitudesCotizacion.numero, "SDC", datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(solicitudesCotizacion)
    .values({
      empresaId,
      numero,
      requisicionId: datos.requisicionId ?? null,
      fecha: datos.fecha,
      fechaLimite: datos.fechaLimite ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: solicitudesCotizacion.id });

  await db.insert(solicitudCotizacionItems).values(
    lineas.map((l, i) => ({
      empresaId,
      solicitudId: cab!.id,
      linea: i + 1,
      productoId: l.productoId,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
    })),
  );

  return { id: cab!.id, numero };
}

export const listarSolicitudes = (db: Db) =>
  db
    .select({
      id: solicitudesCotizacion.id,
      numero: solicitudesCotizacion.numero,
      fecha: solicitudesCotizacion.fecha,
      fechaLimite: solicitudesCotizacion.fechaLimite,
      estado: solicitudesCotizacion.estado,
      requisicion: requisiciones.numero,
      respuestas: sql<number>`(
        SELECT count(*) FROM cotizaciones_proveedor c
        WHERE c.solicitud_id = ${solicitudesCotizacion.id}
      )`,
    })
    .from(solicitudesCotizacion)
    .leftJoin(requisiciones, eq(requisiciones.id, solicitudesCotizacion.requisicionId))
    .orderBy(desc(solicitudesCotizacion.fecha), desc(solicitudesCotizacion.numero))
    .limit(300);

export async function cargarSolicitud(db: Db, solicitudId: string) {
  const [cabecera] = await db
    .select()
    .from(solicitudesCotizacion)
    .where(eq(solicitudesCotizacion.id, solicitudId))
    .limit(1);
  if (!cabecera) throw new RequisicionInvalida(["la solicitud no existe"]);

  const lineas = await db
    .select()
    .from(solicitudCotizacionItems)
    .where(eq(solicitudCotizacionItems.solicitudId, solicitudId))
    .orderBy(asc(solicitudCotizacionItems.linea));

  return { cabecera, lineas };
}

/** Cierra la solicitud: ya no se reciben más respuestas. */
export async function cerrarSolicitud(db: Db, solicitudId: string, desierta = false): Promise<void> {
  const [s0] = await db
    .select({ estado: solicitudesCotizacion.estado })
    .from(solicitudesCotizacion)
    .where(eq(solicitudesCotizacion.id, solicitudId))
    .limit(1);
  if (!s0) throw new RequisicionInvalida(["la solicitud no existe"]);
  if (s0.estado !== "abierta") {
    throw new RequisicionInvalida([`la solicitud está ${s0.estado}`]);
  }
  await db
    .update(solicitudesCotizacion)
    .set({ estado: desierta ? "desierta" : "cerrada" })
    .where(eq(solicitudesCotizacion.id, solicitudId));
}

// ─── Cotizaciones de los proveedores ──────────────────────────────────────

export type LineaCotizada = {
  /** La línea de la solicitud que se está respondiendo. */
  solicitudItemId: string;
  cantidad?: string;
  valorUnitario: string;
  descuento?: string;
  afectacionIgv?: string;
  descripcion?: string;
};

export type DatosCotizacionProveedor = {
  solicitudId: string;
  proveedorId: string;
  referenciaProveedor?: string;
  fecha: string;
  validaHasta?: string;
  moneda: string;
  tipoCambio: string;
  condicionPago?: string;
  plazoEntregaDias?: number;
  observaciones?: string;
  lineas: LineaCotizada[];
};

/**
 * Registra lo que respondió un proveedor.
 *
 * Cada línea se ata a la línea de la solicitud que responde: sin eso el cuadro
 * comparativo compararía cosas distintas. Un proveedor puede no cotizar todo
 * —es normal— y entonces su columna queda vacía en esa fila.
 */
export async function registrarCotizacionProveedor(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCotizacionProveedor,
): Promise<{ id: string; numero: string }> {
  if (datos.lineas.length === 0) {
    throw new RequisicionInvalida(["la cotización necesita al menos una línea"]);
  }

  const { cabecera, lineas: pedidas } = await cargarSolicitud(db, datos.solicitudId);
  if (cabecera.estado !== "abierta") {
    throw new RequisicionInvalida([`la solicitud está ${cabecera.estado}: ya no admite respuestas`]);
  }

  const [prov] = await db
    .select({ razonSocial: terceros.razonSocial, esProveedor: terceros.esProveedor })
    .from(terceros)
    .where(eq(terceros.id, datos.proveedorId))
    .limit(1);
  if (!prov) throw new RequisicionInvalida(["el proveedor no existe en esta empresa"]);
  if (!prov.esProveedor) {
    throw new RequisicionInvalida([`${prov.razonSocial} no está marcado como proveedor`]);
  }

  // Un proveedor responde una vez. Si mejora su oferta, se descarta la anterior
  // y se registra la nueva: dos vigentes del mismo proveedor harían del cuadro
  // comparativo una adivinanza.
  const previas = await db
    .select({ id: cotizacionesProveedor.id })
    .from(cotizacionesProveedor)
    .where(
      and(
        eq(cotizacionesProveedor.solicitudId, datos.solicitudId),
        eq(cotizacionesProveedor.proveedorId, datos.proveedorId),
        eq(cotizacionesProveedor.estado, "registrada"),
      ),
    );
  if (previas.length > 0) {
    throw new RequisicionInvalida([
      `${prov.razonSocial} ya cotizó esta solicitud: descarte su cotización anterior antes de registrar otra`,
    ]);
  }

  const porId = new Map(pedidas.map((l) => [l.id, l]));
  const resueltas = datos.lineas.map((l, i) => {
    const pedida = porId.get(l.solicitudItemId);
    if (!pedida) {
      throw new RequisicionInvalida([`línea ${i + 1}: no corresponde a esta solicitud`]);
    }
    // Por defecto se cotiza lo que se pidió; el proveedor puede ofrecer otra
    // cantidad (un empaque cerrado, por ejemplo) y eso queda a la vista.
    const cantidad = l.cantidad ?? pedida.cantidad;
    if (!money.gt(dec(cantidad), money.ZERO)) {
      throw new RequisicionInvalida([`línea ${i + 1}: la cantidad debe ser positiva`]);
    }
    return {
      solicitudItemId: pedida.id,
      productoId: pedida.productoId,
      descripcion: l.descripcion ?? pedida.descripcion,
      unidad: pedida.unidad,
      cantidad,
      valorUnitario: l.valorUnitario,
      descuento: l.descuento ?? "0",
      afectacionIgv: l.afectacionIgv ?? "10",
    };
  });

  const totales = tributario.totalizar(
    resueltas.map((l) => ({
      cantidad: dec(l.cantidad),
      valorUnitario: dec(l.valorUnitario),
      afectacion: l.afectacionIgv as tributario.Afectacion,
      ...(money.isZero(dec(l.descuento)) ? {} : { descuento: dec(l.descuento) }),
    })),
  );

  const numero = await siguienteNumero(
    db, cotizacionesProveedor, cotizacionesProveedor.numero, "CTP", datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(cotizacionesProveedor)
    .values({
      empresaId,
      numero,
      solicitudId: datos.solicitudId,
      proveedorId: datos.proveedorId,
      referenciaProveedor: datos.referenciaProveedor ?? null,
      fecha: datos.fecha,
      validaHasta: datos.validaHasta ?? null,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      condicionPago: datos.condicionPago ?? null,
      plazoEntregaDias: datos.plazoEntregaDias ?? null,
      observaciones: datos.observaciones ?? null,
      subtotal: txt2(totales.valorVentaTotal),
      igv: txt2(totales.igv),
      total: txt2(totales.total),
      creadoPor: usuarioId,
    })
    .returning({ id: cotizacionesProveedor.id });

  await db.insert(cotizacionProveedorItems).values(
    resueltas.map((l, i) => ({
      empresaId,
      cotizacionId: cab!.id,
      solicitudItemId: l.solicitudItemId,
      linea: i + 1,
      productoId: l.productoId,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      descuento: l.descuento,
      afectacionIgv: l.afectacionIgv,
      importeLinea: txt2(totales.lineas[i]!.importe),
    })),
  );

  return { id: cab!.id, numero };
}

export async function descartarCotizacion(db: Db, cotizacionId: string): Promise<void> {
  const [c] = await db
    .select({ estado: cotizacionesProveedor.estado })
    .from(cotizacionesProveedor)
    .where(eq(cotizacionesProveedor.id, cotizacionId))
    .limit(1);
  if (!c) throw new RequisicionInvalida(["la cotización no existe"]);
  if (c.estado === "elegida") {
    throw new RequisicionInvalida(["la cotización elegida ya generó su orden de compra"]);
  }
  await db
    .update(cotizacionesProveedor)
    .set({ estado: "descartada" })
    .where(eq(cotizacionesProveedor.id, cotizacionId));
}

// ─── Cuadro comparativo ───────────────────────────────────────────────────

export type ColumnaCuadro = {
  cotizacionId: string;
  numero: string;
  proveedorId: string;
  proveedor: string;
  moneda: string;
  tipoCambio: string;
  condicionPago: string | null;
  plazoEntregaDias: number | null;
  estado: string;
  ordenCompraId: string | null;
  /** Total de la oferta llevado a soles, que es lo único comparable. */
  totalSoles: string;
  /** El más barato de la tabla, ya en soles. */
  esMejorTotal: boolean;
};

export type FilaCuadro = {
  solicitudItemId: string;
  linea: number;
  descripcion: string;
  unidad: string;
  cantidad: string;
  ofertas: {
    cotizacionId: string;
    cantidad: string;
    valorUnitario: string;
    /** Valor unitario en soles: comparar PEN contra USD a secas engaña. */
    valorUnitarioSoles: string;
    importeLinea: string;
    esMejor: boolean;
  }[];
};

/**
 * El cuadro comparativo de Starsoft: una fila por artículo pedido y una columna
 * por proveedor que respondió.
 *
 * Todo se lleva a soles con el tipo de cambio de cada cotización antes de
 * comparar. Sin eso, una oferta en dólares parece siempre la más barata, que es
 * el error que un cuadro comparativo existe para evitar.
 *
 * Marcar el mejor precio es una ayuda, no una decisión: el plazo de entrega y la
 * condición de pago van en la misma tabla justamente porque el más barato no
 * siempre gana.
 */
export async function cuadroComparativo(db: Db, solicitudId: string) {
  const { cabecera, lineas } = await cargarSolicitud(db, solicitudId);

  const cotizaciones = await db
    .select({
      id: cotizacionesProveedor.id,
      numero: cotizacionesProveedor.numero,
      proveedorId: cotizacionesProveedor.proveedorId,
      proveedor: terceros.razonSocial,
      moneda: cotizacionesProveedor.moneda,
      tipoCambio: cotizacionesProveedor.tipoCambio,
      condicionPago: cotizacionesProveedor.condicionPago,
      plazoEntregaDias: cotizacionesProveedor.plazoEntregaDias,
      estado: cotizacionesProveedor.estado,
      total: cotizacionesProveedor.total,
      ordenCompraId: cotizacionesProveedor.ordenCompraId,
    })
    .from(cotizacionesProveedor)
    .innerJoin(terceros, eq(terceros.id, cotizacionesProveedor.proveedorId))
    .where(
      and(
        eq(cotizacionesProveedor.solicitudId, solicitudId),
        sql`${cotizacionesProveedor.estado} <> 'descartada'`,
      ),
    )
    .orderBy(asc(cotizacionesProveedor.numero));

  const items = cotizaciones.length
    ? await db
        .select()
        .from(cotizacionProveedorItems)
        .where(inArray(cotizacionProveedorItems.cotizacionId, cotizaciones.map((c) => c.id)))
    : [];

  const tcDe = new Map(cotizaciones.map((c) => [c.id, dec(c.tipoCambio)]));

  const columnas: ColumnaCuadro[] = cotizaciones.map((c) => ({
    cotizacionId: c.id,
    numero: c.numero,
    proveedorId: c.proveedorId,
    proveedor: c.proveedor,
    moneda: c.moneda,
    tipoCambio: c.tipoCambio,
    condicionPago: c.condicionPago,
    plazoEntregaDias: c.plazoEntregaDias,
    estado: c.estado,
    ordenCompraId: c.ordenCompraId,
    totalSoles: money.toString(money.round(money.mul(dec(c.total), dec(c.tipoCambio)), 2), 2),
    esMejorTotal: false,
  }));

  const mejorTotal = columnas.reduce<Dec | null>(
    (a, c) => (a === null || money.gt(a, dec(c.totalSoles)) ? dec(c.totalSoles) : a),
    null,
  );
  for (const c of columnas) {
    c.esMejorTotal = mejorTotal !== null && dec(c.totalSoles) === mejorTotal;
  }

  const filas: FilaCuadro[] = lineas.map((l) => {
    const ofertas = items
      .filter((i) => i.solicitudItemId === l.id)
      .map((i) => ({
        cotizacionId: i.cotizacionId,
        cantidad: i.cantidad,
        valorUnitario: i.valorUnitario,
        valorUnitarioSoles: money.toString(
          money.round(money.mul(dec(i.valorUnitario), tcDe.get(i.cotizacionId) ?? money.dec("1")), 6),
          6,
        ),
        importeLinea: i.importeLinea,
        esMejor: false,
      }));

    const mejor = ofertas.reduce<Dec | null>(
      (a, o) =>
        a === null || money.gt(a, dec(o.valorUnitarioSoles)) ? dec(o.valorUnitarioSoles) : a,
      null,
    );
    for (const o of ofertas) {
      o.esMejor = mejor !== null && dec(o.valorUnitarioSoles) === mejor;
    }

    return {
      solicitudItemId: l.id,
      linea: l.linea,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      ofertas,
    };
  });

  return { cabecera, columnas, filas };
}

// ─── De la cotización elegida a la orden de compra ────────────────────────

/**
 * Elige una cotización y emite su orden de compra.
 *
 * Es el final del flujo: aquí el papel de decisión se convierte en compromiso.
 * La orden nace en borrador —todavía tiene que aprobarla quien corresponda— y
 * queda apuntando a la cotización y a la requisición de las que salió, para que
 * dentro de un año se pueda contestar por qué se le compró a ese proveedor.
 *
 * Las demás cotizaciones de la solicitud se descartan y la solicitud se cierra:
 * elegir dos veces la misma compra es el error que esto evita.
 */
export async function elegirCotizacion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  cotizacionId: string,
  extra: { fecha: string; fechaEntrega?: string; almacenId?: string } = {
    fecha: hoyEnPeru(),
  },
): Promise<{ ordenId: string; numeroOrden: string }> {
  const [c] = await db
    .select()
    .from(cotizacionesProveedor)
    .where(eq(cotizacionesProveedor.id, cotizacionId))
    .limit(1);
  if (!c) throw new RequisicionInvalida(["la cotización no existe"]);
  if (c.estado === "elegida") {
    throw new RequisicionInvalida(["esta cotización ya generó su orden de compra"]);
  }
  if (c.estado === "descartada") {
    throw new RequisicionInvalida(["la cotización fue descartada"]);
  }

  const lineas = await db
    .select()
    .from(cotizacionProveedorItems)
    .where(eq(cotizacionProveedorItems.cotizacionId, cotizacionId))
    .orderBy(asc(cotizacionProveedorItems.linea));

  const ordenId = await crearOrden(db, empresaId, usuarioId, {
    proveedorId: c.proveedorId,
    fecha: extra.fecha,
    moneda: c.moneda,
    tipoCambio: c.tipoCambio,
    ...(extra.fechaEntrega ? { fechaEntrega: extra.fechaEntrega } : {}),
    ...(extra.almacenId ? { almacenId: extra.almacenId } : {}),
    ...(c.condicionPago ? { condicionPago: c.condicionPago } : {}),
    observaciones: `Cotización ${c.numero}`,
    lineas: lineas.map((l) => ({
      ...(l.productoId ? { productoId: l.productoId } : {}),
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      descuento: l.descuento,
      afectacionIgv: l.afectacionIgv,
    })),
  });

  await db
    .update(ordenesCompra)
    .set({ cotizacionProveedorId: cotizacionId, requisicionId: null })
    .where(eq(ordenesCompra.id, ordenId));

  await db
    .update(cotizacionesProveedor)
    .set({ estado: "elegida", ordenCompraId: ordenId })
    .where(eq(cotizacionesProveedor.id, cotizacionId));

  // Las demás ofertas quedan descartadas y la solicitud, cerrada.
  await db
    .update(cotizacionesProveedor)
    .set({ estado: "descartada" })
    .where(
      and(
        eq(cotizacionesProveedor.solicitudId, c.solicitudId),
        sql`${cotizacionesProveedor.id} <> ${cotizacionId}`,
        eq(cotizacionesProveedor.estado, "registrada"),
      ),
    );
  await db
    .update(solicitudesCotizacion)
    .set({ estado: "cerrada" })
    .where(eq(solicitudesCotizacion.id, c.solicitudId));

  // Y la requisición, si la hubo, queda atendida.
  const [sol] = await db
    .select({ requisicionId: solicitudesCotizacion.requisicionId })
    .from(solicitudesCotizacion)
    .where(eq(solicitudesCotizacion.id, c.solicitudId))
    .limit(1);
  if (sol?.requisicionId) {
    await db
      .update(ordenesCompra)
      .set({ requisicionId: sol.requisicionId })
      .where(eq(ordenesCompra.id, ordenId));
    await db
      .update(requisiciones)
      .set({ estado: ESTADO_REQUISICION.ATENDIDA })
      .where(eq(requisiciones.id, sol.requisicionId));
  }

  const [oc] = await db
    .select({ numero: ordenesCompra.numero })
    .from(ordenesCompra)
    .where(eq(ordenesCompra.id, ordenId))
    .limit(1);

  return { ordenId, numeroOrden: oc!.numero };
}
