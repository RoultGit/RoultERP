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

/**
 * Requisición: lo que un área pide antes de que compras salga a comprar.
 *
 * Es el primer eslabón del flujo de Starsoft, y el que da trazabilidad: sin
 * requisición no se sabe quién pidió qué ni con qué autorización, y la orden de
 * compra aparece sin padre. Puede ser de bienes o de servicios.
 */
export const requisiciones = pgTable(
  "requisiciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    /** compra (bienes) o servicio. */
    tipo: text("tipo").notNull().default("compra"),
    fecha: fecha("fecha").notNull(),
    /** Para cuándo lo necesita el área. */
    fechaRequerida: fecha("fecha_requerida"),
    /** Área solicitante, en texto: no vale la pena un maestro para esto. */
    area: text("area"),
    solicitanteId: uuid("solicitante_id"),
    almacenId: uuid("almacen_id").references(() => almacenes.id),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    /** pendiente, aprobada, rechazada, atendida, anulada */
    estado: text("estado").notNull().default("pendiente"),
    observaciones: text("observaciones"),
    aprobadaPor: uuid("aprobada_por"),
    aprobadaEn: timestamp("aprobada_en", { withTimezone: true }),
    motivoRechazo: text("motivo_rechazo"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("requisiciones_uk").on(t.empresaId, t.numero),
    index("requisiciones_estado_ix").on(t.empresaId, t.estado),
  ],
);

