/**
 * Importaciones: del pedido al exterior hasta el costo con el que la mercadería
 * entra al almacén.
 *
 * El ciclo es: se registra la orden con sus ítems y su FOB, se van cargando los
 * gastos conforme llegan las facturas —flete, seguro, agente de aduanas, la
 * liquidación de la DUA—, y al final se liquida: los gastos se prorratean sobre
 * los ítems y sale el costo unitario real.
 *
 * La liquidación es la operación que da sentido al módulo. Sin ella el
 * importador registra su mercadería al valor de la factura del exterior y
 * descubre su margen real meses después. Con ella sabe, el día que nacionaliza,
 * cuánto le costó de verdad cada unidad.
 *
 * Confirmar una liquidación es un acto contable: crea los movimientos de
 * inventario y el asiento, y ya no se edita. Si algo estaba mal se anula y se
 * vuelve a liquidar, dejando el rastro de las dos.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { money, importaciones as dominio, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { registrarMovimiento } from "./inventario.ts";
import { asentar, type LineaAsientoEntrada } from "./contabilidad.ts";

const {
  importaciones: tImportaciones,
  importacionItems,
  importacionGastos,
  liquidaciones,
  liquidacionItems,
  productos,
  terceros,
  almacenes,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt = (v: Dec, d = 6): string => money.toString(v, d);
const txt2 = (v: Dec): string => money.toString(v, 2);

export class ImportacionInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ImportacionInvalida";
  }
}

/** Estados por los que pasa un embarque, en orden. */
export const ESTADOS = [
  "borrador",
  "aprobada",
  "en_transito",
  "en_aduana",
  "nacionalizada",
  "liquidada",
] as const;
export type EstadoImportacion = (typeof ESTADOS)[number] | "anulada";

/** Sólo se avanza al siguiente estado, o se anula. Nada de saltos hacia atrás. */
export function puedeAvanzar(desde: string, hasta: string): boolean {
  if (hasta === "anulada") return desde !== "liquidada";
  const i = ESTADOS.indexOf(desde as (typeof ESTADOS)[number]);
  const j = ESTADOS.indexOf(hasta as (typeof ESTADOS)[number]);
  return i !== -1 && j === i + 1;
}

// ─── Alta y edición ───────────────────────────────────────────────────────

export type DatosImportacion = {
  numero: string;
  proveedorId: string;
  almacenId: string;
  moneda: string;
  tipoCambio: string;
  incoterm?: string;
  fechaOrden: string;
  facturaExterior?: string;
  puertoOrigen?: string;
  puertoDestino?: string;
  observaciones?: string;
};

export async function crearImportacion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosImportacion,
): Promise<string> {
  const [prov] = await db
    .select({ esProveedor: terceros.esProveedor, razon: terceros.razonSocial })
    .from(terceros)
    .where(eq(terceros.id, datos.proveedorId))
    .limit(1);
  if (!prov) throw new ImportacionInvalida("el proveedor no existe en esta empresa");
  if (!prov.esProveedor) {
    throw new ImportacionInvalida(`${prov.razon} no está marcado como proveedor`);
  }
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) {
    throw new ImportacionInvalida("el tipo de cambio debe ser positivo");
  }

  const [fila] = await db
    .insert(tImportaciones)
    .values({
      empresaId,
      numero: datos.numero,
      proveedorId: datos.proveedorId,
      almacenId: datos.almacenId,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      incoterm: datos.incoterm ?? null,
      fechaOrden: datos.fechaOrden,
      facturaExterior: datos.facturaExterior ?? null,
      puertoOrigen: datos.puertoOrigen ?? null,
      puertoDestino: datos.puertoDestino ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: tImportaciones.id });
  return fila!.id;
}

export type DatosItem = {
  productoId: string;
  descripcion: string;
  cantidad: string;
  fobUnitario: string;
  peso?: string;
  volumen?: string;
  partidaArancelaria?: string;
};

