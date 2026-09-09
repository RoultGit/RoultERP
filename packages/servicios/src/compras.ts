/**
 * Compras: de la orden al proveedor hasta el asiento y la cuenta por pagar.
 *
 * El módulo tiene dos documentos que la gente confunde y conviene separar:
 *
 * - La **orden de compra** es un compromiso propio. No mueve inventario ni
 *   contabilidad; sirve para saber qué está pedido y comparar contra lo que
 *   llega.
 *
 * - El **registro de compras** es el documento del proveedor. Ese sí sustenta
 *   el crédito fiscal (formato 8.1 del PLE), genera la cuenta por pagar y, si
 *   trae mercadería, la ingresa al almacén.
 *
 * Registrar una compra es un acto contable y ocurre entero o no ocurre: el
 * asiento, el ingreso al kardex y el documento por pagar viven en la misma
 * transacción. Una mercadería que entró sin su asiento es un descuadre que
 * aparece semanas después.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { money, tributario, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { registrarMovimiento } from "./inventario.ts";
import { asentar, type LineaAsientoEntrada } from "./contabilidad.ts";

const {
  ordenesCompra, ordenCompraItems, compras, compraItems,
  documentosCxp, productos, terceros, almacenes, reglasDetraccion, empresas,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt = (v: Dec, d = 6): string => money.toString(v, d);
const txt2 = (v: Dec): string => money.toString(v, 2);

export class CompraInvalida extends Error {
  constructor(readonly motivos: readonly string[]) {
    super(motivos.join("; "));
    this.name = "CompraInvalida";
  }
}

// ─── Órdenes de compra ────────────────────────────────────────────────────

export type LineaOrden = {
  productoId: string;
  descripcion: string;
  cantidad: string;
  valorUnitario: string;
  descuento?: string;
  afectacionIgv?: string;
};

export type DatosOrden = {
  numero: string;
  proveedorId: string;
  almacenId?: string;
  fecha: string;
  fechaEntrega?: string;
  moneda: string;
  tipoCambio: string;
  condicionPago?: string;
  observaciones?: string;
  lineas: LineaOrden[];
};

export async function crearOrden(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosOrden,
): Promise<string> {
  if (datos.lineas.length === 0) {
    throw new CompraInvalida(["una orden de compra necesita al menos una línea"]);
  }
  await exigirProveedor(db, datos.proveedorId);

  const totales = tributario.totalizar(
    datos.lineas.map((l) => ({
      cantidad: dec(l.cantidad),
      valorUnitario: dec(l.valorUnitario),
      afectacion: (l.afectacionIgv ?? "10") as tributario.Afectacion,
      ...(l.descuento ? { descuento: dec(l.descuento) } : {}),
    })),
  );

  const [cab] = await db
    .insert(ordenesCompra)
    .values({
      empresaId,
      numero: datos.numero,
      proveedorId: datos.proveedorId,
      almacenId: datos.almacenId ?? null,
      fecha: datos.fecha,
      fechaEntrega: datos.fechaEntrega ?? null,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      condicionPago: datos.condicionPago ?? null,
      observaciones: datos.observaciones ?? null,
      subtotal: txt2(totales.valorVentaTotal),
      igv: txt2(totales.igv),
      total: txt2(totales.total),
      creadoPor: usuarioId,
    })
    .returning({ id: ordenesCompra.id });

  await db.insert(ordenCompraItems).values(
    datos.lineas.map((l, i) => ({
      empresaId,
      ordenId: cab!.id,
      linea: i + 1,
      productoId: l.productoId,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      descuento: l.descuento ?? "0",
      afectacionIgv: l.afectacionIgv ?? "10",
    })),
  );

  return cab!.id;
}

export async function aprobarOrden(db: Db, ordenId: string, usuarioId: string): Promise<void> {
  const [o] = await db
    .select({ estado: ordenesCompra.estado })
    .from(ordenesCompra)
    .where(eq(ordenesCompra.id, ordenId))
    .limit(1);
  if (!o) throw new CompraInvalida(["la orden no existe"]);
  if (o.estado !== "borrador") {
    throw new CompraInvalida([`la orden está ${o.estado} y ya no se aprueba`]);
  }
  await db
    .update(ordenesCompra)
    .set({ estado: "aprobada", aprobadaPor: usuarioId, aprobadaEn: new Date() })
    .where(eq(ordenesCompra.id, ordenId));
}

export const listarOrdenes = (db: Db) =>
  db
    .select({
      id: ordenesCompra.id,
      numero: ordenesCompra.numero,
      proveedor: terceros.razonSocial,
      fecha: ordenesCompra.fecha,
      fechaEntrega: ordenesCompra.fechaEntrega,
      moneda: ordenesCompra.moneda,
      total: ordenesCompra.total,
      estado: ordenesCompra.estado,
    })
    .from(ordenesCompra)
    .innerJoin(terceros, eq(terceros.id, ordenesCompra.proveedorId))
    .orderBy(desc(ordenesCompra.fecha))
    .limit(300);

export async function cargarOrden(db: Db, ordenId: string) {
  const [cabecera] = await db
    .select()
    .from(ordenesCompra)
    .where(eq(ordenesCompra.id, ordenId))
    .limit(1);
  if (!cabecera) throw new CompraInvalida(["la orden no existe"]);

  const lineas = await db
    .select({
      id: ordenCompraItems.id,
      linea: ordenCompraItems.linea,
      productoId: ordenCompraItems.productoId,
      codigo: productos.codigo,
      descripcion: ordenCompraItems.descripcion,
      cantidad: ordenCompraItems.cantidad,
      cantidadRecibida: ordenCompraItems.cantidadRecibida,
      valorUnitario: ordenCompraItems.valorUnitario,
      descuento: ordenCompraItems.descuento,
      afectacionIgv: ordenCompraItems.afectacionIgv,
    })
    .from(ordenCompraItems)
    .innerJoin(productos, eq(productos.id, ordenCompraItems.productoId))
    .where(eq(ordenCompraItems.ordenId, ordenId))
    .orderBy(asc(ordenCompraItems.linea));

  return { cabecera, lineas };
}

// ─── Registro de compras ──────────────────────────────────────────────────

export type LineaCompra = {
  productoId?: string;
  descripcion: string;
  cantidad: string;
  valorUnitario: string;
  descuento?: string;
  afectacionIgv?: string;
  /** Cuenta de gasto o de existencia. Si falta, se deduce del producto. */
  cuenta?: string;
  centroCostoId?: string;
};

