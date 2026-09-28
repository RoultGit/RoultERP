/**
 * Maestros: la información que el resto de módulos referencia y que casi nunca
 * cambia.
 *
 * Clientes y proveedores viven en una sola tabla, `terceros`, con banderas.
 * En la práctica el mismo RUC es proveedor y cliente más veces de las que
 * parece, y duplicarlo obliga a mantener dos direcciones que se desincronizan.
 */
import {
  boolean, index, integer, pgTable, text, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { auditoria, empresaId, fecha, id, importe, importeCero } from "./comun.ts";
import { empresas } from "./identidad.ts";

export const sucursales = pgTable(
  "sucursales",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    direccion: text("direccion"),
    ubigeo: text("ubigeo"),
    /** Código de establecimiento anexo ante SUNAT. Va en el PLE 13.1. */
    codigoSunat: text("codigo_sunat"),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("sucursales_uk").on(t.empresaId, t.codigo)],
);

export const almacenes = pgTable(
  "almacenes",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    sucursalId: uuid("sucursal_id").references(() => sucursales.id),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    /** Los almacenes de tránsito no entran a la valorización de existencias. */
    esTransito: boolean("es_transito").notNull().default(false),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("almacenes_uk").on(t.empresaId, t.codigo)],
);

export const centrosCosto = pgTable(
  "centros_costo",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    padreId: uuid("padre_id"),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("centros_costo_uk").on(t.empresaId, t.codigo)],
);

/**
 * Plan de cuentas. Se siembra con el PCGE al crear la empresa y desde ahí lo
 * mantiene el contador.
 *
 * Las banderas `exige*` son control de calidad del asiento: una cuenta 42 sin
 * proveedor imputado hace inútil el estado de cuenta por proveedor, así que la
 * cuenta declara qué necesita y la validación lo exige al contabilizar.
 */
export const planCuentas = pgTable(
  "plan_cuentas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    cuenta: text("cuenta").notNull(),
    descripcion: text("descripcion").notNull(),
    /** Longitud del código: 1 elemento, 2 rubro, 3 cuenta, 4+ divisionaria. */
    nivel: integer("nivel").notNull(),
    /** "deudora" o "acreedora". Orienta el signo esperado del saldo. */
    naturaleza: text("naturaleza").notNull(),
    /** Sólo las cuentas de último nivel reciben movimiento. */
    esMovimiento: boolean("es_movimiento").notNull().default(false),
    /** Moneda en la que se lleva la cuenta; NULL si acepta cualquiera. */
    moneda: text("moneda"),
    exigeAnexo: boolean("exige_anexo").notNull().default(false),
    exigeCentroCosto: boolean("exige_centro_costo").notNull().default(false),
    exigeDocumento: boolean("exige_documento").notNull().default(false),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("plan_cuentas_uk").on(t.empresaId, t.cuenta),
    index("plan_cuentas_movimiento_ix").on(t.empresaId, t.esMovimiento),
  ],
);

export const terceros = pgTable(
  "terceros",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Catálogo 06 de SUNAT: 1 DNI, 4 carné de extranjería, 6 RUC, 7 pasaporte, 0 sin documento. */
    tipoDocumento: text("tipo_documento").notNull(),
    numeroDocumento: text("numero_documento").notNull(),
    razonSocial: text("razon_social").notNull(),
    nombreComercial: text("nombre_comercial"),
    direccion: text("direccion"),
    ubigeo: text("ubigeo"),
    /** ISO 3166-1 alfa-2. PE salvo proveedores del exterior. */
    pais: text("pais").notNull().default("PE"),
    email: text("email"),
    telefono: text("telefono"),
    esCliente: boolean("es_cliente").notNull().default(false),
    esProveedor: boolean("es_proveedor").notNull().default(false),
    /**
     * Un proveedor no domiciliado no genera crédito fiscal ni retención; su
     * factura del exterior alimenta el módulo de importaciones, no el registro
     * de compras nacional.
     */
    esDomiciliado: boolean("es_domiciliado").notNull().default(true),
    esAgenteRetencion: boolean("es_agente_retencion").notNull().default(false),
    sujetoPercepcion: boolean("sujeto_percepcion").notNull().default(false),
    /** Días de crédito por defecto al emitir un documento a este tercero. */
    diasCredito: integer("dias_credito").notNull().default(0),
    /** Su cuenta de detracciones, para depositarle cuando la compra la lleva. */
    cuentaDetracciones: text("cuenta_detracciones"),
    limiteCredito: importeCero("limite_credito"),
    monedaLimite: text("moneda_limite").notNull().default("PEN"),
    /** Cuenta contable por defecto: 12 para clientes, 42 para proveedores. */
    cuentaId: uuid("cuenta_id").references(() => planCuentas.id),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("terceros_uk").on(t.empresaId, t.tipoDocumento, t.numeroDocumento),
    index("terceros_razon_ix").on(t.empresaId, t.razonSocial),
  ],
);