export async function agregarItem(
  db: Db,
  empresaId: string,
  importacionId: string,
  datos: DatosItem,
): Promise<string> {
  await exigirEditable(db, importacionId);

  const [prod] = await db
    .select({ tipo: productos.tipo, pesoUnitario: productos.pesoUnitario, codigo: productos.codigo })
    .from(productos)
    .where(eq(productos.id, datos.productoId))
    .limit(1);
  if (!prod) throw new ImportacionInvalida("el producto no existe en esta empresa");
  if (prod.tipo !== "bien") {
    throw new ImportacionInvalida(`${prod.codigo} es un servicio y no se importa como mercadería`);
  }
  if (!money.gt(dec(datos.cantidad), money.ZERO)) {
    throw new ImportacionInvalida("la cantidad debe ser mayor que cero");
  }

  const [{ siguiente }] = await db.execute<{ siguiente: number }>(sql`
    SELECT coalesce(max(linea), 0) + 1 AS siguiente
    FROM importacion_items WHERE importacion_id = ${importacionId}`) as unknown as [
    { siguiente: number },
  ];

  // Si no se indica el peso de la línea pero el producto tiene peso unitario, se
  // deduce: sin peso no se puede prorratear el flete, y es el error que más
  // veces bloquea una liquidación a mitad de camino.
  const peso =
    datos.peso ??
    (prod.pesoUnitario
      ? txt(money.mul(dec(datos.cantidad), dec(prod.pesoUnitario)))
      : null);

  const [fila] = await db
    .insert(importacionItems)
    .values({
      empresaId,
      importacionId,
      linea: siguiente,
      productoId: datos.productoId,
      descripcion: datos.descripcion,
      cantidad: datos.cantidad,
      fobUnitario: datos.fobUnitario,
      peso,
      volumen: datos.volumen ?? null,
      partidaArancelaria: datos.partidaArancelaria ?? null,
    })
    .returning({ id: importacionItems.id });
  return fila!.id;
}

export type DatosGasto = {
  concepto: string;
  importe: string;
  moneda: string;
  tipoCambio: string;
  baseProrrateo: dominio.BaseProrrateo;
  afectaCosto: boolean;
  itemId?: string;
  proveedorId?: string;
  documento?: string;
  fecha?: string;
};

export async function agregarGasto(
  db: Db,
  empresaId: string,
  importacionId: string,
  datos: DatosGasto,
): Promise<string> {
  await exigirEditable(db, importacionId);
  if (datos.baseProrrateo === "directo" && !datos.itemId) {
    throw new ImportacionInvalida("un gasto directo tiene que indicar a qué ítem se carga");
  }
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) {
    throw new ImportacionInvalida("el tipo de cambio del gasto debe ser positivo");
  }

  const [fila] = await db
    .insert(importacionGastos)
    .values({
      empresaId,
      importacionId,
      concepto: datos.concepto,
      importe: datos.importe,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      baseProrrateo: datos.baseProrrateo,
      afectaCosto: datos.afectaCosto,
      itemId: datos.itemId ?? null,
      proveedorId: datos.proveedorId ?? null,
      documento: datos.documento ?? null,
      fecha: datos.fecha ?? null,
    })
    .returning({ id: importacionGastos.id });
  return fila!.id;
}

// ─── Liquidación ──────────────────────────────────────────────────────────

export type VistaPreviaLiquidacion = {
  liquidacion: dominio.Liquidacion;
  cuadra: boolean;
  diferencias: { concepto: string; esperado: string; repartido: string }[];
};

/**
 * Calcula la liquidación sin guardar nada.
 *
 * Es lo que ve el usuario mientras arma el embarque: puede añadir un gasto y
 * comprobar en el acto cómo se mueve el costo unitario, antes de comprometer
 * nada al inventario ni a la contabilidad.
 */