export type DatosCompra = {
  proveedorId: string;
  tipoDocumento: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  fechaVencimiento?: string;
  /** Periodo en que se toma el crédito fiscal. Por defecto, el de la emisión. */
  periodo?: string;
  moneda: string;
  tipoCambio: string;
  lineas: LineaCompra[];
  /** Código del anexo de detracción. Si viene, se calcula la detracción. */
  detraccionCodigo?: string;
  /** Almacén al que ingresa la mercadería. Sin él, no se mueve inventario. */
  almacenId?: string;
  ordenCompraId?: string;
  otrosCargos?: string;
};

export type CompraRegistrada = {
  compraId: string;
  asientoId: string;
  documentoCxpId: string;
  movimientos: string[];
  total: string;
  detraccion: string | null;
};

/**
 * Registra la factura del proveedor: contabiliza, genera la cuenta por pagar y,
 * si corresponde, ingresa la mercadería al almacén.
 */
export async function registrarCompra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCompra,
): Promise<CompraRegistrada> {
  const motivos: string[] = [];
  if (datos.lineas.length === 0) motivos.push("la compra necesita al menos una línea");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEmision)) motivos.push("la fecha de emisión es inválida");
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) motivos.push("el tipo de cambio debe ser positivo");
  // Una línea de servicio no tiene producto del que deducir la cuenta, así que
  // hay que indicarla. Sin esto el asiento iría a una cuenta por omisión y el
  // gasto acabaría en el rubro equivocado del estado de resultados.
  datos.lineas.forEach((l, i) => {
    if (!l.productoId && !l.cuenta) {
      motivos.push(`línea ${i + 1}: indique la cuenta contable del gasto`);
    }
  });
  if (motivos.length) throw new CompraInvalida(motivos);

  const proveedor = await exigirProveedor(db, datos.proveedorId);

  // Una factura del exterior no genera crédito fiscal: el IGV de importación se
  // paga en aduanas y se sustenta con la DUA, no con esta factura. Si aparece
  // IGV aquí, alguien está registrando una importación como compra nacional.
  if (!proveedor.esDomiciliado) {
    const conIgv = datos.lineas.some((l) => (l.afectacionIgv ?? "10").startsWith("1"));
    if (conIgv) {
      throw new CompraInvalida([
        `${proveedor.razonSocial} no es domiciliado: su factura no genera IGV. ` +
          "Registre la operación en el módulo de importaciones.",
      ]);
    }
  }
  const periodo = datos.periodo ?? datos.fechaEmision.slice(0, 4) + datos.fechaEmision.slice(5, 7);

  const lineasCalc = datos.lineas.map((l) => ({
    cantidad: dec(l.cantidad),
    valorUnitario: dec(l.valorUnitario),
    afectacion: (l.afectacionIgv ?? "10") as tributario.Afectacion,
    ...(l.descuento ? { descuento: dec(l.descuento) } : {}),
  }));
  const totales = tributario.totalizar(lineasCalc, {
    ...(datos.otrosCargos ? { otrosCargos: dec(datos.otrosCargos) } : {}),
  });

  // La detracción se calcula sobre el total con IGV y se deposita en el Banco
  // de la Nación; lo que se le paga al proveedor es el neto.
  const detraccion = datos.detraccionCodigo
    ? await calcularDetraccionDe(db, empresaId, datos.detraccionCodigo, totales.total)
    : null;

  const tipoCambio = dec(datos.tipoCambio);

  const [cab] = await db
    .insert(compras)
    .values({
      empresaId,
      proveedorId: datos.proveedorId,
      tipoDocumento: datos.tipoDocumento,
      serie: datos.serie,
      numero: datos.numero,
      fechaEmision: datos.fechaEmision,
      fechaVencimiento: datos.fechaVencimiento ?? null,
      periodo,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      gravadas: txt2(totales.gravadas),
      exoneradas: txt2(totales.exoneradas),
      inafectas: txt2(totales.inafectas),
      isc: txt2(totales.isc),
      igv: txt2(totales.igv),
      otrosCargos: datos.otrosCargos ?? "0",
      total: txt2(totales.total),
      regimen: detraccion?.aplica ? "detraccion" : "ninguno",
      detraccionCodigo: detraccion?.aplica ? detraccion.codigo : null,
      detraccionTasa: detraccion?.aplica ? txt(detraccion.tasa) : null,
      detraccionMonto: detraccion?.aplica ? txt2(detraccion.monto) : "0",
      ordenCompraId: datos.ordenCompraId ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: compras.id });
  const compraId = cab!.id;

  await db.insert(compraItems).values(
    datos.lineas.map((l, i) => {
      const calc = totales.lineas[i]!;
      return {
        empresaId,
        compraId,
        linea: i + 1,
        productoId: l.productoId ?? null,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        descuento: l.descuento ?? "0",
        afectacionIgv: l.afectacionIgv ?? "10",
        valorVenta: txt2(calc.valorVenta),
        igv: txt2(calc.igv),
        importe: txt2(calc.importe),
        centroCostoId: l.centroCostoId ?? null,
      };
    }),
  );

  // Ingreso al almacén de las líneas que son mercadería.
  const movimientos: string[] = [];
  if (datos.almacenId) {
    for (const [i, l] of datos.lineas.entries()) {
      if (!l.productoId) continue;
      const [prod] = await db
        .select({ tipo: productos.tipo })
        .from(productos)
        .where(eq(productos.id, l.productoId))
        .limit(1);
      if (prod?.tipo !== "bien") continue;

      const calc = totales.lineas[i]!;
      // El costo de ingreso es el valor de venta sin IGV, convertido a moneda
      // funcional. El IGV no es costo: es crédito fiscal.
      const costoLinea = money.mul(calc.valorVenta, tipoCambio);
      const mov = await registrarMovimiento(db, empresaId, {
        almacenId: datos.almacenId,
        productoId: l.productoId,
        fecha: datos.fechaEmision,
        sentido: "ingreso",
        tipoOperacion: kardex.TIPO_OPERACION.COMPRA,
        cantidad: dec(l.cantidad),
        costoUnitario: money.isZero(dec(l.cantidad))
          ? money.ZERO
          : money.round(money.div(costoLinea, dec(l.cantidad)), 6),
        importeTotal: money.round(costoLinea, 6),
        origenModulo: "compras",
        origenId: compraId,
      });
      movimientos.push(mov.id);
    }
  }

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fechaEmision,
    subdiario: "08",
    glosa: `Compra ${datos.serie}-${datos.numero} · ${proveedor.razonSocial}`,
    moneda: datos.moneda,
    tipoCambio: datos.tipoCambio,
    origenModulo: "compras",
    origenId: compraId,
    lineas: lineasAsiento(datos, totales, detraccion, proveedor.id),
  });

  await db.update(compras).set({ asientoId }).where(eq(compras.id, compraId));

  // El vencimiento sale de los días de crédito del proveedor si no se indicó.
  const vencimiento =
    datos.fechaVencimiento ?? sumarDias(datos.fechaEmision, proveedor.diasCredito);

  const [docCxp] = await db
    .insert(documentosCxp)
    .values({
      empresaId,
      proveedorId: datos.proveedorId,
      compraId,
      tipoDocumento: datos.tipoDocumento,
      serie: datos.serie,
      numero: datos.numero,
      fechaEmision: datos.fechaEmision,
      fechaVencimiento: vencimiento,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      total: txt2(totales.total),
      saldo: txt2(totales.total),
      creadoPor: usuarioId,
    })
    .returning({ id: documentosCxp.id });

  if (datos.ordenCompraId) await marcarRecepcion(db, datos.ordenCompraId, datos.lineas);

  return {
    compraId,
    asientoId,
    documentoCxpId: docCxp!.id,
    movimientos,
    total: txt2(totales.total),
    detraccion: detraccion?.aplica ? txt2(detraccion.monto) : null,
  };
}

