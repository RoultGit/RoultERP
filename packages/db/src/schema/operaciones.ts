/**
 * Módulos de la Fase 1: compras, importaciones, inventario y cuentas por pagar.
 *
 * El hilo que los une es el costo. Una orden de compra al exterior se convierte
 * en un embarque, el embarque en una liquidación, la liquidación en el costo
 * unitario con el que la mercadería entra al kardex, y ese costo es el que
 * termina en la cuenta 20 del balance. Cada eslabón guarda de dónde viene, para
 * que el contador pueda recorrer el camino al revés cuando algo no cuadra.
 */
import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { auditoria, empresaId, fecha, id, importe, importeCero } from "./comun.ts";
import { empresas } from "./identidad.ts";
import { almacenes, centrosCosto, planCuentas, productos, sucursales, terceros } from "./maestros.ts";

// ─── Compras ──────────────────────────────────────────────────────────────

export const ordenesCompra = pgTable(
  "ordenes_compra",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    sucursalId: uuid("sucursal_id").references(() => sucursales.id),
    almacenId: uuid("almacen_id").references(() => almacenes.id),
    fecha: fecha("fecha").notNull(),
    fechaEntrega: fecha("fecha_entrega"),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** borrador, aprobada, parcial, recibida, anulada */
    estado: text("estado").notNull().default("borrador"),
    condicionPago: text("condicion_pago"),
    observaciones: text("observaciones"),
    subtotal: importeCero("subtotal"),
    igv: importeCero("igv"),
    total: importeCero("total"),
    aprobadaPor: uuid("aprobada_por"),
    aprobadaEn: timestamp("aprobada_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("ordenes_compra_uk").on(t.empresaId, t.numero),
    index("ordenes_compra_proveedor_ix").on(t.empresaId, t.proveedorId),
  ],
);

export const ordenCompraItems = pgTable(
  "orden_compra_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    ordenId: uuid("orden_id").notNull().references(() => ordenesCompra.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    cantidad: importe("cantidad").notNull(),
    /** Cantidad ya recibida. La orden se cierra cuando iguala a `cantidad`. */
    cantidadRecibida: importeCero("cantidad_recibida"),
    valorUnitario: importe("valor_unitario").notNull(),
    descuento: importeCero("descuento"),
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("orden_compra_items_uk").on(t.ordenId, t.linea)],
);

/**
 * Registro de compras: el documento que emite el proveedor.
 *
 * Es a la vez el sustento del crédito fiscal (formato 8.1 del PLE) y el origen
 * de la cuenta por pagar. Por eso guarda el detalle tributario completo aunque
 * el usuario sólo quiera ver el total.
 */
export const compras = pgTable(
  "compras",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    /** Catálogo 01 de SUNAT. */
    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    fechaVencimiento: fecha("fecha_vencimiento"),
    /** Periodo en que se toma el crédito fiscal; puede diferir de la emisión. */
    periodo: text("periodo").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    gravadas: importeCero("gravadas"),
    exoneradas: importeCero("exoneradas"),
    inafectas: importeCero("inafectas"),
    isc: importeCero("isc"),
    igv: importeCero("igv"),
    otrosCargos: importeCero("otros_cargos"),
    total: importeCero("total"),
    /** Régimen aplicable: detraccion, retencion, percepcion o ninguno. */
    regimen: text("regimen").notNull().default("ninguno"),
    detraccionCodigo: text("detraccion_codigo"),
    detraccionTasa: importe("detraccion_tasa"),
    detraccionMonto: importeCero("detraccion_monto"),
    detraccionConstancia: text("detraccion_constancia"),
    detraccionFecha: fecha("detraccion_fecha"),
    percepcionMonto: importeCero("percepcion_monto"),
    ordenCompraId: uuid("orden_compra_id").references(() => ordenesCompra.id),
    /** Si nace de una importación, el embarque que la originó. */
    importacionId: uuid("importacion_id"),
    asientoId: uuid("asiento_id"),
    /** registrada, anulada */
    estado: text("estado").notNull().default("registrada"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("compras_uk").on(t.empresaId, t.proveedorId, t.tipoDocumento, t.serie, t.numero),
    index("compras_periodo_ix").on(t.empresaId, t.periodo),
  ],
);

export const compraItems = pgTable(
  "compra_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    compraId: uuid("compra_id").notNull().references(() => compras.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    cantidad: importe("cantidad").notNull(),
    valorUnitario: importe("valor_unitario").notNull(),
    descuento: importeCero("descuento"),
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    valorVenta: importeCero("valor_venta"),
    igv: importeCero("igv"),
    importe: importeCero("importe"),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    cuentaId: uuid("cuenta_id").references(() => planCuentas.id),
    ...auditoria(),
  },
  (t) => [uniqueIndex("compra_items_uk").on(t.compraId, t.linea)],
);