export async function previsualizarLiquidacion(
  db: Db,
  importacionId: string,
): Promise<VistaPreviaLiquidacion> {
  const { cabecera, items, gastos } = await cargar(db, importacionId);

  if (items.length === 0) {
    throw new ImportacionInvalida("la importación no tiene ítems que liquidar");
  }

  const liquidacion = dominio.liquidar(
    items.map((i) => ({
      id: i.id,
      productoId: i.productoId,
      cantidad: dec(i.cantidad),
      fobUnitario: dec(i.fobUnitario),
      ...(i.peso !== null ? { peso: dec(i.peso) } : {}),
      ...(i.volumen !== null ? { volumen: dec(i.volumen) } : {}),
    })),
    gastos.map((g) => ({
      id: g.id,
      concepto: g.concepto,
      importe: dec(g.importe),
      moneda: g.moneda,
      tipoCambio: dec(g.tipoCambio),
      base: g.baseProrrateo as dominio.BaseProrrateo,
      afectaCosto: g.afectaCosto,
      ...(g.itemId ? { itemId: g.itemId } : {}),
    })),
    { tipoCambioFob: dec(cabecera.tipoCambio) },
  );

  // El prorrateo debe cuadrar al céntimo con cada gasto. Si no, el asiento no
  // cerraría, y es mejor enterarse aquí que después de contabilizar.
  const verificacion = dominio.verificarProrrateo(
    gastos.map((g) => ({
      id: g.id,
      concepto: g.concepto,
      importe: dec(g.importe),
      moneda: g.moneda,
      tipoCambio: dec(g.tipoCambio),
      base: g.baseProrrateo as dominio.BaseProrrateo,
      afectaCosto: g.afectaCosto,
    })),
    liquidacion,
  );

  return {
    liquidacion,
    cuadra: verificacion.ok,
    diferencias: verificacion.diferencias.map((d) => ({
      concepto: d.concepto,
      esperado: txt2(d.esperado),
      repartido: txt2(d.repartido),
    })),
  };
}

export type ResultadoConfirmacion = {
  liquidacionId: string;
  asientoId: string;
  movimientos: string[];
  costoTotal: string;
};

/**
 * Confirma la liquidación: congela el cálculo, ingresa la mercadería al almacén
 * con su costo real y genera el asiento contable.
 *
 * Se guarda el resultado del cálculo y no sólo sus insumos. Si mañana se
 * corrige un gasto, la liquidación que ya movió inventario y contabilidad tiene
 * que seguir explicando esos números; recalcularla al consultarla daría una
 * cifra distinta a la que está asentada.
 */