export const unidadesMedida = pgTable(
  "unidades_medida",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Catálogo 03 de SUNAT (UN/ECE rec 20): NIU, KGM, LTR, ZZ… */
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    ...auditoria(),
  },
  (t) => [uniqueIndex("unidades_medida_uk").on(t.empresaId, t.codigo)],
);

export const productos = pgTable(
  "productos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    unidadId: uuid("unidad_id").notNull().references(() => unidadesMedida.id),
    /** "bien" o "servicio". Un servicio no tiene kardex. */
    tipo: text("tipo").notNull().default("bien"),
    /** Catálogo 07: tipo de afectación del IGV por defecto al vender. */
    afectacionIgv: text("afectacion_igv").notNull().default("10"),
    /** Código del producto en el catálogo de SUNAT, para el CPE. */
    codigoSunat: text("codigo_sunat"),
    cuentaExistenciaId: uuid("cuenta_existencia_id").references(() => planCuentas.id),
    cuentaVentaId: uuid("cuenta_venta_id").references(() => planCuentas.id),
    cuentaCostoId: uuid("cuenta_costo_id").references(() => planCuentas.id),
    controlLote: boolean("control_lote").notNull().default(false),
    controlSerie: boolean("control_serie").notNull().default(false),
    /** Peso y volumen unitarios: base del prorrateo de flete en importaciones. */
    pesoUnitario: importe("peso_unitario"),
    volumenUnitario: importe("volumen_unitario"),
    /** Partida arancelaria, para el módulo de importaciones. */
    partidaArancelaria: text("partida_arancelaria"),
    stockMinimo: importeCero("stock_minimo"),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("productos_uk").on(t.empresaId, t.codigo),
    index("productos_descripcion_ix").on(t.empresaId, t.descripcion),
  ],
);

/**
 * Series y correlativos de los documentos que emite la empresa.
 *
 * El correlativo se toma con `UPDATE ... RETURNING` dentro de la transacción
 * que crea el documento. Es lo que evita que dos facturas simultáneas reciban
 * el mismo número, que ante SUNAT es una infracción y no un detalle.
 */
export const seriesDocumento = pgTable(
  "series_documento",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    sucursalId: uuid("sucursal_id").references(() => sucursales.id),
    /** Catálogo 01 de SUNAT: 01 factura, 03 boleta, 07 NC, 08 ND, 09 guía… */
    tipoDocumento: text("tipo_documento").notNull(),
    serie: text("serie").notNull(),
    correlativo: integer("correlativo").notNull().default(0),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("series_documento_uk").on(t.empresaId, t.tipoDocumento, t.serie)],
);

/** Reglas de detracción vigentes para la empresa. Semilla en core/tributario. */
export const reglasDetraccion = pgTable(
  "reglas_detraccion",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    tasa: importe("tasa").notNull(),
    aplicaMinimo: boolean("aplica_minimo").notNull().default(true),
    vigenteDesde: fecha("vigente_desde").notNull(),
    vigenteHasta: fecha("vigente_hasta"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("reglas_detraccion_uk").on(t.empresaId, t.codigo, t.vigenteDesde)],
);

/** Periodos contables. Un periodo cerrado no admite asientos nuevos. */
export const periodos = pgTable(
  "periodos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** AAAAMM */
    periodo: text("periodo").notNull(),
    /** "abierto", "cerrado". */
    estado: text("estado").notNull().default("abierto"),
    cerradoPor: uuid("cerrado_por"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("periodos_uk").on(t.empresaId, t.periodo)],
);
