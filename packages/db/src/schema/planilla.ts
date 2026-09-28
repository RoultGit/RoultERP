/**
 * Planillas y recursos humanos.
 *
 * La decisión que ordena estas tablas: **la gratificación, la CTS y la
 * liquidación de beneficios sociales son planillas, no tablas aparte**. Las
 * cuatro hacen lo mismo —reunir trabajadores, calcular conceptos, dejar un
 * asiento y un pago— y separarlas habría duplicado cabecera, detalle, cierre,
 * extorno y pantallas por cuatro. Lo único que cambia es el `tipo` y qué
 * conceptos se calculan.
 */
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditoria, empresaId, fecha, id, importe, importeCero } from "./comun.ts";
import { empresas } from "./identidad.ts";
import { centrosCosto } from "./maestros.ts";

export const trabajadores = pgTable(
  "trabajadores",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    /** Catálogo 06 de SUNAT: 1 DNI, 4 carné de extranjería, 7 pasaporte. */
    tipoDocumento: text("tipo_documento").notNull().default("1"),
    numeroDocumento: text("numero_documento").notNull(),
    apellidoPaterno: text("apellido_paterno").notNull(),
    apellidoMaterno: text("apellido_materno"),
    nombres: text("nombres").notNull(),
    fechaNacimiento: fecha("fecha_nacimiento"),
    sexo: text("sexo"),
    nacionalidad: text("nacionalidad").notNull().default("PE"),
    email: text("email"),
    telefono: text("telefono"),
    direccion: text("direccion"),
    /** "activo" o "cesado". Un cesado no entra en la planilla del mes. */
    situacion: text("situacion").notNull().default("activo"),
    fechaIngreso: fecha("fecha_ingreso").notNull(),
    fechaCese: fecha("fecha_cese"),
    motivoCese: text("motivo_cese"),
    cargo: text("cargo"),
    area: text("area"),
    centroCostoId: uuid("centro_costo_id").references(() => centrosCosto.id),
    /** "onp", "afp" o "ninguno". */
    regimenPension: text("regimen_pension").notNull().default("onp"),
    afpCodigo: text("afp_codigo"),
    /** "flujo" o "mixta". Con mixta no hay comisión sobre la remuneración. */
    afpComision: text("afp_comision"),
    /** Código único del afiliado al SPP. Va en la PLAME. */
    cuspp: text("cuspp"),
    /** Hijos menores de 18, o hasta 24 estudiando: da asignación familiar. */
    tieneHijos: boolean("tiene_hijos").notNull().default(false),
    afiliadoEps: boolean("afiliado_eps").notNull().default(false),
    cci: text("cci"),
    banco: text("banco"),
    /** El depósito de CTS va a otra cuenta y a veces a otro banco. */
    ctsBanco: text("cts_banco"),
    ctsCuenta: text("cts_cuenta"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("trabajadores_uk").on(t.empresaId, t.tipoDocumento, t.numeroDocumento),
    index("trabajadores_situacion_ix").on(t.empresaId, t.situacion),
  ],
);

/**
 * Contratos. Separados del trabajador porque tienen historia y porque un plazo
 * fijo que vence sin renovar convierte la relación en indeterminada por ley:
 * es el aviso que pidió el cliente.
 */
export const contratos = pgTable(
  "contratos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    trabajadorId: uuid("trabajador_id")
      .notNull()
      .references(() => trabajadores.id, { onDelete: "cascade" }),
    /** indeterminado, plazo_fijo, parcial o practicas. */
    tipo: text("tipo").notNull(),
    modalidad: text("modalidad"),
    fechaInicio: fecha("fecha_inicio").notNull(),
    /** NULL en el indeterminado. Es la fecha que dispara el aviso. */
    fechaFin: fecha("fecha_fin"),
    cargo: text("cargo"),
    /** Menos de 24 horas semanales es jornada parcial y cambia los beneficios. */
    jornadaHoras: importe("jornada_horas"),
    /** vigente, renovado, vencido o terminado. */
    estado: text("estado").notNull().default("vigente"),
    renuevaA: uuid("renueva_a"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [
    index("contratos_trabajador_ix").on(t.trabajadorId, t.fechaInicio),
    index("contratos_vencimiento_ix").on(t.empresaId, t.fechaFin),
  ],
);

/**
 * Historial de remuneraciones.
 *
 * Una fila por cambio, con su fecha; el sueldo vigente es la más reciente que no
 * sea posterior. **No se guarda el importe anterior**: es el de la fila de
 * antes, y guardarlo dejaría que las dos cifras se contradijeran.
 */
export const remuneraciones = pgTable(
  "remuneraciones",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    trabajadorId: uuid("trabajador_id")
      .notNull()
      .references(() => trabajadores.id, { onDelete: "cascade" }),
    vigenteDesde: fecha("vigente_desde").notNull(),
    basico: importe("basico").notNull(),
    motivo: text("motivo"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("remuneraciones_uk").on(t.trabajadorId, t.vigenteDesde)],
);

/** Sólo los conceptos que la empresa cambió o añadió sobre el catálogo base. */
export const conceptosPlanilla = pgTable(
  "conceptos_planilla",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    tipo: text("tipo").notNull(),
    calculo: text("calculo").notNull(),
    remunerativo: boolean("remunerativo").notNull().default(false),
    afectaQuinta: boolean("afecta_quinta").notNull().default(false),
    computableCts: boolean("computable_cts").notNull().default(false),
    tasa: importe("tasa"),
    regla: text("regla"),
    cuenta: text("cuenta"),
    orden: integer("orden").notNull().default(500),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("conceptos_planilla_uk").on(t.empresaId, t.codigo)],
);