export async function confirmarLiquidacion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  importacionId: string,
  datos: { numero: string; fecha: string; periodo: string },
): Promise<ResultadoConfirmacion> {
  const { cabecera } = await cargar(db, importacionId);
  if (cabecera.estado === "liquidada") {
    throw new ImportacionInvalida("esta importación ya fue liquidada");
  }
  if (cabecera.estado === "anulada") {
    throw new ImportacionInvalida("no se liquida una importación anulada");
  }
  if (!cabecera.almacenId) {
    throw new ImportacionInvalida("hay que indicar el almacén de ingreso antes de liquidar");
  }

  const vista = await previsualizarLiquidacion(db, importacionId);
  if (!vista.cuadra) {
    const detalle = vista.diferencias
      .map((d) => `${d.concepto}: se esperaba ${d.esperado} y se repartió ${d.repartido}`)
      .join("; ");
    throw new ImportacionInvalida(`el prorrateo no cuadra (${detalle})`);
  }

  const { liquidacion } = vista;

  const [cab] = await db
    .insert(liquidaciones)
    .values({
      empresaId,
      importacionId,
      numero: datos.numero,
      fecha: datos.fecha,
      fobTotal: txt(liquidacion.fobTotal),
      gastosCostoTotal: txt(liquidacion.gastosCostoTotal),
      gastosNoCostoTotal: txt(liquidacion.gastosNoCostoTotal),
      costoTotal: txt(liquidacion.costoTotal),
      noCosto: liquidacion.noCosto.map((n) => ({ concepto: n.concepto, importe: txt2(n.importe) })),
      estado: "confirmada",
      creadoPor: usuarioId,
    })
    .returning({ id: liquidaciones.id });
  const liquidacionId = cab!.id;

  const movimientos: string[] = [];

  for (const item of liquidacion.items) {
    await db.insert(liquidacionItems).values({
      empresaId,
      liquidacionId,
      importacionItemId: item.item.id,
      productoId: item.item.productoId,
      cantidad: txt(item.item.cantidad),
      fob: txt(item.fob),
      totalGastosCosto: txt(item.totalGastosCosto),
      totalGastosNoCosto: txt(item.totalGastosNoCosto),
      costoTotal: txt(item.costoTotal),
      costoUnitario: txt(item.costoUnitario),
      detalleGastos: item.gastos.map((g) => ({ concepto: g.concepto, importe: txt2(g.importe) })),
    });

    const mov = await registrarMovimiento(db, empresaId, {
      almacenId: cabecera.almacenId,
      productoId: item.item.productoId,
      fecha: datos.fecha,
      sentido: "ingreso",
      tipoOperacion: kardex.TIPO_OPERACION.COMPRA,
      cantidad: item.item.cantidad,
      costoUnitario: item.costoUnitario,
      // El costo total es el dato exacto; el unitario es el derivado. Pasarlo
      // evita que el kardex y la cuenta 20 se separen unos céntimos por
      // liquidación, deriva que en un año de embarques ya no es despreciable.
      importeTotal: item.costoTotal,
      origenModulo: "importaciones",
      origenId: liquidacionId,
    });
    movimientos.push(mov.id);
  }

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo: datos.periodo,
    fecha: datos.fecha,
    subdiario: "08",
    glosa: `Liquidación de importación ${cabecera.numero}`,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "importaciones",
    origenId: liquidacionId,
    lineas: lineasDelAsiento(liquidacion, cabecera.proveedorId),
  });

  await db
    .update(liquidaciones)
    .set({ asientoId })
    .where(eq(liquidaciones.id, liquidacionId));
  await db
    .update(tImportaciones)
    .set({ estado: "liquidada" })
    .where(eq(tImportaciones.id, importacionId));

  return { liquidacionId, asientoId, movimientos, costoTotal: txt2(liquidacion.costoTotal) };
}

/**
 * Asiento de la liquidación.
 *
 * Carga la mercadería a la 20 por su costo real, el IGV y la percepción a sus
 * cuentas de crédito fiscal, y abona todo contra la cuenta por pagar. Que el
 * IGV vaya a la 40111 y no a la 20 es la diferencia entre un inventario
 * correcto y uno inflado en un 18 %.
 */
function lineasDelAsiento(
  liquidacion: dominio.Liquidacion,
  proveedorId: string,
): LineaAsientoEntrada[] {
  const lineas: LineaAsientoEntrada[] = [
    {
      cuenta: "20111",
      glosa: "Mercadería importada al costo",
      debe: txt2(liquidacion.costoTotal),
    },
  ];

  for (const n of liquidacion.noCosto) {
    lineas.push({
      cuenta: cuentaNoCosto(n.concepto),
      glosa: n.concepto,
      debe: txt2(n.importe),
    });
  }

  const totalDebe = liquidacion.noCosto.reduce<Dec>(
    (acc, n) => money.add(acc, n.importe),
    liquidacion.costoTotal,
  );

  lineas.push({
    cuenta: "4212",
    glosa: "Proveedores del exterior y gastos de importación",
    haber: txt2(totalDebe),
    anexoId: proveedorId,
  });

  return lineas;
}

/** Cuenta de destino de los conceptos que no son costo. */
function cuentaNoCosto(concepto: string): string {
  const c = concepto.toLowerCase();
  if (c.includes("percepción") || c.includes("percepcion")) return "40113";
  // IGV, IPM y cualquier otro tributo recuperable comparten la cuenta propia.
  return "40111";
}

// ─── Consultas ────────────────────────────────────────────────────────────