export const requisicionItems = pgTable(
  "requisicion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    requisicionId: uuid("requisicion_id")
      .notNull()
      .references(() => requisiciones.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull().default("ZZ"),
    cantidad: importe("cantidad").notNull(),
    /** Lo ya cubierto por una orden de compra. */
    cantidadAtendida: importeCero("cantidad_atendida"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("requisicion_items_uk").on(t.requisicionId, t.linea)],
);

/**
 * Solicitud de cotización: lo mismo que la requisición, pero dirigido afuera.
 *
 * Se manda a varios proveedores y cada uno responde con su propia cotización.
 * Existe como documento propio —y no como una lista suelta de cotizaciones—
 * porque el cuadro comparativo compara respuestas contra lo que se preguntó.
 */
export const solicitudesCotizacion = pgTable(
  "solicitudes_cotizacion",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    requisicionId: uuid("requisicion_id").references(() => requisiciones.id),
    fecha: fecha("fecha").notNull(),
    /** Hasta cuándo se reciben respuestas. */
    fechaLimite: fecha("fecha_limite"),
    /** abierta, cerrada, desierta */
    estado: text("estado").notNull().default("abierta"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("solicitudes_cotizacion_uk").on(t.empresaId, t.numero)],
);

export const solicitudCotizacionItems = pgTable(
  "solicitud_cotizacion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    solicitudId: uuid("solicitud_id")
      .notNull()
      .references(() => solicitudesCotizacion.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull().default("ZZ"),
    cantidad: importe("cantidad").notNull(),
    ...auditoria(),
  },
  (t) => [uniqueIndex("solicitud_cotizacion_items_uk").on(t.solicitudId, t.linea)],
);

/** La respuesta de un proveedor a una solicitud. */
export const cotizacionesProveedor = pgTable(
  "cotizaciones_proveedor",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    solicitudId: uuid("solicitud_id")
      .notNull()
      .references(() => solicitudesCotizacion.id, { onDelete: "cascade" }),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    /** El número que el proveedor le puso a su propia cotización. */
    referenciaProveedor: text("referencia_proveedor"),
    fecha: fecha("fecha").notNull(),
    validaHasta: fecha("valida_hasta"),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    condicionPago: text("condicion_pago"),
    /** Días de entrega ofrecidos: pesa tanto como el precio. */
    plazoEntregaDias: integer("plazo_entrega_dias"),
    /** registrada, elegida, descartada */
    estado: text("estado").notNull().default("registrada"),
    observaciones: text("observaciones"),
    subtotal: importeCero("subtotal"),
    igv: importeCero("igv"),
    total: importeCero("total"),
    /** La orden de compra que salió de esta cotización, si se eligió. */
    ordenCompraId: uuid("orden_compra_id"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("cotizaciones_proveedor_uk").on(t.empresaId, t.numero),
    index("cotizaciones_proveedor_solicitud_ix").on(t.empresaId, t.solicitudId),
  ],
);

export const cotizacionProveedorItems = pgTable(
  "cotizacion_proveedor_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cotizacionId: uuid("cotizacion_id")
      .notNull()
      .references(() => cotizacionesProveedor.id, { onDelete: "cascade" }),
    /** La línea de la solicitud que responde. Es lo que permite comparar. */
    solicitudItemId: uuid("solicitud_item_id").references(() => solicitudCotizacionItems.id),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull().default("ZZ"),
    cantidad: importe("cantidad").notNull(),
    valorUnitario: importe("valor_unitario").notNull(),
    descuento: importeCero("descuento"),
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    importeLinea: importeCero("importe_linea"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("cotizacion_proveedor_items_uk").on(t.cotizacionId, t.linea)],
);

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
    /** De dónde vino, cuando vino de algún sitio. */
    requisicionId: uuid("requisicion_id"),
    cotizacionProveedorId: uuid("cotizacion_proveedor_id"),
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
    /**
     * Opcional, como en la factura de compra: se ordenan servicios —un
     * agenciamiento de aduana, un mantenimiento— tan a menudo como bienes, y
     * exigir un producto de catálogo obligaba a inventar uno.
     */
    productoId: uuid("producto_id").references(() => productos.id),
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

/**
 * Póliza: la DUA con la que se nacionaliza un despacho.
 *
 * Starsoft organiza los gastos y la liquidación **por póliza**, no por
 * embarque, y con razón: una sola DUA ampara varias órdenes de importación, y
 * los gastos que llegan —el agenciamiento, el almacenaje, el flete interno— son
 * de la póliza entera. Cargárselos a un embarque cualquiera es inventar el
 * costo de los otros.
 *
 * El tipo de cambio vive aquí porque lo fija la DUA: es el que SUNAT publica
 * para la fecha de numeración, y manda sobre toda la nacionalización.
 */
export const polizas = pgTable(
  "polizas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Número de la DUA: 235-2026-10-123456. */
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    /** Fecha de numeración: la que fija el tipo de cambio. */
    fechaNumeracion: fecha("fecha_numeracion"),
    /** Código de la intendencia de aduana. */
    aduana: text("aduana"),
    /** Régimen: importación definitiva, admisión temporal, etc. */
    regimen: text("regimen"),
    /** Agente de aduanas: a él se le debe el agenciamiento, no al exportador. */
    agenteId: uuid("agente_id").references(() => terceros.id),
    tipoCambio: importe("tipo_cambio").notNull(),
    /** abierta, liquidada, anulada */
    estado: text("estado").notNull().default("abierta"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("polizas_uk").on(t.empresaId, t.numero),
    index("polizas_estado_ix").on(t.empresaId, t.estado),
  ],
);

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
    /** La póliza que ampara este embarque, si ya se agrupó en una. */
    polizaId: uuid("poliza_id").references(() => polizas.id),
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

/**
 * Qué documentos de una importación ya llegaron.
 *
 * El catálogo de documentos exigibles vive en `core/importaciones`, no aquí: la
 * pantalla cruza esa lista con estas filas. Una fila sin `recibidoEn` es un
 * documento del que se tomó nota y sigue pendiente; lo normal es que la fila no
 * exista hasta que el documento llega.
 */
export const importacionDocumentos = pgTable(
  "importacion_documentos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    importacionId: uuid("importacion_id")
      .notNull()
      .references(() => importaciones.id, { onDelete: "cascade" }),
    /** Clave del catálogo de `core/importaciones`. */
    tipo: text("tipo").notNull(),
    recibidoEn: fecha("recibido_en"),
    /** Número del documento: el del B/L, el del certificado, el de la factura. */
    referencia: text("referencia"),
    /** Marcado como no exigible para este embarque concreto. */
    noAplica: boolean("no_aplica").notNull().default(false),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("importacion_documentos_uk").on(t.importacionId, t.tipo),
    index("importacion_documentos_ix").on(t.empresaId, t.importacionId),
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
    /**
     * El gasto pertenece a un embarque **o** a una póliza, nunca a los dos.
     *
     * Un gasto de póliza es el que ampara a todos sus embarques —el
     * agenciamiento, el almacenaje— y se reparte entre ellos antes de
     * prorratearse dentro de cada uno.
     */
    importacionId: uuid("importacion_id").references(() => importaciones.id, {
      onDelete: "cascade",
    }),
    polizaId: uuid("poliza_id").references(() => polizas.id, { onDelete: "cascade" }),
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
/**
 * Notas de almacén: los movimientos que no vienen de otro módulo.
 *
 * Un ingreso por donación, una salida por merma, una transferencia entre
 * almacenes o el ajuste de un inventario físico. Sin ellas el almacén sólo se
 * mueve cuando compra o vende, y una empresa con dos almacenes no puede pasar
 * mercadería de uno a otro ni dar de baja lo que se rompió.
 *
 * Llevan cabecera y número propios porque son un documento: el almacenero lo
 * imprime, lo firma y lo archiva.
 */
/**
 * Composición de un producto: de qué está hecho.
 *
 * La misma tabla sirve a los dos casos que Starsoft separa en el menú y que en
 * el fondo son el mismo problema —un artículo que se convierte en otros sin
 * comprar ni vender nada—:
 *
 * - **Kit**: un botiquín que se arma con gasas, alcohol y vendas, y que se
 *   desarma cuando conviene vender las piezas sueltas.
 * - **Conversión de unidades**: un saco de 50 kg que pasa a ser 50 bolsas de
 *   1 kg. Es un kit de un solo componente, y tratarlo como otra cosa sólo
 *   duplicaría el código.
 */
/**
 * Lote de un producto.
 *
 * Sólo guarda lo que no se deduce del kardex: cuándo se fabricó y cuándo vence.
 * El **saldo** de cada lote no vive aquí: se deriva de los movimientos, igual
 * que el saldo del almacén, porque un saldo almacenado en dos sitios acaba
 * siendo dos saldos distintos.
 *
 * La fecha de vencimiento es la razón de ser del control por lotes en un
 * importador de alimentos o medicinas: sin ella, la mercadería caduca en el
 * almacén y nadie se entera hasta que un cliente la devuelve.
 */
export const lotes = pgTable(
  "lotes",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    fechaFabricacion: fecha("fecha_fabricacion"),
    fechaVencimiento: fecha("fecha_vencimiento"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("lotes_uk").on(t.productoId, t.codigo),
    index("lotes_vencimiento_ix").on(t.empresaId, t.fechaVencimiento),
  ],
);

export const composiciones = pgTable(
  "composiciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** El producto que resulta: el kit, o la presentación de destino. */
    productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
    /** kit o conversion. Cambia el nombre en pantalla, no el cálculo. */
    tipo: text("tipo").notNull().default("kit"),
    componenteId: uuid("componente_id").notNull().references(() => productos.id),
    /** Cuántas unidades del componente lleva **una** unidad del producto. */
    cantidad: importe("cantidad").notNull(),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("composiciones_uk").on(t.productoId, t.componenteId),
    index("composiciones_producto_ix").on(t.empresaId, t.productoId),
  ],
);

export const notasAlmacen = pgTable(
  "notas_almacen",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** ingreso, salida, transferencia, ajuste */
    tipo: text("tipo").notNull(),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    /** Almacén afectado; el de origen en una transferencia. */
    almacenId: uuid("almacen_id").notNull().references(() => almacenes.id),
    /** Sólo en transferencias. */
    almacenDestinoId: uuid("almacen_destino_id").references(() => almacenes.id),
    /** Catálogo 12 de SUNAT: qué operación es, para el PLE 12.1 y 13.1. */
    tipoOperacion: text("tipo_operacion").notNull(),
    glosa: text("glosa").notNull(),
    /**
     * Contrapartida contable del movimiento. Una transferencia no la lleva:
     * la mercadería no cambia de cuenta, sólo de sitio.
     */
    cuentaContrapartida: text("cuenta_contrapartida"),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    terceroId: uuid("tercero_id").references(() => terceros.id),
    referencia: text("referencia"),
    asientoId: uuid("asiento_id"),
    /** Importe total del movimiento, en moneda funcional. */
    importe: importeCero("importe"),
    estado: text("estado").notNull().default("registrada"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("notas_almacen_uk").on(t.empresaId, t.tipo, t.numero),
    index("notas_almacen_fecha_ix").on(t.empresaId, t.fecha),
  ],
);

export const notaAlmacenItems = pgTable(
  "nota_almacen_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    notaId: uuid("nota_id")
      .notNull()
      .references(() => notasAlmacen.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").notNull().references(() => productos.id),
    cantidad: importe("cantidad").notNull(),
    /** Obligatorio al ingresar; al salir lo determina el kardex. */
    costoUnitario: importe("costo_unitario"),
    importeLinea: importeCero("importe_linea"),
    lote: text("lote"),
    serie: text("serie"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("nota_almacen_items_uk").on(t.notaId, t.linea)],
);

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

/**
 * Orden de pago: el documento con el que se autoriza un desembolso.
 *
 * En Starsoft nadie paga una factura sin una orden de pago aprobada. Es la
 * separación entre quien decide pagar y quien firma el cheque, y es lo que hace
 * auditable el egreso: sin ella la única huella de por qué salió el dinero es
 * que alguien lo sacó.
 *
 * La orden no mueve dinero ni contabilidad. Lo hace el pago, cuando se ejecuta.
 */
export const ordenesPago = pgTable(
  "ordenes_pago",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    /** Cuándo se propone pagarla. */
    fechaProgramada: fecha("fecha_programada"),
    proveedorId: uuid("proveedor_id").notNull().references(() => terceros.id),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    importe: importe("importe").notNull(),
    /** efectivo, transferencia, cheque */
    medioPago: text("medio_pago").notNull().default("transferencia"),
    cuentaEfectivoId: uuid("cuenta_efectivo_id").references(() => cuentasEfectivo.id),
    /** Retener el IGV al ejecutar, si la empresa es agente de retención. */
    retenerIgv: boolean("retener_igv").notNull().default(false),
    /** pendiente, autorizada, rechazada, pagada, anulada */
    estado: text("estado").notNull().default("pendiente"),
    observaciones: text("observaciones"),
    solicitadaPor: uuid("solicitada_por"),
    autorizadaPor: uuid("autorizada_por"),
    autorizadaEn: timestamp("autorizada_en", { withTimezone: true }),
    motivoRechazo: text("motivo_rechazo"),
    /** El pago que la ejecutó. */
    pagoId: uuid("pago_id"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("ordenes_pago_uk").on(t.empresaId, t.numero),
    index("ordenes_pago_estado_ix").on(t.empresaId, t.estado),
  ],
);

/** Qué documentos cubre la orden y por cuánto cada uno. */
export const ordenPagoDocumentos = pgTable(
  "orden_pago_documentos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    ordenId: uuid("orden_id").notNull().references(() => ordenesPago.id, { onDelete: "cascade" }),
    documentoId: uuid("documento_id").notNull().references(() => documentosCxp.id),
    importe: importe("importe").notNull(),
    ...auditoria(),
  },
  (t) => [uniqueIndex("orden_pago_documentos_uk").on(t.ordenId, t.documentoId)],
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

/**
 * Cuentas de integración: qué cuenta usa cada operación automática.
 *
 * Guarda **sólo lo que la empresa cambió**. Lo que no está aquí usa el valor de
 * partida del catálogo del programa, de modo que una empresa creada hace un año
 * y una creada hoy se comportan igual sin sembrar nada.
 */
export const parametrosContables = pgTable(
  "parametros_contables",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Clave del catálogo: ventas_mercaderia, clientes, igv_ventas… */
    clave: text("clave").notNull(),
    cuenta: text("cuenta").notNull(),
    ...auditoria(),
  },
  (t) => [uniqueIndex("parametros_contables_uk").on(t.empresaId, t.clave)],
);

/**
 * Planilla de cobranza: la hoja de ruta del cobrador.
 *
 * Reúne los documentos que alguien sale a cobrar —o que se entregan al banco—,
 * se imprime, se firma al entregarla y se liquida al volver. No mueve dinero ni
 * contabilidad: eso lo sigue haciendo la cobranza. Lo que aporta es saber quién
 * tiene qué.
 */
export const planillasCobranza = pgTable(
  "planillas_cobranza",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    /** cobrador o banco. */
    tipo: text("tipo").notNull().default("cobrador"),
    /** A quién se le entrega: el nombre del cobrador o el del banco. */
    responsable: text("responsable").notNull(),
    moneda: text("moneda").notNull(),
    importe: importe("importe").notNull(),
    /** abierta, cerrada, anulada. */
    estado: text("estado").notNull().default("abierta"),
    observaciones: text("observaciones"),
    entregadaPor: uuid("entregada_por"),
    cerradaPor: uuid("cerrada_por"),
    cerradaEn: timestamp("cerrada_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("planillas_cobranza_uk").on(t.empresaId, t.numero),
    index("planillas_cobranza_estado_ix").on(t.empresaId, t.estado),
  ],
);

/** Un renglón de la planilla: una factura o una letra, nunca las dos. */
export const planillaCobranzaDocumentos = pgTable(
  "planilla_cobranza_documentos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    planillaId: uuid("planilla_id")
      .notNull()
      .references(() => planillasCobranza.id, { onDelete: "cascade" }),
    comprobanteId: uuid("comprobante_id").references(() => comprobantes.id),
    letraId: uuid("letra_id").references(() => letras.id),
    importe: importe("importe").notNull(),
    ...auditoria(),
  },
  (t) => [index("planilla_documentos_ix").on(t.planillaId)],
);

