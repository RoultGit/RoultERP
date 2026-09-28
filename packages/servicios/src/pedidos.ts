/**
 * Cotización y pedido de venta: el trabajo comercial anterior a la factura.
 *
 * En Starsoft la venta no nace facturada. Nace como cotización —un precio con
 * fecha de caducidad—, el cliente acepta, se convierte en pedido, y el almacén
 * despacha contra ese pedido. Facturar es el último paso, no el primero.
 *
 * Ninguno de los dos documentos toca inventario ni contabilidad: son
 * compromisos, no hechos. Lo único que registran es cuánto queda por atender,
 * y esa cifra la mueve la venta cuando se emite (`atenderPedido`).
 *
 * El precio se congela al crear la cotización. Si el cliente vuelve un mes
 * después con la cotización en la mano, el pedido sale con ese precio aunque
 * la lista haya cambiado: es lo que se prometió.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { money, tributario } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { siguienteNumero } from "./correlativos.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  cotizaciones, cotizacionItems, pedidos, pedidoItems,
  productos, unidadesMedida, terceros,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class PedidoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "PedidoInvalido");
  }
}

/** pendiente → aceptada | rechazada | vencida; aceptada → convertida. */
export const ESTADO_COTIZACION = {
  PENDIENTE: "pendiente",
  ACEPTADA: "aceptada",
  RECHAZADA: "rechazada",
  VENCIDA: "vencida",
  CONVERTIDA: "convertida",
} as const;

export const ESTADO_PEDIDO = {
  PENDIENTE: "pendiente",
  PARCIAL: "parcial",
  ATENDIDO: "atendido",
  ANULADO: "anulado",
} as const;

export type LineaComercial = {
  productoId?: string;
  codigo?: string;
  descripcion?: string;
  unidad?: string;
  cantidad: string;
  valorUnitario: string;
  descuento?: string;
  afectacionIgv?: string;
};

type LineaResuelta = {
  productoId: string | null;
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  valorUnitario: string;
  descuento: string;
  afectacionIgv: string;
};

/**
 * Completa código, descripción y unidad desde el maestro de productos.
 *
 * Igual que en ventas, una línea sin producto es un servicio y se acepta
 * mientras traiga descripción: se cotizan fletes y comisiones tanto como
 * mercadería.
 */
async function resolverLineas(db: Db, lineas: LineaComercial[]): Promise<LineaResuelta[]> {
  const resueltas: LineaResuelta[] = [];
  for (const [i, l] of lineas.entries()) {
    if (!money.gt(dec(l.cantidad), money.ZERO)) {
      throw new PedidoInvalido([`línea ${i + 1}: la cantidad debe ser positiva`]);
    }
    if (!l.productoId) {
      if (!l.descripcion) {
        throw new PedidoInvalido([`línea ${i + 1}: indique un producto o una descripción`]);
      }
      resueltas.push({
        productoId: null,
        codigo: l.codigo ?? "SERV",
        descripcion: l.descripcion,
        unidad: l.unidad ?? "ZZ",
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        descuento: l.descuento ?? "0",
        afectacionIgv: l.afectacionIgv ?? "10",
      });
      continue;
    }
    const [p] = await db
      .select({
        codigo: productos.codigo,
        descripcion: productos.descripcion,
        afectacion: productos.afectacionIgv,
        unidad: unidadesMedida.codigo,
      })
      .from(productos)
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
      .where(eq(productos.id, l.productoId))
      .limit(1);
    if (!p) throw new PedidoInvalido([`línea ${i + 1}: el producto no existe en esta empresa`]);
    resueltas.push({
      productoId: l.productoId,
      codigo: l.codigo ?? p.codigo,
      descripcion: l.descripcion ?? p.descripcion,
      unidad: l.unidad ?? p.unidad,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      descuento: l.descuento ?? "0",
      afectacionIgv: l.afectacionIgv ?? p.afectacion,
    });
  }
  return resueltas;
}

function totalizar(lineas: LineaResuelta[]) {
  return tributario.totalizar(
    lineas.map((l) => ({
      cantidad: dec(l.cantidad),
      valorUnitario: dec(l.valorUnitario),
      afectacion: l.afectacionIgv as tributario.Afectacion,
      ...(money.isZero(dec(l.descuento)) ? {} : { descuento: dec(l.descuento) }),
    })),
  );
}