export async function listar(db: Db, filtro?: { estado?: string }) {
  const cond = filtro?.estado ? eq(tImportaciones.estado, filtro.estado) : undefined;
  return db
    .select({
      id: tImportaciones.id,
      numero: tImportaciones.numero,
      proveedor: terceros.razonSocial,
      moneda: tImportaciones.moneda,
      tipoCambio: tImportaciones.tipoCambio,
      estado: tImportaciones.estado,
      fechaOrden: tImportaciones.fechaOrden,
      fechaLlegada: tImportaciones.fechaLlegada,
      duaNumero: tImportaciones.duaNumero,
      almacen: almacenes.nombre,
    })
    .from(tImportaciones)
    .innerJoin(terceros, eq(terceros.id, tImportaciones.proveedorId))
    .leftJoin(almacenes, eq(almacenes.id, tImportaciones.almacenId))
    .where(cond)
    .orderBy(sql`${tImportaciones.fechaOrden} DESC`);
}

export async function cargar(db: Db, importacionId: string) {
  const [cabecera] = await db
    .select()
    .from(tImportaciones)
    .where(eq(tImportaciones.id, importacionId))
    .limit(1);
  // RLS ya filtró por empresa: si no aparece, o no existe o es de otra empresa,
  // y desde aquí las dos cosas son indistinguibles a propósito.
  if (!cabecera) throw new ImportacionInvalida("la importación no existe");

  const items = await db
    .select({
      id: importacionItems.id,
      linea: importacionItems.linea,
      productoId: importacionItems.productoId,
      codigo: productos.codigo,
      descripcion: importacionItems.descripcion,
      cantidad: importacionItems.cantidad,
      fobUnitario: importacionItems.fobUnitario,
      peso: importacionItems.peso,
      volumen: importacionItems.volumen,
      partidaArancelaria: importacionItems.partidaArancelaria,
    })
    .from(importacionItems)
    .innerJoin(productos, eq(productos.id, importacionItems.productoId))
    .where(eq(importacionItems.importacionId, importacionId))
    .orderBy(asc(importacionItems.linea));

  const gastos = await db
    .select()
    .from(importacionGastos)
    .where(eq(importacionGastos.importacionId, importacionId))
    .orderBy(asc(importacionGastos.creadoEn));

  return { cabecera, items, gastos };
}

export async function cambiarEstado(
  db: Db,
  importacionId: string,
  nuevo: EstadoImportacion,
  extra?: { duaNumero?: string; duaFecha?: string; fechaLlegada?: string; fechaEmbarque?: string },
): Promise<void> {
  const [fila] = await db
    .select({ estado: tImportaciones.estado })
    .from(tImportaciones)
    .where(eq(tImportaciones.id, importacionId))
    .limit(1);
  if (!fila) throw new ImportacionInvalida("la importación no existe");
  if (!puedeAvanzar(fila.estado, nuevo)) {
    throw new ImportacionInvalida(`no se puede pasar de «${fila.estado}» a «${nuevo}»`);
  }

  await db
    .update(tImportaciones)
    .set({
      estado: nuevo,
      ...(extra?.duaNumero ? { duaNumero: extra.duaNumero } : {}),
      ...(extra?.duaFecha ? { duaFecha: extra.duaFecha } : {}),
      ...(extra?.fechaLlegada ? { fechaLlegada: extra.fechaLlegada } : {}),
      ...(extra?.fechaEmbarque ? { fechaEmbarque: extra.fechaEmbarque } : {}),
    })
    .where(eq(tImportaciones.id, importacionId));
}

async function exigirEditable(db: Db, importacionId: string): Promise<void> {
  const [fila] = await db
    .select({ estado: tImportaciones.estado })
    .from(tImportaciones)
    .where(eq(tImportaciones.id, importacionId))
    .limit(1);
  if (!fila) throw new ImportacionInvalida("la importación no existe");
  if (fila.estado === "liquidada" || fila.estado === "anulada") {
    throw new ImportacionInvalida(
      `la importación está ${fila.estado} y ya no admite cambios`,
    );
  }
}

export { dominio as liquidacionDominio };