/**
 * Pagos de una letra, uno por cada vez que se amortiza.
 *
 * Sin esta fila el pago de una letra sólo dejaba su asiento: no había dónde
 * anotar con qué cuenta se pagó, cuánto se retuvo ni a qué movimiento de banco
 * corresponde, y no se podía emitir el comprobante de retención.
 */
export const letraPagos = pgTable(
  "letra_pagos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    letraId: uuid("letra_id").notNull().references(() => letras.id, { onDelete: "cascade" }),
    fecha: fecha("fecha").notNull(),
    /** Lo que se amortiza de la letra, antes de la retención. */
    importe: importe("importe").notNull(),
    retencionMonto: importeCero("retencion_monto"),
    /** Lo que sale del banco: el importe menos la retención. */
    importeNeto: importe("importe_neto").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    cuentaEfectivoId: uuid("cuenta_efectivo_id").references(() => cuentasEfectivo.id),
    referencia: text("referencia"),
    asientoId: uuid("asiento_id"),
    ...auditoria(),
  },
  (t) => [index("letra_pagos_ix").on(t.empresaId, t.letraId, t.fecha)],
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

// ─── Ventas y comprobantes electrónicos ───────────────────────────────────

/**
 * Comprobantes emitidos.
 *
 * Una sola tabla para facturas, boletas y notas: comparten el 90 % de los
 * campos y separarlas obligaría a unir tres tablas cada vez que alguien
 * pregunta «cuánto vendimos». El `tipo_documento` del catálogo 01 las
 * distingue.
 *
 * El XML firmado y el CDR se guardan aquí, no en disco: son los documentos que
 * sustentan la operación ante SUNAT y tienen que sobrevivir a cualquier cambio
 * de proveedor de almacenamiento.
 */
/**
 * Cotización y pedido de venta.
 *
 * Es la mitad del trabajo comercial que ocurre **antes** de facturar, y la que
 * el cliente hace todos los días en Starsoft: se cotiza, el cliente acepta, se
 * convierte en pedido y el almacén despacha contra ese pedido. Sin esto la
 * venta nace ya facturada y no hay forma de saber qué está comprometido.
 *
 * Las dos comparten forma porque son el mismo documento en dos momentos: una
 * cotización aceptada se convierte en pedido conservando sus líneas y precios.
 */
export const cotizaciones = pgTable(
  "cotizaciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    clienteId: uuid("cliente_id").notNull().references(() => terceros.id),
    fecha: fecha("fecha").notNull(),
    /** Hasta cuándo se respeta el precio. */
    validaHasta: fecha("valida_hasta"),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** pendiente, aceptada, rechazada, vencida, convertida */
    estado: text("estado").notNull().default("pendiente"),
    condicionPago: text("condicion_pago"),
    observaciones: text("observaciones"),
    gravadas: importeCero("gravadas"),
    igv: importeCero("igv"),
    total: importe("total").notNull(),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("cotizaciones_uk").on(t.empresaId, t.numero),
    index("cotizaciones_cliente_ix").on(t.empresaId, t.clienteId),
  ],
);

