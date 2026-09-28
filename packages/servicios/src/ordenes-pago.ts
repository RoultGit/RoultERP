/**
 * Orden de pago y estado de cuenta del proveedor.
 *
 * La orden de pago separa a quien decide pagar de quien firma el cheque. Se
 * arma con los documentos que se quieren cancelar, alguien con permiso de
 * aprobación la autoriza, y recién entonces se ejecuta. Sin ese paso la única
 * huella de por qué salió el dinero es que alguien lo sacó, y un egreso sin
 * autorización es la puerta por la que se va la plata de una empresa.
 *
 * La orden no mueve dinero ni contabilidad: eso lo sigue haciendo el pago, con
 * su asiento, su retención y su movimiento de caja. Lo que la orden aporta es
 * el permiso y el rastro.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { siguienteNumero } from "./correlativos.ts";
import { registrarPago, type PagoRegistrado } from "./pagos.ts";
import { cuentasDe } from "./parametros.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  ordenesPago, ordenPagoDocumentos, documentosCxp, pagos, pagoAplicaciones,
  terceros, cuentasEfectivo, usuarios,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class OrdenPagoInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "OrdenPagoInvalida");
  }
}

export const ESTADO_ORDEN_PAGO = {
  PENDIENTE: "pendiente",
  AUTORIZADA: "autorizada",
  RECHAZADA: "rechazada",
  PAGADA: "pagada",
  ANULADA: "anulada",
} as const;

export type DatosOrdenPago = {
  proveedorId: string;
  fecha: string;
  fechaProgramada?: string;
  medioPago?: string;
  cuentaEfectivoId?: string;
  retenerIgv?: boolean;
  observaciones?: string;
  /** Qué documentos cubre y por cuánto. Sin importe, se cancela el saldo. */
  documentos: { documentoId: string; importe?: string }[];
};

/**
 * Arma la orden con los documentos elegidos.
 *
 * Se valida contra el saldo vivo de cada documento y contra lo ya comprometido
 * por otras órdenes sin ejecutar. Sin lo segundo, dos órdenes podrían pedir el
 * pago de la misma factura y la empresa la pagaría dos veces: es el error caro
 * que este documento existe para evitar.
 */