export const trabajadorConceptos = pgTable(
  "trabajador_conceptos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    trabajadorId: uuid("trabajador_id")
      .notNull()
      .references(() => trabajadores.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    importe: importe("importe").notNull(),
    vigenteDesde: fecha("vigente_desde").notNull(),
    vigenteHasta: fecha("vigente_hasta"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [index("trabajador_conceptos_ix").on(t.trabajadorId, t.codigo)],
);

/** Excepciones de la empresa a los valores de la ley, con su vigencia. */
export const parametrosLaborales = pgTable(
  "parametros_laborales",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    clave: text("clave").notNull(),
    vigenteDesde: fecha("vigente_desde").notNull(),
    valor: importe("valor").notNull(),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("parametros_laborales_uk").on(t.empresaId, t.clave, t.vigenteDesde)],
);

export const planillasSueldos = pgTable(
  "planillas_sueldos",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    /** mensual, gratificacion, cts o liquidacion. */
    tipo: text("tipo").notNull().default("mensual"),
    /** AAAAMM. Decide los parámetros vigentes y el periodo contable. */
    periodo: text("periodo").notNull(),
    /** 1 adelanto de quincena, 2 cierre del mes. NULL fuera de las mensuales. */
    quincena: integer("quincena"),
    fecha: fecha("fecha").notNull(),
    fechaPago: fecha("fecha_pago"),
    /** borrador, cerrada, pagada o anulada. */
    estado: text("estado").notNull().default("borrador"),
    totalIngresos: importeCero("total_ingresos"),
    totalDescuentos: importeCero("total_descuentos"),
    totalAportes: importeCero("total_aportes"),
    totalNeto: importeCero("total_neto"),
    asientoId: uuid("asiento_id"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("planillas_sueldos_uk").on(t.empresaId, t.numero)],
);

export const planillaTrabajadores = pgTable(
  "planilla_trabajadores",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    planillaId: uuid("planilla_id")
      .notNull()
      .references(() => planillasSueldos.id, { onDelete: "cascade" }),
    trabajadorId: uuid("trabajador_id").notNull().references(() => trabajadores.id),
    diasTrabajados: integer("dias_trabajados").notNull().default(30),
    /** Copia del régimen del día: si el trabajador cambia de AFP, la boleta no. */
    regimenPension: text("regimen_pension").notNull(),
    afpCodigo: text("afp_codigo"),
    baseRemunerativa: importeCero("base_remunerativa"),
    totalIngresos: importeCero("total_ingresos"),
    totalDescuentos: importeCero("total_descuentos"),
    totalAportes: importeCero("total_aportes"),
    neto: importeCero("neto"),
    motivoCese: text("motivo_cese"),
    fechaCese: fecha("fecha_cese"),
    observaciones: text("observaciones"),
    ...auditoria(),
  },
  (t) => [uniqueIndex("planilla_trabajadores_uk").on(t.planillaId, t.trabajadorId)],
);

export const planillaLineas = pgTable(
  "planilla_lineas",
  {
    id: id(),
    empresaId: empresaId().references(() => empresas.id, { onDelete: "cascade" }),
    planillaTrabajadorId: uuid("planilla_trabajador_id")
      .notNull()
      .references(() => planillaTrabajadores.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    /** Se copia: renombrar un concepto no debe reescribir boletas antiguas. */
    nombre: text("nombre").notNull(),
    tipo: text("tipo").notNull(),
    importe: importe("importe").notNull(),
    nota: text("nota"),
    orden: integer("orden").notNull().default(0),
    ...auditoria(),
  },
  (t) => [index("planilla_lineas_ix").on(t.planillaTrabajadorId)],
);