export const cotizacionItems = pgTable(
  "cotizacion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cotizacionId: uuid("cotizacion_id")
      .notNull()
      .references(() => cotizaciones.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull(),
    cantidad: importe("cantidad").notNull(),
    valorUnitario: importe("valor_unitario").notNull(),
    descuento: importeCero("descuento"),
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    importeLinea: importeCero("importe_linea"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("cotizacion_items_uk").on(t.cotizacionId, t.linea)],
);

export const pedidos = pgTable(
  "pedidos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    clienteId: uuid("cliente_id").notNull().references(() => terceros.id),
    /** La cotización de la que nació, si nació de una. */
    cotizacionId: uuid("cotizacion_id").references(() => cotizaciones.id),
    fecha: fecha("fecha").notNull(),
    fechaEntrega: fecha("fecha_entrega"),
    almacenId: uuid("almacen_id").references(() => almacenes.id),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** pendiente, parcial, atendido, anulado */
    estado: text("estado").notNull().default("pendiente"),
    condicionPago: text("condicion_pago"),
    observaciones: text("observaciones"),
    gravadas: importeCero("gravadas"),
    igv: importeCero("igv"),
    total: importe("total").notNull(),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("pedidos_uk").on(t.empresaId, t.numero),
    index("pedidos_cliente_ix").on(t.empresaId, t.clienteId),
    index("pedidos_estado_ix").on(t.empresaId, t.estado),
  ],
);

export const pedidoItems = pgTable(
  "pedido_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoId: uuid("pedido_id").notNull().references(() => pedidos.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull(),
    cantidad: importe("cantidad").notNull(),
    /** Lo ya facturado. El pedido se cierra cuando iguala a `cantidad`. */
    cantidadAtendida: importeCero("cantidad_atendida"),
    valorUnitario: importe("valor_unitario").notNull(),
    descuento: importeCero("descuento"),
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    importeLinea: importeCero("importe_linea"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("pedido_items_uk").on(t.pedidoId, t.linea)],
);

export const comprobantes = pgTable(
  "comprobantes",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    clienteId: uuid("cliente_id").notNull().references(() => terceros.id),
    /** Catálogo 01 de SUNAT. */
    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    horaEmision: text("hora_emision"),
    fechaVencimiento: fecha("fecha_vencimiento"),
    periodo: text("periodo").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** Catálogo 51: tipo de operación de venta. */
    tipoOperacion: text("tipo_operacion").notNull().default("0101"),

    gravadas: importeCero("gravadas"),
    exoneradas: importeCero("exoneradas"),
    inafectas: importeCero("inafectas"),
    exportacion: importeCero("exportacion"),
    gratuitas: importeCero("gratuitas"),
    isc: importeCero("isc"),
    igv: importeCero("igv"),
    igvGratuitas: importeCero("igv_gratuitas"),
    otrosCargos: importeCero("otros_cargos"),
    descuentoGlobal: importeCero("descuento_global"),
    total: importe("total").notNull(),
    totalEnLetras: text("total_en_letras"),

    /**
     * Saldo traído de otro sistema al migrar.
     *
     * Cuenta para la cartera —es dinero que el cliente debe— y **no** para los
     * libros: esa factura ya se declaró en el sistema anterior, y volver a
     * declararla sería pagar dos veces su IGV. Es una bandera y no un estado
     * porque el estado dice dónde está el documento frente a SUNAT, y uno
     * migrado no está en ningún punto de ese camino: nunca se envía.
     */
    esApertura: boolean("es_apertura").notNull().default(false),
    /** Envíos fallidos acumulados. Ver `cola-cpe.ts`. */
    intentosEnvio: integer("intentos_envio").notNull().default(0),
    ultimoError: text("ultimo_error"),
    /** Cuándo puede volver a intentarse. Espera creciente entre fallos. */
    reintentarDesde: timestamp("reintentar_desde", { withTimezone: true }),
    detraccionCodigo: text("detraccion_codigo"),
    detraccionTasa: importe("detraccion_tasa"),
    detraccionMonto: importeCero("detraccion_monto"),
    percepcionMonto: importeCero("percepcion_monto"),

    /** Si es una nota, el comprobante que modifica. */
    modificaA: uuid("modifica_a"),
    /** Catálogo 09 o 10 según el tipo de nota. */
    motivoNota: text("motivo_nota"),
    descripcionMotivo: text("descripcion_motivo"),

    almacenId: uuid("almacen_id").references(() => almacenes.id),
    /** El pedido que se está atendiendo, si la venta nació de uno. */
    pedidoId: uuid("pedido_id"),
    asientoId: uuid("asiento_id"),

    /** borrador, firmado, enviado, aceptado, aceptado_con_observaciones, rechazado, anulado */
    estado: text("estado").notNull().default("borrador"),
    /** XML ya firmado, tal como se envió. */
    xmlFirmado: text("xml_firmado"),
    /** Resumen SHA-256 del XML, que va impreso en la representación. */
    hashXml: text("hash_xml"),
    /** CDR devuelto por SUNAT, en base64. Es la constancia que hay que conservar. */
    cdrBase64: text("cdr_base64"),
    codigoSunat: integer("codigo_sunat"),
    mensajeSunat: text("mensaje_sunat"),
    observacionesSunat: text("observaciones_sunat").array(),
    ticketSunat: text("ticket_sunat"),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("comprobantes_uk").on(t.empresaId, t.tipoDocumento, t.serie, t.numero),
    index("comprobantes_periodo_ix").on(t.empresaId, t.periodo),
    index("comprobantes_cliente_ix").on(t.empresaId, t.clienteId),
    index("comprobantes_estado_ix").on(t.empresaId, t.estado),
  ],
);

export const comprobanteItems = pgTable(
  "comprobante_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    comprobanteId: uuid("comprobante_id")
      .notNull()
      .references(() => comprobantes.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull(),
    cantidad: importe("cantidad").notNull(),
    valorUnitario: importe("valor_unitario").notNull(),
    precioUnitario: importe("precio_unitario").notNull(),
    descuento: importeCero("descuento"),
    /** Catálogo 07. */
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    valorVenta: importeCero("valor_venta"),
    igv: importeCero("igv"),
    importeLinea: importeCero("importe_linea"),
    /** Costo de venta tomado del kardex al despachar. */
    costoUnitario: importe("costo_unitario"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("comprobante_items_uk").on(t.comprobanteId, t.linea)],
);

/**
 * Certificado digital de la empresa para firmar comprobantes.
 *
 * El `.pfx` va cifrado con sobre; la contraseña, también. Ninguno de los dos se
 * guarda en claro: con ellos se puede emitir cualquier comprobante a nombre de
 * ese RUC, así que son lo más valioso que custodia el sistema.
 */
export const certificadosDigitales = pgTable(
  "certificados_digitales",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Sobre cifrado con el contenido del .pfx. */
    pfxCifrado: jsonb("pfx_cifrado").notNull(),
    /** Sobre cifrado con la contraseña del .pfx. */
    passwordCifrado: jsonb("password_cifrado").notNull(),
    /** RUC que declara el certificado; se compara con el de la empresa. */
    ruc: text("ruc"),
    vigenteHasta: fecha("vigente_hasta"),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [index("certificados_empresa_ix").on(t.empresaId, t.activo)],
);

/**
 * Credenciales SOL para el servicio de SUNAT.
 *
 * Separadas del certificado porque son cosas distintas: el certificado firma,
 * las credenciales autentican el envío. La clave va cifrada con sobre.
 */
export const credencialesSunat = pgTable(
  "credenciales_sunat",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    usuarioSol: text("usuario_sol").notNull(),
    claveCifrada: jsonb("clave_cifrada").notNull(),
    /** "beta" mientras se homologa, "produccion" cuando emite de verdad. */
    entorno: text("entorno").notNull().default("beta"),
    /**
     * Credenciales de la API de guías de remisión. Son distintas de las SOL: se
     * generan aparte en el menú SOL y sólo sirven para la GRE.
     */
    greClientId: text("gre_client_id"),
    greClientSecretCifrado: jsonb("gre_client_secret_cifrado"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("credenciales_sunat_uk").on(t.empresaId)],
);

/**
 * Comprobantes de retención y de percepción.
 *
 * Van juntos porque son el mismo documento con el signo cambiado: uno se emite
 * al pagar y descuenta, el otro al cobrar y añade. Los dos se envían por
 * `sendBill` como una factura, pero no son ventas —no llevan IGV ni base
 * imponible— y por eso no comparten tabla con `comprobantes`.
 */
export const comprobantesRetencion = pgTable(
  "comprobantes_retencion",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Catálogo 01: "20" retención, "40" percepción. */
    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    horaEmision: text("hora_emision"),
    /** El proveedor en la retención, el cliente en la percepción. */
    terceroId: uuid("tercero_id").notNull().references(() => terceros.id),
    /** Catálogo 23 (retención) o 22 (percepción). */
    regimen: text("regimen").notNull(),
    tasa: importe("tasa").notNull(),
    /** Retenido o percibido, en soles. */
    importeTotal: importe("importe_total").notNull(),
    /** Pagado o cobrado, en soles. */
    importeOperacion: importe("importe_operacion").notNull(),
    observacion: text("observacion"),

    estado: text("estado").notNull().default("borrador"),
    xmlFirmado: text("xml_firmado"),
    hashXml: text("hash_xml"),
    cdrBase64: text("cdr_base64"),
    codigoSunat: integer("codigo_sunat"),
    mensajeSunat: text("mensaje_sunat"),
    observacionesSunat: text("observaciones_sunat").array(),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("comprobantes_retencion_uk").on(t.empresaId, t.tipoDocumento, t.serie, t.numero),
    index("comprobantes_retencion_estado_ix").on(t.empresaId, t.estado),
  ],
);