async function exigirCliente(db: Db, clienteId: string) {
  const [c] = await db.select().from(terceros).where(eq(terceros.id, clienteId)).limit(1);
  if (!c) throw new PedidoInvalido(["el cliente no existe en esta empresa"]);
  if (!c.esCliente) throw new PedidoInvalido([`${c.razonSocial} no está marcado como cliente`]);
  return c;
}

// ─── Cotizaciones ─────────────────────────────────────────────────────────

export type DatosCotizacion = {
  clienteId: string;
  fecha: string;
  /** Hasta cuándo se respeta el precio. Por omisión, 15 días. */
  validaHasta?: string;
  moneda: string;
  tipoCambio: string;
  condicionPago?: string;
  observaciones?: string;
  lineas: LineaComercial[];
};

function masDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function crearCotizacion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCotizacion,
): Promise<{ id: string; numero: string }> {
  if (datos.lineas.length === 0) {
    throw new PedidoInvalido(["una cotización necesita al menos una línea"]);
  }
  await exigirCliente(db, datos.clienteId);
  const lineas = await resolverLineas(db, datos.lineas);
  const totales = totalizar(lineas);
  const numero = await siguienteNumero(db, cotizaciones, cotizaciones.numero, "COT", datos.fecha.slice(0, 4));

  const [cab] = await db
    .insert(cotizaciones)
    .values({
      empresaId,
      numero,
      clienteId: datos.clienteId,
      fecha: datos.fecha,
      validaHasta: datos.validaHasta ?? masDias(datos.fecha, 15),
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      condicionPago: datos.condicionPago ?? null,
      observaciones: datos.observaciones ?? null,
      gravadas: txt2(totales.gravadas),
      igv: txt2(totales.igv),
      total: txt2(totales.total),
      creadoPor: usuarioId,
    })
    .returning({ id: cotizaciones.id });

  await db.insert(cotizacionItems).values(
    lineas.map((l, i) => ({
      empresaId,
      cotizacionId: cab!.id,
      linea: i + 1,
      productoId: l.productoId,
      codigo: l.codigo,
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

/** Acepta o rechaza. Una cotización ya convertida no vuelve atrás. */
export async function resolverCotizacion(
  db: Db,
  cotizacionId: string,
  estado: "aceptada" | "rechazada",
): Promise<void> {
  const [c] = await db
    .select({ estado: cotizaciones.estado })
    .from(cotizaciones)
    .where(eq(cotizaciones.id, cotizacionId))
    .limit(1);
  if (!c) throw new PedidoInvalido(["la cotización no existe"]);
  if (c.estado === ESTADO_COTIZACION.CONVERTIDA) {
    throw new PedidoInvalido(["la cotización ya se convirtió en pedido"]);
  }
  await db.update(cotizaciones).set({ estado }).where(eq(cotizaciones.id, cotizacionId));
}

export const listarCotizaciones = (db: Db) =>
  db
    .select({
      id: cotizaciones.id,
      numero: cotizaciones.numero,
      cliente: terceros.razonSocial,
      fecha: cotizaciones.fecha,
      validaHasta: cotizaciones.validaHasta,
      moneda: cotizaciones.moneda,
      total: cotizaciones.total,
      estado: cotizaciones.estado,
    })
    .from(cotizaciones)
    .innerJoin(terceros, eq(terceros.id, cotizaciones.clienteId))
    .orderBy(desc(cotizaciones.fecha), desc(cotizaciones.numero))
    .limit(300);

export async function cargarCotizacion(db: Db, cotizacionId: string) {
  const [cabecera] = await db
    .select({
      id: cotizaciones.id,
      numero: cotizaciones.numero,
      clienteId: cotizaciones.clienteId,
      cliente: terceros.razonSocial,
      documento: terceros.numeroDocumento,
      fecha: cotizaciones.fecha,
      validaHasta: cotizaciones.validaHasta,
      moneda: cotizaciones.moneda,
      tipoCambio: cotizaciones.tipoCambio,
      estado: cotizaciones.estado,
      condicionPago: cotizaciones.condicionPago,
      observaciones: cotizaciones.observaciones,
      gravadas: cotizaciones.gravadas,
      igv: cotizaciones.igv,
      total: cotizaciones.total,
    })
    .from(cotizaciones)
    .innerJoin(terceros, eq(terceros.id, cotizaciones.clienteId))
    .where(eq(cotizaciones.id, cotizacionId))
    .limit(1);
  if (!cabecera) throw new PedidoInvalido(["la cotización no existe"]);

  const lineas = await db
    .select()
    .from(cotizacionItems)
    .where(eq(cotizacionItems.cotizacionId, cotizacionId))
    .orderBy(asc(cotizacionItems.linea));

  return { cabecera, lineas };
}

// ─── Pedidos ──────────────────────────────────────────────────────────────

export type DatosPedido = {
  clienteId: string;
  fecha: string;
  fechaEntrega?: string;
  almacenId?: string;
  moneda: string;
  tipoCambio: string;
  condicionPago?: string;
  observaciones?: string;
  lineas: LineaComercial[];
};

export async function crearPedido(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPedido,
): Promise<{ id: string; numero: string }> {
  if (datos.lineas.length === 0) {
    throw new PedidoInvalido(["un pedido necesita al menos una línea"]);
  }
  await exigirCliente(db, datos.clienteId);
  const lineas = await resolverLineas(db, datos.lineas);
  return insertarPedido(db, empresaId, usuarioId, datos, lineas, null);
}

/**
 * Convierte una cotización aceptada en pedido.
 *
 * Copia las líneas tal cual —precio incluido— y marca la cotización como
 * convertida para que no se pueda pedir dos veces lo mismo.
 */
export async function cotizacionAPedido(
  db: Db,
  empresaId: string,
  usuarioId: string,
  cotizacionId: string,
  extra: { fecha: string; fechaEntrega?: string; almacenId?: string } ,
): Promise<{ id: string; numero: string }> {
  const { cabecera, lineas } = await cargarCotizacion(db, cotizacionId);
  if (cabecera.estado === ESTADO_COTIZACION.CONVERTIDA) {
    throw new PedidoInvalido(["la cotización ya se convirtió en pedido"]);
  }
  if (cabecera.estado === ESTADO_COTIZACION.RECHAZADA) {
    throw new PedidoInvalido(["la cotización fue rechazada"]);
  }

  const resueltas: LineaResuelta[] = lineas.map((l) => ({
    productoId: l.productoId,
    codigo: l.codigo,
    descripcion: l.descripcion,
    unidad: l.unidad,
    cantidad: l.cantidad,
    valorUnitario: l.valorUnitario,
    descuento: l.descuento,
    afectacionIgv: l.afectacionIgv,
  }));

  const pedido = await insertarPedido(
    db,
    empresaId,
    usuarioId,
    {
      clienteId: cabecera.clienteId,
      fecha: extra.fecha,
      ...(extra.fechaEntrega ? { fechaEntrega: extra.fechaEntrega } : {}),
      ...(extra.almacenId ? { almacenId: extra.almacenId } : {}),
      moneda: cabecera.moneda,
      tipoCambio: cabecera.tipoCambio,
      ...(cabecera.condicionPago ? { condicionPago: cabecera.condicionPago } : {}),
      ...(cabecera.observaciones ? { observaciones: cabecera.observaciones } : {}),
      lineas: [],
    },
    resueltas,
    cotizacionId,
  );

  await db
    .update(cotizaciones)
    .set({ estado: ESTADO_COTIZACION.CONVERTIDA })
    .where(eq(cotizaciones.id, cotizacionId));

  return pedido;
}

async function insertarPedido(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPedido,
  lineas: LineaResuelta[],
  cotizacionId: string | null,
): Promise<{ id: string; numero: string }> {
  const totales = totalizar(lineas);
  const numero = await siguienteNumero(db, pedidos, pedidos.numero, "PED", datos.fecha.slice(0, 4));

  const [cab] = await db
    .insert(pedidos)
    .values({
      empresaId,
      numero,
      clienteId: datos.clienteId,
      cotizacionId,
      fecha: datos.fecha,
      fechaEntrega: datos.fechaEntrega ?? null,
      almacenId: datos.almacenId ?? null,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      condicionPago: datos.condicionPago ?? null,
      observaciones: datos.observaciones ?? null,
      gravadas: txt2(totales.gravadas),
      igv: txt2(totales.igv),
      total: txt2(totales.total),
      creadoPor: usuarioId,
    })
    .returning({ id: pedidos.id });

  await db.insert(pedidoItems).values(
    lineas.map((l, i) => ({
      empresaId,
      pedidoId: cab!.id,
      linea: i + 1,
      productoId: l.productoId,
      codigo: l.codigo,
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

export async function anularPedido(db: Db, pedidoId: string): Promise<void> {
  const [p] = await db
    .select({ estado: pedidos.estado })
    .from(pedidos)
    .where(eq(pedidos.id, pedidoId))
    .limit(1);
  if (!p) throw new PedidoInvalido(["el pedido no existe"]);
  if (p.estado !== ESTADO_PEDIDO.PENDIENTE) {
    throw new PedidoInvalido([`el pedido está ${p.estado} y ya no se anula`]);
  }
  await db.update(pedidos).set({ estado: ESTADO_PEDIDO.ANULADO }).where(eq(pedidos.id, pedidoId));
}

export const listarPedidos = (db: Db, estado?: string) =>
  db
    .select({
      id: pedidos.id,
      numero: pedidos.numero,
      cliente: terceros.razonSocial,
      fecha: pedidos.fecha,
      fechaEntrega: pedidos.fechaEntrega,
      moneda: pedidos.moneda,
      total: pedidos.total,
      estado: pedidos.estado,
    })
    .from(pedidos)
    .innerJoin(terceros, eq(terceros.id, pedidos.clienteId))
    .where(estado ? eq(pedidos.estado, estado) : sql`true`)
    .orderBy(desc(pedidos.fecha), desc(pedidos.numero))
    .limit(300);

export async function cargarPedido(db: Db, pedidoId: string) {
  const [cabecera] = await db
    .select({
      id: pedidos.id,
      numero: pedidos.numero,
      clienteId: pedidos.clienteId,
      cliente: terceros.razonSocial,
      documento: terceros.numeroDocumento,
      cotizacionId: pedidos.cotizacionId,
      fecha: pedidos.fecha,
      fechaEntrega: pedidos.fechaEntrega,
      almacenId: pedidos.almacenId,
      moneda: pedidos.moneda,
      tipoCambio: pedidos.tipoCambio,
      estado: pedidos.estado,
      condicionPago: pedidos.condicionPago,
      observaciones: pedidos.observaciones,
      gravadas: pedidos.gravadas,
      igv: pedidos.igv,
      total: pedidos.total,
    })
    .from(pedidos)
    .innerJoin(terceros, eq(terceros.id, pedidos.clienteId))
    .where(eq(pedidos.id, pedidoId))
    .limit(1);
  if (!cabecera) throw new PedidoInvalido(["el pedido no existe"]);

  const lineas = await db
    .select()
    .from(pedidoItems)
    .where(eq(pedidoItems.pedidoId, pedidoId))
    .orderBy(asc(pedidoItems.linea));

  return { cabecera, lineas };
}

/**
 * Lo que falta por facturar de un pedido, listo para pasar a `emitirVenta`.
 *
 * Devuelve sólo las líneas con saldo, porque facturar de nuevo una línea ya
 * atendida es el error que este documento existe para evitar.
 */
export async function saldoPedido(db: Db, pedidoId: string) {
  const { cabecera, lineas } = await cargarPedido(db, pedidoId);
  const pendientes = lineas
    .map((l) => ({ ...l, saldo: money.sub(dec(l.cantidad), dec(l.cantidadAtendida)) }))
    .filter((l) => money.gt(l.saldo, money.ZERO));
  return { cabecera, pendientes };
}

/**
 * Descuenta del pedido lo que acaba de facturarse.
 *
 * La llama `emitirVenta` dentro de su misma transacción: si la factura se cae,
 * el pedido tampoco se movió. El emparejamiento es por producto —o por código,
 * para los servicios—, no por número de línea, porque el facturador puede
 * juntar o partir líneas y el pedido debe seguir cuadrando igual.
 *
 * Facturar de más se rechaza. Es la única regla dura del documento: el saldo
 * de un pedido no puede quedar negativo o deja de significar nada.
 */
export async function atenderPedido(
  db: Db,
  pedidoId: string,
  atendido: { productoId?: string | null; codigo?: string; cantidad: string }[],
): Promise<void> {
  const [cab] = await db
    .select({ estado: pedidos.estado })
    .from(pedidos)
    .where(eq(pedidos.id, pedidoId))
    .limit(1);
  if (!cab) throw new PedidoInvalido(["el pedido no existe"]);
  if (cab.estado === ESTADO_PEDIDO.ANULADO) throw new PedidoInvalido(["el pedido está anulado"]);
  if (cab.estado === ESTADO_PEDIDO.ATENDIDO) {
    throw new PedidoInvalido(["el pedido ya está atendido por completo"]);
  }

  const lineas = await db
    .select()
    .from(pedidoItems)
    .where(eq(pedidoItems.pedidoId, pedidoId))
    .orderBy(asc(pedidoItems.linea));

  // Cuánto suma la factura por producto/código, para repartirlo después entre
  // las líneas del pedido en orden.
  const porClave = new Map<string, Dec>();
  for (const a of atendido) {
    const clave = a.productoId ?? `cod:${a.codigo ?? ""}`;
    porClave.set(clave, money.add(porClave.get(clave) ?? money.ZERO, dec(a.cantidad)));
  }

  const nuevos = new Map<string, Dec>();
  for (const l of lineas) {
    const clave = l.productoId ?? `cod:${l.codigo}`;
    const porRepartir = porClave.get(clave);
    if (!porRepartir || money.isZero(porRepartir)) continue;

    const saldo = money.sub(dec(l.cantidad), dec(l.cantidadAtendida));
    if (!money.gt(saldo, money.ZERO)) continue;

    const toma = money.gt(porRepartir, saldo) ? saldo : porRepartir;
    nuevos.set(l.id, money.add(dec(l.cantidadAtendida), toma));
    porClave.set(clave, money.sub(porRepartir, toma));
  }

  const sobrante = [...porClave.values()].reduce((a, v) => money.add(a, v), money.ZERO);
  if (money.gt(sobrante, money.ZERO)) {
    throw new PedidoInvalido([
      "la factura excede lo pedido: revise las cantidades o facture sin pedido",
    ]);
  }

  for (const [id, cantidad] of nuevos) {
    await db
      .update(pedidoItems)
      .set({ cantidadAtendida: money.toString(cantidad, 6) })
      .where(eq(pedidoItems.id, id));
  }

  // El estado se recalcula mirando todas las líneas, no sólo las tocadas.
  const finales = lineas.map((l) => ({
    pedida: dec(l.cantidad),
    atendida: nuevos.get(l.id) ?? dec(l.cantidadAtendida),
  }));
  const completo = finales.every((f) => !money.gt(money.sub(f.pedida, f.atendida), money.ZERO));
  const algo = finales.some((f) => money.gt(f.atendida, money.ZERO));
  const estado = completo
    ? ESTADO_PEDIDO.ATENDIDO
    : algo
      ? ESTADO_PEDIDO.PARCIAL
      : ESTADO_PEDIDO.PENDIENTE;

  await db.update(pedidos).set({ estado }).where(eq(pedidos.id, pedidoId));
}

/**
 * Marca como vencidas las cotizaciones cuyo precio ya no se respeta.
 *
 * No hay proceso nocturno: se llama al listar. Una cotización vencida sigue
 * siendo convertible —el vendedor decide si mantiene el precio—, sólo deja de
 * anunciarse como vigente.
 */
export async function vencerCotizaciones(db: Db, hoy: string): Promise<number> {
  const filas = await db
    .update(cotizaciones)
    .set({ estado: ESTADO_COTIZACION.VENCIDA })
    .where(
      and(
        eq(cotizaciones.estado, ESTADO_COTIZACION.PENDIENTE),
        sql`${cotizaciones.validaHasta} < ${hoy}`,
      ),
    )
    .returning({ id: cotizaciones.id });
  return filas.length;
}