// ─── Importaciones ────────────────────────────────────────────────────────

export const importaciones = pgTable(
  "importaciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    almacenId: uuid("almacen_id").references(() => almacenes.id),
    /** Moneda de la factura del exterior; casi siempre USD. */
    moneda: text("moneda").notNull().default("USD"),
    /** Tipo de cambio con el que se valoriza el FOB. */
    tipoCambio: importe("tipo_cambio").notNull(),
    incoterm: text("incoterm"),
    /** borrador, aprobada, en_transito, en_aduana, nacionalizada, liquidada, anulada */
    estado: text("estado").notNull().default("borrador"),
    fechaOrden: fecha("fecha_orden").notNull(),
    fechaEmbarque: fecha("fecha_embarque"),
    fechaLlegada: fecha("fecha_llegada"),
    fechaNacionalizacion: fecha("fecha_nacionalizacion"),
    /** Declaración aduanera de mercancías. */
    duaNumero: text("dua_numero"),
    duaFecha: fecha("dua_fecha"),
    facturaExterior: text("factura_exterior"),
    conocimientoEmbarque: text("conocimiento_embarque"),
    puertoOrigen: text("puerto_origen"),
    puertoDestino: text("puerto_destino"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("importaciones_uk").on(t.empresaId, t.numero),
    index("importaciones_estado_ix").on(t.empresaId, t.estado),
  ],
);

export const importacionItems = pgTable(
  "importacion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    importacionId: uuid("importacion_id")
      .notNull()
      .references(() => importaciones.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    cantidad: importe("cantidad").notNull(),
    /** FOB unitario en la moneda de la factura del exterior. */
    fobUnitario: importe("fob_unitario").notNull(),
    /** Peso y volumen totales de la línea: base del prorrateo. */
    peso: importe("peso"),
    volumen: importe("volumen"),
    partidaArancelaria: text("partida_arancelaria"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("importacion_items_uk").on(t.importacionId, t.linea)],
);

export const importacionGastos = pgTable(
  "importacion_gastos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    importacionId: uuid("importacion_id")
      .notNull()
      .references(() => importaciones.id, { onDelete: "cascade" }),
    concepto: text("concepto").notNull(),
    importe: importe("importe").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** fob, peso, volumen, cantidad o directo. */
    baseProrrateo: text("base_prorrateo").notNull().default("fob"),
    /**
     * false para el IGV, el IPM y la percepción. Es la bandera que decide si el
     * gasto engorda el inventario o va al crédito fiscal, y equivocarla infla
     * el costo de la mercadería en un 18 %.
     */
    afectaCosto: boolean("afecta_costo").notNull().default(true),
    /** Sólo con base "directo": el ítem al que se carga íntegro. */
    itemId: uuid("item_id").references(() => importacionItems.id),
    proveedorId: uuid("proveedor_id").references(() => terceros.id),
    documento: text("documento"),
    fecha: fecha("fecha"),
    ...auditoria(),
  },
  (t) => [index("importacion_gastos_ix").on(t.importacionId)],
);

/**
 * Resultado congelado de la liquidación.
 *
 * Se guarda el cálculo, no sólo sus insumos: si mañana cambia una tasa o se
 * corrige un gasto, la liquidación que ya generó el asiento y el ingreso al
 * almacén tiene que seguir explicando esos números. Recalcular en el momento de
 * consultarla daría un resultado distinto al que está contabilizado.
 */
export const liquidaciones = pgTable(
  "liquidaciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    importacionId: uuid("importacion_id")
      .notNull()
      .references(() => importaciones.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    fobTotal: importeCero("fob_total"),
    gastosCostoTotal: importeCero("gastos_costo_total"),
    gastosNoCostoTotal: importeCero("gastos_no_costo_total"),
    costoTotal: importeCero("costo_total"),
    /** Conceptos que no son costo, agrupados: IGV, IPM, percepción. */
    noCosto: jsonb("no_costo"),
    /** borrador, confirmada, anulada. Confirmada genera kardex y asiento. */
    estado: text("estado").notNull().default("borrador"),
    asientoId: uuid("asiento_id"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("liquidaciones_uk").on(t.empresaId, t.numero)],
);

export const liquidacionItems = pgTable(
  "liquidacion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    liquidacionId: uuid("liquidacion_id")
      .notNull()
      .references(() => liquidaciones.id, { onDelete: "cascade" }),
    importacionItemId: uuid("importacion_item_id")
      .notNull()
      .references(() => importacionItems.id),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    cantidad: importe("cantidad").notNull(),
    fob: importe("fob").notNull(),
    totalGastosCosto: importeCero("total_gastos_costo"),
    totalGastosNoCosto: importeCero("total_gastos_no_costo"),
    costoTotal: importe("costo_total").notNull(),
    costoUnitario: importe("costo_unitario").notNull(),
    /** Desglose por gasto, para poder auditar el prorrateo línea a línea. */
    detalleGastos: jsonb("detalle_gastos"),
    ...auditoria(),
  },
  (t) => [index("liquidacion_items_ix").on(t.liquidacionId)],
);