/** Documentos sobre los que se retuvo o percibió, con su importe. */
export const retencionItems = pgTable(
  "retencion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    retencionId: uuid("retencion_id")
      .notNull()
      .references(() => comprobantesRetencion.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    /** El documento por pagar (retención) o el comprobante emitido (percepción). */
    documentoCxpId: uuid("documento_cxp_id").references(() => documentosCxp.id),
    comprobanteId: uuid("comprobante_id").references(() => comprobantes.id),
    /** El pago o la cobranza que la originó. */
    pagoId: uuid("pago_id").references(() => pagos.id),
    /** El pago de letra que lo originó, cuando la retención no viene de un pago. */
    letraPagoId: uuid("letra_pago_id"),
    cobranzaId: uuid("cobranza_id"),

    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaDocumento: fecha("fecha_documento").notNull(),
    moneda: text("moneda").notNull(),
    totalDocumento: importe("total_documento").notNull(),
    importePagado: importe("importe_pagado").notNull(),
    /** Retenido o percibido de este documento, en soles. */
    importe: importe("importe").notNull(),
    /** Neto entregado o cobrado, en soles. */
    neto: importe("neto").notNull(),
    fecha: fecha("fecha").notNull(),
    tipoCambio: importe("tipo_cambio"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("retencion_items_uk").on(t.retencionId, t.linea)],
);

/**
 * Guías de remisión electrónicas.
 *
 * No comparten tabla con los comprobantes porque no son comprobantes: no llevan
 * importes ni impuestos, viajan por una API REST distinta y su desenlace es un
 * ticket, no un CDR inmediato. Meterlas en `comprobantes` obligaría a dejar en
 * blanco la mitad de las columnas y a distinguir el caso en cada consulta.
 */
export const guiasRemision = pgTable(
  "guias_remision",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Catálogo 21: "09" guía del remitente, "31" del transportista. */
    tipoGuia: text("tipo_guia").notNull().default("09"),
    serie: text("serie").notNull(),
    numero: text("numero").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    horaEmision: text("hora_emision"),

    destinatarioId: uuid("destinatario_id").notNull().references(() => terceros.id),
    /** Catálogo 20: motivo del traslado. */
    motivo: text("motivo").notNull(),
    descripcionMotivo: text("descripcion_motivo").notNull(),

    pesoBruto: importe("peso_bruto").notNull(),
    unidadPeso: text("unidad_peso").notNull().default("KGM"),
    bultos: integer("bultos"),

    /** Catálogo 18: "01" público, "02" privado. */
    modoTransporte: text("modo_transporte").notNull(),
    fechaTraslado: fecha("fecha_traslado").notNull(),

    partidaUbigeo: text("partida_ubigeo").notNull(),
    partidaDireccion: text("partida_direccion").notNull(),
    partidaEstablecimiento: text("partida_establecimiento"),
    llegadaUbigeo: text("llegada_ubigeo").notNull(),
    llegadaDireccion: text("llegada_direccion").notNull(),
    llegadaEstablecimiento: text("llegada_establecimiento"),

    /** Transporte público. */
    transportistaId: uuid("transportista_id").references(() => terceros.id),
    registroMtc: text("registro_mtc"),
    /** Transporte privado. */
    placa: text("placa"),
    conductorTipoDoc: text("conductor_tipo_doc"),
    conductorNumDoc: text("conductor_num_doc"),
    conductorNombres: text("conductor_nombres"),
    conductorApellidos: text("conductor_apellidos"),
    conductorLicencia: text("conductor_licencia"),

    /** Comprobante que sustenta el traslado, cuando el motivo lo exige. */
    comprobanteId: uuid("comprobante_id").references(() => comprobantes.id),
    almacenId: uuid("almacen_id").references(() => almacenes.id),
    observaciones: text("observaciones"),

    /** borrador, enviada, aceptada, rechazada, anulada */
    estado: text("estado").notNull().default("borrador"),
    xmlFirmado: text("xml_firmado"),
    hashXml: text("hash_xml"),
    ticket: text("ticket"),
    cdrBase64: text("cdr_base64"),
    codigoSunat: text("codigo_sunat"),
    mensajeSunat: text("mensaje_sunat"),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("guias_remision_uk").on(t.empresaId, t.tipoGuia, t.serie, t.numero),
    index("guias_remision_estado_ix").on(t.empresaId, t.estado),
  ],
);

export const guiaItems = pgTable(
  "guia_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    guiaId: uuid("guia_id")
      .notNull()
      .references(() => guiasRemision.id, { onDelete: "cascade" }),
    linea: integer("linea").notNull(),
    productoId: uuid("producto_id").references(() => productos.id),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    unidad: text("unidad").notNull(),
    cantidad: importe("cantidad").notNull(),
    ...auditoria(),
  },
  (t) => [uniqueIndex("guia_items_uk").on(t.guiaId, t.linea)],
);

/**
 * Resúmenes diarios de boletas y comunicaciones de baja.
 *
 * Los dos comparten tabla porque comparten todo lo que importa: se envían por
 * `sendSummary`, SUNAT devuelve un ticket y el resultado se recoge después. Lo
 * único que cambia es el tipo y qué comprobantes agrupan.
 */