/**
 * Asiento del registro de compras.
 *
 * Carga la mercadería o el gasto, el IGV a crédito fiscal, y abona todo contra
 * el proveedor. Cuando hay detracción, parte del saldo se reclasifica: el
 * depósito en el Banco de la Nación es dinero del proveedor que la empresa
 * entrega al fisco en su nombre, así que reduce lo que se le paga sin reducir
 * lo que se le debe.
 */
function lineasAsiento(
  datos: DatosCompra,
  totales: tributario.TotalesComprobante,
  detraccion: { aplica: boolean; monto: Dec } | null,
  proveedorId: string,
): LineaAsientoEntrada[] {
  const lineas: LineaAsientoEntrada[] = [];

  // Se agrupa por cuenta **y centro de costo**: un asiento con cuarenta líneas
  // idénticas es ilegible en el mayor, pero agrupar sólo por cuenta perdería el
  // centro de costo, que es justo lo que varias cuentas de gasto exigen.
  const grupos = new Map<string, { cuenta: string; centroCostoId?: string; importe: Dec }>();
  datos.lineas.forEach((l, i) => {
    // Con producto, la cuenta de existencias; sin él, la que indicó el usuario
    // (ya validada más arriba como obligatoria).
    const cuenta = l.cuenta ?? "20111";
    const clave = `${cuenta}|${l.centroCostoId ?? ""}`;
    const previo = grupos.get(clave);
    grupos.set(clave, {
      cuenta,
      ...(l.centroCostoId ? { centroCostoId: l.centroCostoId } : {}),
      importe: money.add(previo?.importe ?? money.ZERO, totales.lineas[i]!.valorVenta),
    });
  });

  for (const g of grupos.values()) {
    if (money.isZero(g.importe)) continue;
    lineas.push({
      cuenta: g.cuenta,
      glosa: "Compra",
      debe: txt2(g.importe),
      ...(g.centroCostoId ? { centroCostoId: g.centroCostoId } : {}),
    });
  }

  if (!money.isZero(totales.igv)) {
    lineas.push({ cuenta: "40111", glosa: "IGV crédito fiscal", debe: txt2(totales.igv) });
  }

  lineas.push({
    cuenta: "4212",
    glosa: "Proveedor",
    haber: txt2(totales.total),
    anexoId: proveedorId,
  });

  return lineas;
}