export async function crearOrdenPago(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosOrdenPago,
): Promise<{ id: string; numero: string; importe: string }> {
  if (datos.documentos.length === 0) {
    throw new OrdenPagoInvalida(["una orden de pago necesita al menos un documento"]);
  }

  const [prov] = await db
    .select({ razonSocial: terceros.razonSocial, esProveedor: terceros.esProveedor })
    .from(terceros)
    .where(eq(terceros.id, datos.proveedorId))
    .limit(1);
  if (!prov) throw new OrdenPagoInvalida(["el proveedor no existe en esta empresa"]);
  if (!prov.esProveedor) {
    throw new OrdenPagoInvalida([`${prov.razonSocial} no está marcado como proveedor`]);
  }

  const ids = datos.documentos.map((d) => d.documentoId);
  const abiertos = await db
    .select({
      id: documentosCxp.id,
      proveedorId: documentosCxp.proveedorId,
      serie: documentosCxp.serie,
      numero: documentosCxp.numero,
      moneda: documentosCxp.moneda,
      saldo: documentosCxp.saldo,
      estado: documentosCxp.estado,
    })
    .from(documentosCxp)
    .where(inArray(documentosCxp.id, ids));

  const porId = new Map(abiertos.map((d) => [d.id, d]));
  const comprometido = await comprometidoPorOrdenes(db, ids);

  const motivos: string[] = [];
  const lineas: { documentoId: string; importe: Dec }[] = [];
  let moneda: string | null = null;
  let total = money.ZERO;

  for (const pedido of datos.documentos) {
    const doc = porId.get(pedido.documentoId);
    if (!doc) {
      motivos.push("uno de los documentos no existe en esta empresa");
      continue;
    }
    if (doc.proveedorId !== datos.proveedorId) {
      motivos.push(`el documento ${doc.serie}-${doc.numero} es de otro proveedor`);
      continue;
    }
    if (doc.estado === "anulado" || doc.estado === "pagado") {
      motivos.push(`el documento ${doc.serie}-${doc.numero} está ${doc.estado}`);
      continue;
    }
    if (moneda === null) moneda = doc.moneda;
    else if (moneda !== doc.moneda) {
      motivos.push("una orden de pago no mezcla monedas: arme una por cada una");
      continue;
    }

    const libre = money.sub(dec(doc.saldo), comprometido.get(doc.id) ?? money.ZERO);
    const importe = pedido.importe ? dec(pedido.importe) : libre;

    if (!money.gt(importe, money.ZERO)) {
      motivos.push(`el documento ${doc.serie}-${doc.numero} no tiene saldo libre que ordenar`);
      continue;
    }
    if (money.gt(importe, libre)) {
      motivos.push(
        `del documento ${doc.serie}-${doc.numero} sólo quedan ${txt2(libre)} sin ordenar` +
          (money.isZero(comprometido.get(doc.id) ?? money.ZERO)
            ? ""
            : " (el resto ya está en otra orden)"),
      );
      continue;
    }

    lineas.push({ documentoId: doc.id, importe });
    total = money.add(total, importe);
  }

  if (motivos.length) throw new OrdenPagoInvalida(motivos);

  const numero = await siguienteNumero(
    db, ordenesPago, ordenesPago.numero, "OP", datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(ordenesPago)
    .values({
      empresaId,
      numero,
      fecha: datos.fecha,
      fechaProgramada: datos.fechaProgramada ?? null,
      proveedorId: datos.proveedorId,
      moneda: moneda ?? "PEN",
      importe: txt2(total),
      medioPago: datos.medioPago ?? "transferencia",
      cuentaEfectivoId: datos.cuentaEfectivoId ?? null,
      retenerIgv: datos.retenerIgv ?? false,
      observaciones: datos.observaciones ?? null,
      solicitadaPor: usuarioId,
      creadoPor: usuarioId,
    })
    .returning({ id: ordenesPago.id });

  await db.insert(ordenPagoDocumentos).values(
    lineas.map((l) => ({
      empresaId,
      ordenId: cab!.id,
      documentoId: l.documentoId,
      importe: txt2(l.importe),
    })),
  );

  return { id: cab!.id, numero, importe: txt2(total) };
}

/**
 * Lo que ya está comprometido por órdenes vivas, documento por documento.
 *
 * Cuentan las pendientes y las autorizadas: unas esperan firma y otras esperan
 * ejecución, pero ambas van a consumir ese saldo.
 */
async function comprometidoPorOrdenes(
  db: Db,
  documentoIds: string[],
): Promise<Map<string, Dec>> {
  if (documentoIds.length === 0) return new Map();
  const filas = await db
    .select({
      documentoId: ordenPagoDocumentos.documentoId,
      importe: sql<string>`sum(${ordenPagoDocumentos.importe})`,
    })
    .from(ordenPagoDocumentos)
    .innerJoin(ordenesPago, eq(ordenesPago.id, ordenPagoDocumentos.ordenId))
    .where(
      and(
        inArray(ordenPagoDocumentos.documentoId, documentoIds),
        inArray(ordenesPago.estado, ["pendiente", "autorizada"]),
      ),
    )
    .groupBy(ordenPagoDocumentos.documentoId);
  return new Map(filas.map((f) => [f.documentoId, dec(f.importe)]));
}

/** Autoriza o rechaza. Rechazar exige motivo. */
export async function resolverOrdenPago(
  db: Db,
  ordenId: string,
  usuarioId: string,
  decision: { estado: "autorizada" | "rechazada"; motivo?: string },
): Promise<void> {
  const [o] = await db
    .select({ estado: ordenesPago.estado, solicitadaPor: ordenesPago.solicitadaPor })
    .from(ordenesPago)
    .where(eq(ordenesPago.id, ordenId))
    .limit(1);
  if (!o) throw new OrdenPagoInvalida(["la orden de pago no existe"]);
  if (o.estado !== ESTADO_ORDEN_PAGO.PENDIENTE) {
    throw new OrdenPagoInvalida([`la orden está ${o.estado} y ya no se resuelve`]);
  }
  if (decision.estado === "rechazada" && !decision.motivo?.trim()) {
    throw new OrdenPagoInvalida(["indique el motivo del rechazo"]);
  }

  await db
    .update(ordenesPago)
    .set({
      estado: decision.estado,
      autorizadaPor: usuarioId,
      autorizadaEn: new Date(),
      motivoRechazo: decision.estado === "rechazada" ? decision.motivo!.trim() : null,
    })
    .where(eq(ordenesPago.id, ordenId));
}

export async function anularOrdenPago(db: Db, ordenId: string): Promise<void> {
  const [o] = await db
    .select({ estado: ordenesPago.estado })
    .from(ordenesPago)
    .where(eq(ordenesPago.id, ordenId))
    .limit(1);
  if (!o) throw new OrdenPagoInvalida(["la orden de pago no existe"]);
  if (o.estado === ESTADO_ORDEN_PAGO.PAGADA) {
    throw new OrdenPagoInvalida(["la orden ya se pagó: extorne el pago en su lugar"]);
  }
  await db
    .update(ordenesPago)
    .set({ estado: ESTADO_ORDEN_PAGO.ANULADA })
    .where(eq(ordenesPago.id, ordenId));
}

/**
 * Ejecuta una orden autorizada: registra el pago.
 *
 * Sólo se paga lo autorizado. Es la razón de ser del documento, y por eso la
 * comprobación está aquí y no en la pantalla: una orden pendiente no se paga
 * aunque alguien llegue a la ruta con el identificador en la mano.
 */
export async function ejecutarOrdenPago(
  db: Db,
  empresaId: string,
  usuarioId: string,
  ordenId: string,
  datos: { fecha: string; tipoCambio?: string; cuentaEfectivoId?: string; referencia?: string },
): Promise<PagoRegistrado & { numeroPago: string }> {
  const { cabecera, documentos } = await cargarOrdenPago(db, ordenId);
  if (cabecera.estado !== ESTADO_ORDEN_PAGO.AUTORIZADA) {
    throw new OrdenPagoInvalida([
      cabecera.estado === ESTADO_ORDEN_PAGO.PAGADA
        ? "la orden ya se pagó"
        : `la orden está ${cabecera.estado}: sólo se paga lo autorizado`,
    ]);
  }

  const cuentaEfectivoId = datos.cuentaEfectivoId ?? cabecera.cuentaEfectivoId;
  const cuentaOrigen = cuentaEfectivoId
    ? (
        await db
          .select({ cuentaContable: cuentasEfectivo.cuentaContable })
          .from(cuentasEfectivo)
          .where(eq(cuentasEfectivo.id, cuentaEfectivoId))
          .limit(1)
      )[0]?.cuentaContable
    : undefined;

  const numeroPago = await siguienteNumero(
    db, pagos, pagos.numero, "PG", datos.fecha.slice(0, 4),
  );

  const pago = await registrarPago(db, empresaId, usuarioId, {
    numero: numeroPago,
    proveedorId: cabecera.proveedorId,
    fecha: datos.fecha,
    moneda: cabecera.moneda,
    tipoCambio: datos.tipoCambio ?? cabecera.tipoCambio,
    medioPago: cabecera.medioPago,
    // Sin cuenta de efectivo elegida se cae a la caja general, que es lo que
    // hacía el módulo antes de que existieran las cuentas.
    cuentaOrigen: cuentaOrigen ?? (await cuentasDe(db)).get("caja_por_defecto"),
    ...(cuentaEfectivoId ? { cuentaEfectivoId } : {}),
    ...(cabecera.retenerIgv ? { retenerIgv: true } : {}),
    ...(datos.referencia ? { referencia: datos.referencia } : {}),
    aplicaciones: documentos.map((d) => ({ documentoId: d.documentoId, importe: d.importe })),
  });

  await db
    .update(ordenesPago)
    .set({ estado: ESTADO_ORDEN_PAGO.PAGADA, pagoId: pago.pagoId })
    .where(eq(ordenesPago.id, ordenId));

  return { ...pago, numeroPago };
}

export const listarOrdenesPago = (db: Db, estado?: string) =>
  db
    .select({
      id: ordenesPago.id,
      numero: ordenesPago.numero,
      fecha: ordenesPago.fecha,
      fechaProgramada: ordenesPago.fechaProgramada,
      proveedor: terceros.razonSocial,
      moneda: ordenesPago.moneda,
      importe: ordenesPago.importe,
      medioPago: ordenesPago.medioPago,
      estado: ordenesPago.estado,
      motivoRechazo: ordenesPago.motivoRechazo,
      solicitante: usuarios.nombre,
    })
    .from(ordenesPago)
    .innerJoin(terceros, eq(terceros.id, ordenesPago.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, ordenesPago.solicitadaPor))
    .where(estado ? eq(ordenesPago.estado, estado) : sql`true`)
    .orderBy(desc(ordenesPago.fecha), desc(ordenesPago.numero))
    .limit(300);

export async function cargarOrdenPago(db: Db, ordenId: string) {
  const [cabecera] = await db
    .select({
      id: ordenesPago.id,
      numero: ordenesPago.numero,
      fecha: ordenesPago.fecha,
      fechaProgramada: ordenesPago.fechaProgramada,
      proveedorId: ordenesPago.proveedorId,
      proveedor: terceros.razonSocial,
      documentoProveedor: terceros.numeroDocumento,
      moneda: ordenesPago.moneda,
      tipoCambio: ordenesPago.tipoCambio,
      importe: ordenesPago.importe,
      medioPago: ordenesPago.medioPago,
      cuentaEfectivoId: ordenesPago.cuentaEfectivoId,
      retenerIgv: ordenesPago.retenerIgv,
      estado: ordenesPago.estado,
      observaciones: ordenesPago.observaciones,
      motivoRechazo: ordenesPago.motivoRechazo,
      pagoId: ordenesPago.pagoId,
    })
    .from(ordenesPago)
    .innerJoin(terceros, eq(terceros.id, ordenesPago.proveedorId))
    .where(eq(ordenesPago.id, ordenId))
    .limit(1);
  if (!cabecera) throw new OrdenPagoInvalida(["la orden de pago no existe"]);

  const documentos = await db
    .select({
      documentoId: ordenPagoDocumentos.documentoId,
      importe: ordenPagoDocumentos.importe,
      tipoDocumento: documentosCxp.tipoDocumento,
      serie: documentosCxp.serie,
      numero: documentosCxp.numero,
      fechaEmision: documentosCxp.fechaEmision,
      fechaVencimiento: documentosCxp.fechaVencimiento,
      total: documentosCxp.total,
      saldo: documentosCxp.saldo,
      estadoDocumento: documentosCxp.estado,
    })
    .from(ordenPagoDocumentos)
    .innerJoin(documentosCxp, eq(documentosCxp.id, ordenPagoDocumentos.documentoId))
    .where(eq(ordenPagoDocumentos.ordenId, ordenId))
    .orderBy(asc(documentosCxp.fechaVencimiento));

  return { cabecera, documentos };
}

/**
 * Documentos de un proveedor con el saldo que todavía no está en ninguna orden.
 *
 * Es lo que se ofrece al armar una orden nueva: mostrar el saldo entero cuando
 * la mitad ya está comprometida lleva a ordenar dos veces lo mismo.
 */
export async function documentosOrdenables(db: Db, proveedorId: string) {
  const abiertos = await db
    .select({
      id: documentosCxp.id,
      tipoDocumento: documentosCxp.tipoDocumento,
      serie: documentosCxp.serie,
      numero: documentosCxp.numero,
      fechaEmision: documentosCxp.fechaEmision,
      fechaVencimiento: documentosCxp.fechaVencimiento,
      moneda: documentosCxp.moneda,
      total: documentosCxp.total,
      saldo: documentosCxp.saldo,
    })
    .from(documentosCxp)
    .where(
      and(
        eq(documentosCxp.proveedorId, proveedorId),
        sql`${documentosCxp.saldo} > 0`,
        sql`${documentosCxp.estado} NOT IN ('anulado', 'canjeado')`,
      ),
    )
    .orderBy(asc(documentosCxp.fechaVencimiento));

  const comprometido = await comprometidoPorOrdenes(db, abiertos.map((d) => d.id));

  return abiertos
    .map((d) => {
      const enOrden = comprometido.get(d.id) ?? money.ZERO;
      return { ...d, enOrden: txt2(enOrden), libre: txt2(money.sub(dec(d.saldo), enOrden)) };
    })
    .filter((d) => money.gt(dec(d.libre), money.ZERO));
}

// ─── Estado de cuenta del proveedor ───────────────────────────────────────

export type MovimientoCuenta = {
  fecha: string;
  tipo: "documento" | "pago";
  referencia: string;
  glosa: string;
  moneda: string;
  cargo: string;
  abono: string;
  saldo: string;
};

/**
 * Estado de cuenta de un proveedor: todo lo que se le debió y todo lo que se le
 * pagó, en orden, con el saldo corriendo.
 *
 * Es el documento que se le manda cuando reclama, y el que se concilia con el
 * suyo. La antigüedad de saldos dice cuánto se debe hoy; esto dice **por qué**.
 *
 * El saldo corre en la moneda de cada documento, así que un proveedor con
 * facturas en dos monedas devuelve dos series: mezclarlas daría una cifra que no
 * significa nada.
 */
export async function estadoCuentaProveedor(
  db: Db,
  proveedorId: string,
  rango?: { desde?: string; hasta?: string },
): Promise<{ moneda: string; movimientos: MovimientoCuenta[]; saldoFinal: string }[]> {
  const cond = [eq(documentosCxp.proveedorId, proveedorId)];
  if (rango?.desde) cond.push(sql`${documentosCxp.fechaEmision} >= ${rango.desde}`);
  if (rango?.hasta) cond.push(sql`${documentosCxp.fechaEmision} <= ${rango.hasta}`);

  const docs = await db
    .select({
      id: documentosCxp.id,
      fecha: documentosCxp.fechaEmision,
      tipoDocumento: documentosCxp.tipoDocumento,
      serie: documentosCxp.serie,
      numero: documentosCxp.numero,
      moneda: documentosCxp.moneda,
      total: documentosCxp.total,
      estado: documentosCxp.estado,
    })
    .from(documentosCxp)
    .where(and(...cond))
    .orderBy(asc(documentosCxp.fechaEmision));

  const aplicaciones = docs.length
    ? await db
        .select({
          documentoId: pagoAplicaciones.documentoId,
          importe: pagoAplicaciones.importeAplicado,
          fecha: pagos.fecha,
          numero: pagos.numero,
          medioPago: pagos.medioPago,
          estado: pagos.estado,
        })
        .from(pagoAplicaciones)
        .innerJoin(pagos, eq(pagos.id, pagoAplicaciones.pagoId))
        .where(inArray(pagoAplicaciones.documentoId, docs.map((d) => d.id)))
    : [];

  const porMoneda = new Map<string, MovimientoCuenta[]>();
  const monedaDe = new Map(docs.map((d) => [d.id, d.moneda]));

  for (const d of docs) {
    if (d.estado === "anulado") continue;
    const lista = porMoneda.get(d.moneda) ?? [];
    lista.push({
      fecha: d.fecha,
      tipo: "documento",
      referencia: `${d.serie}-${d.numero}`,
      glosa: "Documento por pagar",
      moneda: d.moneda,
      cargo: txt2(dec(d.total)),
      abono: "0.00",
      saldo: "0.00",
    });
    porMoneda.set(d.moneda, lista);
  }

  for (const a of aplicaciones) {
    if (a.estado === "anulado") continue;
    const moneda = monedaDe.get(a.documentoId);
    if (!moneda) continue;
    const lista = porMoneda.get(moneda) ?? [];
    lista.push({
      fecha: a.fecha,
      tipo: "pago",
      referencia: a.numero,
      glosa: `Pago por ${a.medioPago}`,
      moneda,
      cargo: "0.00",
      abono: txt2(dec(a.importe)),
      saldo: "0.00",
    });
    porMoneda.set(moneda, lista);
  }

  return [...porMoneda]
    .map(([moneda, movimientos]) => {
      // El documento va antes que su pago cuando caen el mismo día: un abono
      // que aparece antes del cargo deja el saldo en negativo un renglón, y el
      // que lo lee cree que se pagó de más.
      movimientos.sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          (a.tipo === b.tipo ? 0 : a.tipo === "documento" ? -1 : 1),
      );
      let saldo = money.ZERO;
      for (const m of movimientos) {
        saldo = money.add(money.sub(saldo, dec(m.abono)), dec(m.cargo));
        m.saldo = txt2(saldo);
      }
      return { moneda, movimientos, saldoFinal: txt2(saldo) };
    })
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}