export const resumenes = pgTable(
  "resumenes",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** "RC" resumen diario de boletas, "RA" comunicación de baja. */
    tipo: text("tipo").notNull(),
    /** Identificador SUNAT: RC-AAAAMMDD-N. Es también el nombre del archivo. */
    identificador: text("identificador").notNull(),
    /** Día de los comprobantes que agrupa. */
    fechaReferencia: fecha("fecha_referencia").notNull(),
    fechaEmision: fecha("fecha_emision").notNull(),
    correlativo: integer("correlativo").notNull(),

    /** borrador, enviado, aceptado, aceptado_con_observaciones, rechazado */
    estado: text("estado").notNull().default("borrador"),
    xmlFirmado: text("xml_firmado"),
    hashXml: text("hash_xml"),
    /** Lo devuelve `sendSummary`; con él se recoge el CDR más tarde. */
    ticket: text("ticket"),
    cdrBase64: text("cdr_base64"),
    codigoSunat: integer("codigo_sunat"),
    mensajeSunat: text("mensaje_sunat"),
    observacionesSunat: text("observaciones_sunat").array(),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("resumenes_uk").on(t.empresaId, t.identificador),
    index("resumenes_estado_ix").on(t.empresaId, t.estado),
  ],
);

/** Comprobantes incluidos en un resumen, con el estado que se les informó. */
export const resumenItems = pgTable(
  "resumen_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    resumenId: uuid("resumen_id")
      .notNull()
      .references(() => resumenes.id, { onDelete: "cascade" }),
    comprobanteId: uuid("comprobante_id").references(() => comprobantes.id),
    linea: integer("linea").notNull(),
    /** Catálogo 19: 1 adicionar, 2 modificar, 3 anular. */
    estadoItem: text("estado_item").notNull().default("1"),
    /** Sólo en la baja: por qué se anula. SUNAT lo lee. */
    motivo: text("motivo"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("resumen_items_uk").on(t.resumenId, t.linea)],
);

// ─── Cobranzas ────────────────────────────────────────────────────────────

/**
 * Cobranzas de clientes.
 *
 * No hay una tabla de documentos por cobrar equivalente a `documentos_cxp`: el
 * comprobante emitido ya tiene el total y el vencimiento, y el saldo se deriva
 * restándole lo cobrado. Duplicarlo obligaría a mantener dos verdades
 * sincronizadas, y la que se desincroniza siempre es la copia.
 */
export const cobranzas = pgTable(
  "cobranzas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    clienteId: uuid("cliente_id").notNull().references(() => terceros.id),
    fecha: fecha("fecha").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** efectivo, transferencia, cheque, deposito, letra */
    medioCobro: text("medio_cobro").notNull(),
    importe: importe("importe").notNull(),
    referencia: text("referencia"),
    asientoId: uuid("asiento_id"),
    /** registrada, anulada */
    estado: text("estado").notNull().default("registrada"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("cobranzas_uk").on(t.empresaId, t.numero),
    index("cobranzas_cliente_ix").on(t.empresaId, t.clienteId),
  ],
);

export const cobranzaAplicaciones = pgTable(
  "cobranza_aplicaciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cobranzaId: uuid("cobranza_id")
      .notNull()
      .references(() => cobranzas.id, { onDelete: "cascade" }),
    comprobanteId: uuid("comprobante_id").notNull().references(() => comprobantes.id),
    importe: importe("importe").notNull(),
    /** Diferencia de cambio al cobrar en otra moneda o a otro tipo. */
    diferenciaCambio: importeCero("diferencia_cambio"),
    ...auditoria(),
  },
  (t) => [
    index("cobranza_aplicaciones_cobranza_ix").on(t.cobranzaId),
    index("cobranza_aplicaciones_comprobante_ix").on(t.comprobanteId),
  ],
);

// ─── Caja y bancos ────────────────────────────────────────────────────────

/**
 * Cuentas de efectivo: cajas y cuentas bancarias.
 *
 * Cada una apunta a su cuenta contable. Sin ese vínculo, conciliar el extracto
 * del banco contra la contabilidad obliga a que alguien recuerde de memoria qué
 * cuenta corresponde a qué banco, y esa memoria se pierde con la persona.
 */
export const cuentasEfectivo = pgTable(
  "cuentas_efectivo",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    /** "caja", "caja_chica" o "banco". */
    tipo: text("tipo").notNull(),
    moneda: text("moneda").notNull().default("PEN"),
    /** Cuenta del PCGE donde se refleja: 1011, 1012, 1041… */
    cuentaContable: text("cuenta_contable").notNull(),
    banco: text("banco"),
    numeroCuenta: text("numero_cuenta"),
    /** Cuenta interbancaria, para transferencias. */
    cci: text("cci"),
    /** Sólo en caja chica: el fondo fijo asignado. */
    fondoFijo: importeCero("fondo_fijo"),
    responsableId: uuid("responsable_id"),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("cuentas_efectivo_uk").on(t.empresaId, t.codigo)],
);

/**
 * Movimientos de caja y bancos.
 *
 * Es el libro auxiliar: lo que la empresa cree que pasó en cada cuenta. La
 * conciliación lo compara con el extracto del banco, que es lo que el banco
 * dice que pasó. Las diferencias entre ambos son el objeto del ejercicio.
 */
export const movimientosEfectivo = pgTable(
  "movimientos_efectivo",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    fecha: fecha("fecha").notNull(),
    /** "ingreso" o "egreso". */
    sentido: text("sentido").notNull(),
    concepto: text("concepto").notNull(),
    importe: importe("importe").notNull(),
    moneda: text("moneda").notNull(),
    tipoCambio: importe("tipo_cambio").notNull().default("1"),
    /** Número de operación, cheque o voucher. */
    referencia: text("referencia"),
    terceroId: uuid("tercero_id").references(() => terceros.id),
    /** De qué módulo vino: pagos, cobranzas, caja… */
    origenModulo: text("origen_modulo"),
    origenId: uuid("origen_id"),
    asientoId: uuid("asiento_id"),
    /** Fecha en la que el banco lo reconoció. Nulo mientras no se concilie. */
    conciliadoEn: fecha("conciliado_en"),
    /** Línea del extracto con la que casó. */
    extractoId: uuid("extracto_id"),
    ...auditoria(),
  },
  (t) => [
    index("movimientos_efectivo_cuenta_ix").on(t.empresaId, t.cuentaId, t.fecha),
    index("movimientos_efectivo_conciliacion_ix").on(t.cuentaId, t.conciliadoEn),
  ],
);

/**
 * Líneas del extracto bancario.
 *
 * Se importan del archivo que entrega el banco y se comparan con los
 * movimientos propios. Una línea sin pareja es o un cargo que la empresa no
 * registró —una comisión, un ITF— o un depósito que nadie contabilizó.
 */
/**
 * Recibo de caja: el papel que acompaña a un movimiento de efectivo.
 *
 * En Starsoft se emite un recibo por cada ingreso y cada egreso de caja, y ese
 * papel firmado es el sustento del movimiento. Sin él, el que entrega el dinero
 * no se lleva nada y la caja no tiene cómo demostrar qué salió.
 *
 * El recibo no es el movimiento: lo envuelve. El movimiento y su asiento son
 * los de siempre, y el recibo les pone número, beneficiario y una versión
 * imprimible.
 */