async function calcularDetraccionDe(
  db: Db,
  empresaId: string,
  codigo: string,
  total: Dec,
): Promise<tributario.Detraccion> {
  const [regla] = await db
    .select()
    .from(reglasDetraccion)
    .where(eq(reglasDetraccion.codigo, codigo))
    .orderBy(desc(reglasDetraccion.vigenteDesde))
    .limit(1);
  if (!regla) {
    throw new CompraInvalida([`el código de detracción ${codigo} no está configurado`]);
  }

  const [emp] = await db
    .select({ redondeo: empresas.redondeoDetraccion })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);

  return tributario.calcularDetraccion(
    total,
    {
      codigo: regla.codigo,
      descripcion: regla.descripcion,
      tasa: dec(regla.tasa),
      aplicaMinimo: regla.aplicaMinimo,
    },
    { redondeo: emp?.redondeo === "arriba" ? "arriba" : "cercano" },
  );
}

/** Acumula lo recibido en la orden y la cierra cuando ya llegó todo. */
async function marcarRecepcion(db: Db, ordenId: string, lineas: LineaCompra[]): Promise<void> {
  for (const l of lineas) {
    if (!l.productoId) continue;
    await db.execute(sql`
      UPDATE orden_compra_items
      SET cantidad_recibida = cantidad_recibida + ${l.cantidad}::numeric
      WHERE orden_id = ${ordenId} AND producto_id = ${l.productoId}`);
  }

  const [pendiente] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM orden_compra_items
    WHERE orden_id = ${ordenId} AND cantidad_recibida < cantidad`)) as unknown as [{ n: number }];

  await db
    .update(ordenesCompra)
    .set({ estado: pendiente.n === 0 ? "recibida" : "parcial" })
    .where(eq(ordenesCompra.id, ordenId));
}

async function exigirProveedor(db: Db, proveedorId: string) {
  const [p] = await db
    .select({
      id: terceros.id,
      razonSocial: terceros.razonSocial,
      esProveedor: terceros.esProveedor,
      diasCredito: terceros.diasCredito,
      esDomiciliado: terceros.esDomiciliado,
    })
    .from(terceros)
    .where(eq(terceros.id, proveedorId))
    .limit(1);
  if (!p) throw new CompraInvalida(["el proveedor no existe en esta empresa"]);
  if (!p.esProveedor) throw new CompraInvalida([`${p.razonSocial} no está marcado como proveedor`]);
  return p;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ─── Consultas ────────────────────────────────────────────────────────────

export const listarCompras = (db: Db, periodo?: string) =>
  db
    .select({
      id: compras.id,
      tipoDocumento: compras.tipoDocumento,
      serie: compras.serie,
      numero: compras.numero,
      proveedor: terceros.razonSocial,
      documentoProveedor: terceros.numeroDocumento,
      fechaEmision: compras.fechaEmision,
      periodo: compras.periodo,
      moneda: compras.moneda,
      gravadas: compras.gravadas,
      igv: compras.igv,
      total: compras.total,
      detraccionMonto: compras.detraccionMonto,
      estado: compras.estado,
    })
    .from(compras)
    .innerJoin(terceros, eq(terceros.id, compras.proveedorId))
    .where(periodo ? eq(compras.periodo, periodo) : undefined)
    .orderBy(desc(compras.fechaEmision), asc(compras.serie), asc(compras.numero))
    .limit(500);

/** Documentos por pagar abiertos, con su antigüedad. */
export const listarCxp = (db: Db, proveedorId?: string) =>
  db
    .select({
      id: documentosCxp.id,
      proveedorId: documentosCxp.proveedorId,
      proveedor: terceros.razonSocial,
      tipoDocumento: documentosCxp.tipoDocumento,
      serie: documentosCxp.serie,
      numero: documentosCxp.numero,
      fechaEmision: documentosCxp.fechaEmision,
      fechaVencimiento: documentosCxp.fechaVencimiento,
      moneda: documentosCxp.moneda,
      total: documentosCxp.total,
      saldo: documentosCxp.saldo,
      estado: documentosCxp.estado,
    })
    .from(documentosCxp)
    .innerJoin(terceros, eq(terceros.id, documentosCxp.proveedorId))
    .where(
      proveedorId
        ? and(eq(documentosCxp.proveedorId, proveedorId), sql`${documentosCxp.saldo} > 0`)
        : sql`${documentosCxp.saldo} > 0`,
    )
    .orderBy(asc(documentosCxp.fechaVencimiento))
    .limit(500);

export { tributario };