// ─── Inventario ───────────────────────────────────────────────────────────

/**
 * Movimientos de inventario. Es el libro del almacén: append-only, igual que el
 * contable. Un movimiento equivocado se corrige con otro en sentido contrario,
 * nunca borrándolo, porque el kardex se reconstruye reproduciendo la secuencia.
 */
export const movimientosInventario = pgTable(
  "movimientos_inventario",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    almacenId: uuid("almacen_id").notNull().references(() => almacenes.id),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    fecha: fecha("fecha").notNull(),
    /** Desempata movimientos de la misma fecha. Lo asigna una secuencia. */
    orden: integer("orden").notNull(),
    /** "ingreso" o "salida". */
    sentido: text("sentido").notNull(),
    /** Catálogo 12 de SUNAT. */
    tipoOperacion: text("tipo_operacion").notNull(),
    cantidad: importe("cantidad").notNull(),
    /** Costo unitario: dado en el ingreso, calculado por el método en la salida. */
    costoUnitario: importe("costo_unitario").notNull(),
    importeTotal: importe("importe_total").notNull(),
    /** Desglose por capa PEPS. Vacío en promedio. */
    consumos: jsonb("consumos"),
    lote: text("lote"),
    serie: text("serie"),
    /** De dónde vino: "compras", "importaciones", "ventas", "ajustes"… */
    origenModulo: text("origen_modulo"),
    origenId: uuid("origen_id"),
    anuladoPor: uuid("anulado_por"),
    ...auditoria(),
  },
  (t) => [
    index("movimientos_kardex_ix").on(t.empresaId, t.productoId, t.almacenId, t.fecha, t.orden),
    index("movimientos_origen_ix").on(t.empresaId, t.origenModulo, t.origenId),
  ],
);

/**
 * Saldo actual por producto y almacén.
 *
 * Es una proyección de `movimientos_inventario`, mantenida en la misma
 * transacción que los genera. Existe para no sumar el histórico completo cada
 * vez que alguien abre una pantalla; la verdad sigue siendo el movimiento, y
 * hay un trabajo que recalcula y compara.
 */
export const saldosInventario = pgTable(
  "saldos_inventario",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    almacenId: uuid("almacen_id").notNull().references(() => almacenes.id),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    cantidad: importeCero("cantidad"),
    valor: importeCero("valor"),
    /** Capas PEPS pendientes, en orden de antigüedad. Vacío en promedio. */
    capas: jsonb("capas"),
    actualizadoEnMovimiento: uuid("actualizado_en_movimiento"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("saldos_inventario_uk").on(t.empresaId, t.almacenId, t.productoId)],
);

// ─── Cuentas por pagar ────────────────────────────────────────────────────

/**
 * Documentos por pagar. Nacen de una compra o de un gasto de importación y
 * viven hasta que su saldo llega a cero.
 */
export const documentosCxp = pgTable(
  "documentos_cxp",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    compraId: uuid("compra_id").references(() => compras.id),
    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    fechaVencimiento: fecha("fecha_vencimiento").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    total: importe("total").notNull(),
    /** Saldo pendiente en la moneda del documento. Cero cierra el documento. */
    saldo: importe("saldo").notNull(),
    /** pendiente, parcial, pagado, canjeado, anulado */
    estado: text("estado").notNull().default("pendiente"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("documentos_cxp_uk").on(t.empresaId, t.proveedorId, t.tipoDocumento, t.serie, t.numero),
    index("documentos_cxp_vencimiento_ix").on(t.empresaId, t.estado, t.fechaVencimiento),
  ],
);