export const recibos = pgTable(
  "recibos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    /** ingreso o egreso. */
    tipo: text("tipo").notNull(),
    fecha: fecha("fecha").notNull(),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    terceroId: uuid("tercero_id").references(() => terceros.id),
    /** A quién se le entrega o de quién se recibe, cuando no es un tercero. */
    aNombreDe: text("a_nombre_de"),
    concepto: text("concepto").notNull(),
    importe: importe("importe").notNull(),
    moneda: text("moneda").notNull(),
    importeEnLetras: text("importe_en_letras"),
    movimientoId: uuid("movimiento_id"),
    asientoId: uuid("asiento_id"),
    /** emitido, anulado */
    estado: text("estado").notNull().default("emitido"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("recibos_uk").on(t.empresaId, t.numero),
    index("recibos_fecha_ix").on(t.empresaId, t.fecha),
  ],
);

/**
 * Cheque girado contra una cuenta bancaria.
 *
 * Un cheque no se cobra el día que se gira, y entre una cosa y la otra hay
 * dinero comprometido que el saldo del banco todavía no refleja. La «situación
 * de cheques» de Starsoft es exactamente esa lista: qué se giró, qué se
 * entregó, qué se cobró y qué sigue en el aire.
 *
 * Un cheque diferido se gira hoy con fecha de cobro futura, y hasta esa fecha
 * no puede presentarse: por eso la fecha de cobro es un campo propio y no una
 * observación.
 */
export const cheques = pgTable(
  "cheques",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /**
     * emitido (lo giramos nosotros) o recibido (nos lo dio un cliente).
     *
     * La misma tabla sirve a las dos carteras porque el problema es idéntico:
     * un papel que vale dinero y todavía no se ha convertido en dinero. Sólo
     * cambian los estados por los que pasa.
     */
    cartera: text("cartera").notNull().default("emitido"),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    numero: text("numero").notNull(),
    fechaGiro: fecha("fecha_giro").notNull(),
    /** Fecha a partir de la cual puede cobrarse. Diferido si es posterior. */
    fechaCobro: fecha("fecha_cobro"),
    beneficiarioId: uuid("beneficiario_id").references(() => terceros.id),
    /** Nombre impreso en el cheque, que puede no ser un tercero del maestro. */
    beneficiario: text("beneficiario").notNull(),
    importe: importe("importe").notNull(),
    moneda: text("moneda").notNull(),
    /** girado, entregado, cobrado, anulado */
    estado: text("estado").notNull().default("girado"),
    /** Cuándo se cobró de verdad, según el extracto del banco. */
    fechaCobrado: fecha("fecha_cobrado"),
    /** Por qué lo devolvió el banco: sin fondos, cuenta cerrada, firma. */
    motivoRechazo: text("motivo_rechazo"),
    /** El pago que lo originó, si nació de uno. */
    pagoId: uuid("pago_id"),
    /** La cobranza en la que se recibió, si es de la cartera de cobrar. */
    cobranzaId: uuid("cobranza_id"),
    /** Banco girador, en un cheque recibido. */
    bancoGirador: text("banco_girador"),
    movimientoId: uuid("movimiento_id"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("cheques_uk").on(t.empresaId, t.cartera, t.cuentaId, t.numero),
    index("cheques_estado_ix").on(t.empresaId, t.cartera, t.estado),
  ],
);

/**
 * Entrega a rendir cuenta.
 *
 * Dinero que sale de caja a nombre de alguien que todavía no lo gastó: un viaje,
 * una compra menor, un trámite. Contablemente es un activo (14) hasta que se
 * rinde, no un gasto, y confundir las dos cosas es lo que hace que el gasto del
 * mes aparezca el día equivocado.
 *
 * Se rinde con documentos: cada uno descarga parte de la entrega y va a su
 * cuenta de gasto. Lo que sobra se devuelve; lo que falta se reembolsa.
 */
export const entregasRendir = pgTable(
  "entregas_rendir",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    fecha: fecha("fecha").notNull(),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    /** A quién se le entregó. */
    responsableId: uuid("responsable_id"),
    responsable: text("responsable").notNull(),
    motivo: text("motivo").notNull(),
    importe: importe("importe").notNull(),
    /** Ya rendido y aceptado. */
    rendido: importeCero("rendido"),
    /** Vuelto a caja. */
    devuelto: importeCero("devuelto"),
    moneda: text("moneda").notNull(),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    /** pendiente, parcial, rendida, anulada */
    estado: text("estado").notNull().default("pendiente"),
    movimientoId: uuid("movimiento_id"),
    asientoId: uuid("asiento_id"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("entregas_rendir_uk").on(t.empresaId, t.numero),
    index("entregas_rendir_estado_ix").on(t.empresaId, t.estado),
  ],
);

/** Cada documento con el que se rinde parte de una entrega. */
export const rendicionItems = pgTable(
  "rendicion_items",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    entregaId: uuid("entrega_id")
      .notNull()
      .references(() => entregasRendir.id, { onDelete: "cascade" }),
    fecha: fecha("fecha").notNull(),
    /** Catálogo 01: factura, boleta, recibo por honorarios, ticket… */
    tipoDocumento: text("tipo_documento"),
    serie: text("serie"),
    numero: text("numero"),
    proveedorId: uuid("proveedor_id").references(() => terceros.id),
    concepto: text("concepto").notNull(),
    /** Cuenta de gasto a la que va. */
    cuenta: text("cuenta").notNull(),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    importe: importe("importe").notNull(),
    /** IGV del documento, si da crédito fiscal. */
    igv: importeCero("igv"),
    ...auditoria(),
  },
  (t) => [index("rendicion_items_ix").on(t.entregaId)],
);

/**
 * Formato de un estado financiero.
 *
 * El estado de situación y el de resultados que trae el programa agrupan por
 * los primeros dígitos de la cuenta, y eso sirve para revisar. Para presentar,
 * cada contador tiene su plantilla: qué cuentas entran en cada renglón, en qué
 * orden, con qué nombre y qué subtotales. Starsoft lo llama «formatos
 * configurables de EEFF» y es de las primeras cosas que un contador pide.
 *
 * El formato es la plantilla; los saldos siguen saliendo de los asientos. No se
 * puede configurar un estado que diga algo distinto de lo que dice el mayor:
 * sólo cómo se presenta.
 */
/**
 * Presupuesto de un ejercicio.
 *
 * Lo que una empresa **planea** gastar e ingresar, por centro de costo y por
 * mes. No es contabilidad: no genera asientos ni toca saldos. Su único trabajo
 * es servir de vara de medir contra lo que de verdad ocurrió.
 *
 * Starsoft lo llama «presupuesto por centro de costos y análisis presupuestal»,
 * y es lo que convierte el resultado por obra en una herramienta de gestión:
 * saber que una obra perdió 3 000 soles dice poco; saber que perdió 3 000 sobre
 * un plan de ganar 5 000 dice qué hacer.
 */