export const pagos = pgTable(
  "pagos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    fecha: fecha("fecha").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** efectivo, transferencia, cheque, letra */
    medioPago: text("medio_pago").notNull(),
    cuentaId: uuid("cuenta_id").references(() => planCuentas.id),
    importeBruto: importe("importe_bruto").notNull(),
    retencionMonto: importeCero("retencion_monto"),
    importeNeto: importe("importe_neto").notNull(),
    referencia: text("referencia"),
    asientoId: uuid("asiento_id"),
    /** registrado, anulado */
    estado: text("estado").notNull().default("registrado"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("pagos_uk").on(t.empresaId, t.numero)],
);

/**
 * Qué documento cancela cada pago y por cuánto.
 *
 * Un pago puede cubrir varias facturas y una factura puede recibir varios
 * pagos, así que la relación es su propia tabla. La suma de aplicaciones de un
 * documento nunca puede exceder su total; lo garantiza una restricción y lo
 * verifica una prueba.
 */
export const pagoAplicaciones = pgTable(
  "pago_aplicaciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    pagoId: uuid("pago_id").notNull().references(() => pagos.id, { onDelete: "cascade" }),
    documentoId: uuid("documento_id").notNull().references(() => documentosCxp.id),
    importeAplicado: importe("importe_aplicado").notNull(),
    /** Diferencia de cambio generada al cancelar en otra moneda. */
    diferenciaCambio: importeCero("diferencia_cambio"),
    ...auditoria(),
  },
  (t) => [
    index("pago_aplicaciones_pago_ix").on(t.pagoId),
    index("pago_aplicaciones_doc_ix").on(t.documentoId),
  ],
);

/** Letras por pagar: canje, renovación y protesto. */
export const letras = pgTable(
  "letras",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    /** "cobrar" o "pagar". La misma tabla sirve a CxC y a CxP. */
    cartera: text("cartera").notNull(),
    terceroId: uuid("tercero_id").notNull().references(() => terceros.id),
    fechaGiro: fecha("fecha_giro").notNull(),
    fechaVencimiento: fecha("fecha_vencimiento").notNull(),
    moneda: text("moneda").notNull(),
    importe: importe("importe").notNull(),
    saldo: importe("saldo").notNull(),
    /** girada, aceptada, en_cartera, descontada, cobrada, protestada, renovada */
    estado: text("estado").notNull().default("girada"),
    /** Si renueva a otra letra, cuál. */
    renuevaA: uuid("renueva_a"),
    bancoCuentaId: uuid("banco_cuenta_id"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("letras_uk").on(t.empresaId, t.cartera, t.numero),
    index("letras_vencimiento_ix").on(t.empresaId, t.estado, t.fechaVencimiento),
  ],
);

/** Documentos que se canjearon por una letra. */
export const letraDocumentos = pgTable(
  "letra_documentos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    letraId: uuid("letra_id").notNull().references(() => letras.id, { onDelete: "cascade" }),
    documentoId: uuid("documento_id").notNull(),
    importe: importe("importe").notNull(),
    ...auditoria(),
  },
  (t) => [index("letra_documentos_ix").on(t.letraId)],
);

// ─── Contabilidad ─────────────────────────────────────────────────────────

export const asientos = pgTable(
  "asientos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    periodo: text("periodo").notNull(),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    /** Catálogo 8 de SUNAT: 01 caja, 08 compras, 14 ventas… */
    subdiario: text("subdiario").notNull(),
    glosa: text("glosa").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** borrador, contabilizado, extornado, anulado */
    estado: text("estado").notNull().default("borrador"),
    extornaA: uuid("extorna_a"),
    origenModulo: text("origen_modulo"),
    origenId: uuid("origen_id"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("asientos_uk").on(t.empresaId, t.periodo, t.numero),
    index("asientos_origen_ix").on(t.empresaId, t.origenModulo, t.origenId),
  ],
);

export const asientoLineas = pgTable(
  "asiento_lineas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    asientoId: uuid("asiento_id").notNull().references(() => asientos.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    cuenta: text("cuenta").notNull(),
    glosa: text("glosa"),
    debe: importeCero("debe"),
    haber: importeCero("haber"),
    debeFuncional: importeCero("debe_funcional"),
    haberFuncional: importeCero("haber_funcional"),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    anexoId: uuid("anexo_id").references(() => terceros.id),
    documentoTipo: text("documento_tipo"),
    documentoSerie: text("documento_serie"),
    documentoNumero: text("documento_numero"),
    documentoFecha: fecha("documento_fecha"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("asiento_lineas_uk").on(t.asientoId, t.linea),
    index("asiento_lineas_cuenta_ix").on(t.empresaId, t.cuenta),
    index("asiento_lineas_anexo_ix").on(t.empresaId, t.anexoId),
  ],
);