/**
 * Regla de destino: a qué función va cada gasto.
 *
 * El PCGE registra los gastos por **naturaleza** en la clase 6 —personal,
 * servicios, tributos— y eso es lo que exige SUNAT. Pero para saber cuánto
 * costó vender y cuánto administrar hace falta la otra vista, la **funcional**,
 * y esa vive en la clase 9. Pasar de una a otra es el «asiento de destino», y
 * estas reglas dicen cómo hacerlo.
 *
 * Gana la regla más específica: una que nombra cuenta y centro de costo pesa
 * más que una que sólo nombra la cuenta, y entre dos de la misma clase gana la
 * del prefijo más largo. Sin ese orden, el resultado dependería de cómo estén
 * guardadas las filas.
 */
export const reglasDestino = pgTable(
  "reglas_destino",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Prefijo de cuenta de la clase 6: «63», «6311». Vacío, cualquiera. */
    cuenta: text("cuenta"),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    /** Cuenta de la clase 9 a la que se lleva: 92, 94, 95, 97. */
    cuentaDestino: text("cuenta_destino").notNull(),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [index("reglas_destino_ix").on(t.empresaId, t.cuenta)],
);

export const presupuestos = pgTable(
  "presupuestos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    /** Año al que corresponde: 2026. */
    ejercicio: integer("ejercicio").notNull(),
    /** borrador, aprobado, cerrado */
    estado: text("estado").notNull().default("borrador"),
    observaciones: text("observaciones"),
    aprobadoPor: uuid("aprobado_por"),
    aprobadoEn: timestamp("aprobado_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("presupuestos_uk").on(t.empresaId, t.codigo),
    index("presupuestos_ejercicio_ix").on(t.empresaId, t.ejercicio),
  ],
);

/**
 * Una partida del presupuesto: cuánto, en qué cuenta, de qué centro y en qué mes.
 *
 * El grano es el mes porque es el grano con el que se controla: un presupuesto
 * anual sin reparto mensual no dice nada en marzo, que es cuando hace falta
 * saber si se va bien.
 */
export const presupuestoLineas = pgTable(
  "presupuesto_lineas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    presupuestoId: uuid("presupuesto_id")
      .notNull()
      .references(() => presupuestos.id, { onDelete: "cascade" }),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    /** Prefijo de cuenta: «63», «6351», «70». */
    cuenta: text("cuenta").notNull(),
    /** 1 a 12. */
    mes: integer("mes").notNull(),
    importe: importe("importe").notNull(),
    ...auditoria(),
  },
  (t) => [
    // La unicidad real la declara la migración con dos índices parciales: un
    // NULL no es igual a otro NULL, y en Postgres 14 no hay `NULLS NOT
    // DISTINCT`. Aquí basta el índice de búsqueda.
    index("presupuesto_lineas_ix").on(t.empresaId, t.presupuestoId),
  ],
);

export const formatosEeff = pgTable(
  "formatos_eeff",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    /** situacion o resultados. */
    tipo: text("tipo").notNull(),
    /** El que se ofrece primero. Uno por tipo. */
    esPredeterminado: boolean("es_predeterminado").notNull().default(false),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("formatos_eeff_uk").on(t.empresaId, t.codigo),
    index("formatos_eeff_tipo_ix").on(t.empresaId, t.tipo),
  ],
);

/**
 * Un renglón de la plantilla.
 *
 * Hay tres clases y ninguna más, a propósito: con un lenguaje de fórmulas se
 * puede escribir un estado que no cuadre, y aquí lo que se configura es la
 * presentación, no la aritmética.
 *
 * - **titulo**: un encabezado sin importe.
 * - **detalle**: suma los saldos de las cuentas que casen con `cuentas`.
 * - **total**: suma los renglones anteriores cuyo `codigo` esté en `suma`.
 */
export const formatoEeffLineas = pgTable(
  "formato_eeff_lineas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    formatoId: uuid("formato_id")
      .notNull()
      .references(() => formatosEeff.id, { onDelete: "cascade" }),
    orden: integer("orden").notNull(),
    /** Etiqueta corta para que un total pueda referirse a este renglón. */
    codigo: text("codigo"),
    concepto: text("concepto").notNull(),
    /** titulo, detalle o total. */
    clase: text("clase").notNull().default("detalle"),
    /** Sangría al presentarlo. */
    nivel: integer("nivel").notNull().default(1),
    /**
     * Cuentas que entran, separadas por coma. Cada elemento es un prefijo
     * («10», «40111») o un rango de prefijos del mismo largo («12-18»).
     */
    cuentas: text("cuentas"),
    /**
     * deudor deja el saldo tal cual (debe − haber); acreedor lo invierte.
     *
     * El pasivo, el patrimonio y los ingresos tienen saldo acreedor y se
     * presentan en positivo: sin esto saldrían todos en negativo.
     */
    signo: text("signo").notNull().default("deudor"),
    /** Códigos de los renglones que suma, cuando la clase es total. */
    suma: text("suma"),
    /** activo o pasivo, para el estado de situación a dos columnas. */
    columna: text("columna"),
    /**
     * Qué representa este renglón, para quien lo lea sin saber contabilidad.
     *
     * Los ratios se calculan sobre el formato y no sobre rangos de cuentas
     * porque hay cosas que el número de cuenta no dice: qué parte del pasivo es
     * corriente, por ejemplo, lo decide el contador al armar la plantilla. El
     * papel es cómo se lo cuenta al programa: `activo_corriente`,
     * `pasivo_corriente`, `existencias`, `ventas`, `utilidad_bruta`…
     */
    papel: text("papel"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("formato_eeff_lineas_uk").on(t.formatoId, t.orden)],
);

export const extractoBancario = pgTable(
  "extracto_bancario",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    fecha: fecha("fecha").notNull(),
    descripcion: text("descripcion").notNull(),
    /** Positivo si entra, negativo si sale, tal como lo informa el banco. */
    importe: importe("importe").notNull(),
    referencia: text("referencia"),
    /** Saldo que el banco declara después de este movimiento. */
    saldo: importe("saldo"),
    /** Movimiento propio con el que casó. Nulo mientras esté sin conciliar. */
    movimientoId: uuid("movimiento_id"),
    ...auditoria(),
  },
  (t) => [
    index("extracto_cuenta_fecha_ix").on(t.empresaId, t.cuentaId, t.fecha),
    index("extracto_sin_conciliar_ix").on(t.cuentaId, t.movimientoId),
  ],
);

/**
 * Arqueos de caja.
 *
 * Se cuenta el efectivo que hay y se compara con el que debería haber. La
 * diferencia se guarda aunque sea cero: un arqueo que no deja rastro no sirve
 * como control.
 */
export const arqueos = pgTable(
  "arqueos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cuentaId: uuid("cuenta_id").notNull().references(() => cuentasEfectivo.id),
    fecha: fecha("fecha").notNull(),
    /** Saldo que arroja el sistema al momento del arqueo. */
    saldoLibro: importe("saldo_libro").notNull(),
    /** Efectivo contado físicamente. */
    saldoContado: importe("saldo_contado").notNull(),
    diferencia: importe("diferencia").notNull(),
    observaciones: text("observaciones"),
    asientoId: uuid("asiento_id"),
    ...auditoria(),
  },
  (t) => [index("arqueos_cuenta_ix").on(t.empresaId, t.cuentaId, t.fecha)],
);
