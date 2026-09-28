/**
 * Planillas y recursos humanos.
 *
 * El cálculo vive en `core/planilla` y aquí no se repite ni un céntimo: este
 * módulo lee el maestro, le pasa al dominio lo que necesita y guarda lo que
 * devuelve. Esa separación es la que permite comprobar las fórmulas con una
 * calculadora contra la planilla que SERVIDIMAR lleva hoy —«las mismas fórmulas
 * y criterios», que fue lo que pidió— sin levantar una base de datos.
 *
 * Tres decisiones estructurales:
 *
 * **Gratificación, CTS y liquidación son planillas.** Cambia el `tipo` y qué
 * conceptos se calculan; la cabecera, el detalle, el cierre, el asiento y el
 * extorno son los mismos. Cuatro módulos paralelos habrían sido cuatro sitios
 * donde arreglar el mismo error.
 *
 * **Una boleta cerrada no se recalcula.** El borrador se rehace cuantas veces
 * haga falta; cerrada, se extorna y se vuelve a hacer. Recalcular una boleta
 * que el trabajador ya firmó cambiaría el pasado sin dejar rastro.
 *
 * **Lo que se guarda es el resultado, no la fórmula.** La línea de la boleta
 * lleva su nombre copiado y su importe. Renombrar un concepto o cambiar una tasa
 * el año que viene no puede reescribir lo que ya se pagó.
 */
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ErrorDeNegocio, money } from "@roulterp/core";
import {
  CONCEPTOS_BASE, calcularBoleta, parametrosEn, gratificacion, cts, computableCts,
  liquidacionBeneficios, mesesYDias, semestreGratificacion,
  type Concepto, type Parametros, type MotivoCese, type AcumuladoAnual,
} from "@roulterp/core/planilla";
import { schema as s, type Db } from "@roulterp/db";
import { asentar } from "./contabilidad.ts";

const {
  trabajadores, contratos, remuneraciones, conceptosPlanilla, trabajadorConceptos,
  parametrosLaborales, planillasSueldos, planillaTrabajadores, planillaLineas,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export type { MotivoCese, Concepto as ConceptoPlanilla, TasasAfp } from "@roulterp/core/planilla";

export class PlanillaSueldosInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "PlanillaSueldosInvalida");
  }
}

export class TrabajadorInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "TrabajadorInvalido");
  }
}

const primerDia = (periodo: string) => `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-01`;

// ─── Parámetros y catálogo ────────────────────────────────────────────────

/** Las claves que la empresa puede sobreescribir, con el nombre que usa el dominio. */
const CLAVES: Record<string, keyof Omit<Parametros, "afp">> = {
  rmv: "rmv",
  uit: "uit",
  tasa_onp: "tasaOnp",
  tasa_essalud: "tasaEsSalud",
  tasa_asignacion_familiar: "tasaAsignacionFamiliar",
  tasa_bonificacion_gratificacion: "tasaBonificacionGratificacion",
  tasa_senati: "tasaSenati",
  remuneracion_maxima_asegurable: "remuneracionMaximaAsegurable",
};

/**
 * Los parámetros que regían en una fecha para esta empresa.
 *
 * De la tabla sale **el más reciente que no sea posterior a la fecha**, no el
 * último cargado. Es lo que hace que reabrir diciembre en marzo dé las mismas
 * cifras que dio en diciembre: con el último, subir la UIT en enero cambiaría
 * una quinta ya declarada y nadie sabría por qué.
 */
export async function parametrosDeEmpresa(
  db: Db,
  _empresaId: string,
  fecha: string,
): Promise<Parametros> {
  const filas = await db
    .select()
    .from(parametrosLaborales)
    .where(lte(parametrosLaborales.vigenteDesde, fecha))
    .orderBy(asc(parametrosLaborales.vigenteDesde));

  const propios: Record<string, string> = {};
  for (const f of filas) {
    const clave = CLAVES[f.clave];
    if (clave) propios[clave] = f.valor;
  }
  return parametrosEn(fecha, propios);
}

export async function guardarParametroLaboral(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { clave: string; vigenteDesde: string; valor: string; observaciones?: string },
): Promise<void> {
  if (!CLAVES[datos.clave]) {
    throw new PlanillaSueldosInvalida([
      `«${datos.clave}» no es un parámetro laboral conocido`,
    ]);
  }
  if (!money.gt(dec(datos.valor), money.ZERO)) {
    throw new PlanillaSueldosInvalida(["el valor debe ser positivo"]);
  }
  await db
    .insert(parametrosLaborales)
    .values({ empresaId, creadoPor: usuarioId, ...datos, observaciones: datos.observaciones ?? null })
    .onConflictDoUpdate({
      target: [parametrosLaborales.empresaId, parametrosLaborales.clave, parametrosLaborales.vigenteDesde],
      set: { valor: datos.valor, observaciones: datos.observaciones ?? null, actualizadoEn: new Date() },
    });
}

export async function listarParametrosLaborales(db: Db) {
  return db
    .select()
    .from(parametrosLaborales)
    .orderBy(asc(parametrosLaborales.clave), desc(parametrosLaborales.vigenteDesde));
}

/**
 * El catálogo efectivo: el del programa, con lo que la empresa cambió encima.
 *
 * Mismo trato que el plan de cuentas y las cuentas de integración: la tabla
 * guarda sólo las excepciones, así que una empresa creada hoy y una de hace un
 * año se comportan igual sin sembrar nada, y añadir un concepto al catálogo base
 * llega a todas sin migración.
 */
export async function catalogoConceptos(db: Db): Promise<Concepto[]> {
  const propios = await db.select().from(conceptosPlanilla);
  const porCodigo = new Map<string, Concepto>(CONCEPTOS_BASE.map((c) => [c.codigo, { ...c }]));

  for (const p of propios) {
    if (!p.activo) {
      porCodigo.delete(p.codigo);
      continue;
    }
    porCodigo.set(p.codigo, {
      codigo: p.codigo,
      nombre: p.nombre,
      tipo: p.tipo as Concepto["tipo"],
      calculo: p.calculo as Concepto["calculo"],
      remunerativo: p.remunerativo,
      afectaQuinta: p.afectaQuinta,
      computableCts: p.computableCts,
      ...(p.tasa ? { tasa: p.tasa } : {}),
      ...(p.regla ? { regla: p.regla as NonNullable<Concepto["regla"]> } : {}),
      ...(p.cuenta ? { cuenta: p.cuenta } : {}),
      orden: p.orden,
    } as Concepto);
  }
  return [...porCodigo.values()].sort((a, b) => a.orden - b.orden);
}

export async function guardarConcepto(
  db: Db,
  empresaId: string,
  usuarioId: string,
  c: Omit<Concepto, "orden"> & { orden?: number; activo?: boolean },
): Promise<void> {
  const motivos: string[] = [];
  if (!/^[A-Z0-9_]{2,20}$/.test(c.codigo)) {
    motivos.push("el código lleva mayúsculas, números y guiones bajos");
  }
  if (!c.nombre?.trim()) motivos.push("el concepto necesita un nombre");
  if (c.calculo === "porcentaje" && !c.tasa) motivos.push("un concepto por porcentaje necesita su tasa");
  if (c.calculo === "legal" && !c.regla) motivos.push("un concepto legal necesita saber qué regla aplica");
  // Un aporte del empleador que se marca remunerativo entraría en la base de
  // pensiones y en la CTS del trabajador: no es su remuneración, es un costo.
  if (c.tipo === "aporte" && c.remunerativo) {
    motivos.push("un aporte del empleador no es remuneración del trabajador");
  }
  if (motivos.length) throw new PlanillaSueldosInvalida(motivos);

  const base = CONCEPTOS_BASE.find((x) => x.codigo === c.codigo);
  const valores = {
    nombre: c.nombre.trim(),
    tipo: c.tipo,
    calculo: c.calculo,
    remunerativo: c.remunerativo,
    afectaQuinta: c.afectaQuinta,
    computableCts: c.computableCts,
    tasa: c.tasa ?? null,
    regla: c.regla ?? null,
    cuenta: c.cuenta ?? null,
    orden: c.orden ?? base?.orden ?? 500,
    activo: c.activo ?? true,
  };
  await db
    .insert(conceptosPlanilla)
    .values({ empresaId, codigo: c.codigo, creadoPor: usuarioId, ...valores })
    .onConflictDoUpdate({
      target: [conceptosPlanilla.empresaId, conceptosPlanilla.codigo],
      set: { ...valores, actualizadoEn: new Date() },
    });
}

// ─── Trabajadores ─────────────────────────────────────────────────────────

export type DatosTrabajador = {
  tipoDocumento?: string;
  numeroDocumento: string;
  apellidoPaterno: string;
  apellidoMaterno?: string;
  nombres: string;
  fechaNacimiento?: string;
  sexo?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  fechaIngreso: string;
  cargo?: string;
  area?: string;
  centroCostoId?: string;
  regimenPension?: "onp" | "afp" | "ninguno";
  afpCodigo?: string;
  afpComision?: "flujo" | "mixta";
  cuspp?: string;
  tieneHijos?: boolean;
  afiliadoEps?: boolean;
  cci?: string;
  banco?: string;
  ctsBanco?: string;
  ctsCuenta?: string;
  observaciones?: string;
  /** Sueldo inicial. Abre el historial de remuneraciones. */
  basico?: string;
};

const DNI = /^\d{8}$/;

export async function guardarTrabajador(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosTrabajador,
  trabajadorId?: string,
): Promise<string> {
  const motivos: string[] = [];
  const tipo = datos.tipoDocumento ?? "1";
  if (!datos.numeroDocumento?.trim()) motivos.push("indique el documento de identidad");
  // El DNI viaja a la PLAME y a la AFP; uno de siete dígitos lo rebotan las dos
  // y el error aparece el día de la declaración, no hoy.
  else if (tipo === "1" && !DNI.test(datos.numeroDocumento.trim())) {
    motivos.push("el DNI son ocho dígitos");
  }
  if (!datos.apellidoPaterno?.trim()) motivos.push("indique el apellido paterno");
  if (!datos.nombres?.trim()) motivos.push("indique los nombres");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaIngreso ?? "")) {
    motivos.push("la fecha de ingreso es inválida");
  }
  const regimen = datos.regimenPension ?? "onp";
  if (regimen === "afp" && !datos.afpCodigo) {
    // Sin AFP no se puede descontar, y dejarlo pasar daría un neto mayor que el
    // real que después habría que reclamarle al trabajador.
    motivos.push("un trabajador en AFP necesita saber en cuál está");
  }
  if (datos.basico !== undefined && !money.gt(dec(datos.basico), money.ZERO)) {
    motivos.push("la remuneración básica debe ser positiva");
  }
  if (motivos.length) throw new TrabajadorInvalido(motivos);

  const valores = {
    tipoDocumento: tipo,
    numeroDocumento: datos.numeroDocumento.trim(),
    apellidoPaterno: datos.apellidoPaterno.trim().toUpperCase(),
    apellidoMaterno: datos.apellidoMaterno?.trim().toUpperCase() || null,
    nombres: datos.nombres.trim().toUpperCase(),
    fechaNacimiento: datos.fechaNacimiento || null,
    sexo: datos.sexo || null,
    email: datos.email?.trim().toLowerCase() || null,
    telefono: datos.telefono?.trim() || null,
    direccion: datos.direccion?.trim() || null,
    fechaIngreso: datos.fechaIngreso,
    cargo: datos.cargo?.trim() || null,
    area: datos.area?.trim() || null,
    centroCostoId: datos.centroCostoId || null,
    regimenPension: regimen,
    afpCodigo: regimen === "afp" ? (datos.afpCodigo ?? null) : null,
    afpComision: regimen === "afp" ? (datos.afpComision ?? "flujo") : null,
    cuspp: datos.cuspp?.trim() || null,
    tieneHijos: datos.tieneHijos ?? false,
    afiliadoEps: datos.afiliadoEps ?? false,
    cci: datos.cci?.trim() || null,
    banco: datos.banco?.trim() || null,
    ctsBanco: datos.ctsBanco?.trim() || null,
    ctsCuenta: datos.ctsCuenta?.trim() || null,
    observaciones: datos.observaciones?.trim() || null,
  };

  let id = trabajadorId;
  if (id) {
    await db.update(trabajadores).set({ ...valores, actualizadoEn: new Date() })
      .where(eq(trabajadores.id, id));
  } else {
    const [fila] = await db
      .insert(trabajadores)
      .values({ empresaId, creadoPor: usuarioId, ...valores })
      .returning({ id: trabajadores.id });
    id = fila!.id;
  }

  // El sueldo inicial abre el historial. Se guarda con la fecha de ingreso, no
  // con la de hoy: si no, un alta hecha en marzo dejaría enero y febrero sin
  // sueldo vigente y la planilla de esos meses saldría en cero.
  if (datos.basico !== undefined) {
    await guardarRemuneracion(db, empresaId, usuarioId, {
      trabajadorId: id,
      vigenteDesde: datos.fechaIngreso,
      basico: datos.basico,
      motivo: "Remuneración de ingreso",
    });
  }
  return id;
}

export async function listarTrabajadores(db: Db, filtro?: { situacion?: string }) {
  const cond = filtro?.situacion ? eq(trabajadores.situacion, filtro.situacion) : undefined;
  const filas = await db
    .select()
    .from(trabajadores)
    .where(cond)
    .orderBy(asc(trabajadores.apellidoPaterno), asc(trabajadores.nombres));

  if (filas.length === 0) return [];
  // El sueldo vigente de cada uno, en una sola consulta. Preguntarlo por
  // trabajador serían cuarenta idas a la base para una lista de cuarenta.
  const sueldos = (await db.execute(sql`
    SELECT DISTINCT ON (trabajador_id) trabajador_id::text AS id, basico::text, vigente_desde::text
      FROM remuneraciones
     WHERE trabajador_id IN ${sql.raw(`(${filas.map((f) => `'${f.id}'`).join(",")})`)}
       AND vigente_desde <= current_date
     ORDER BY trabajador_id, vigente_desde DESC`)) as unknown as {
    id: string; basico: string; vigente_desde: string;
  }[];
  const porId = new Map(sueldos.map((x) => [x.id, x]));

  return filas.map((f) => ({
    ...f,
    basico: porId.get(f.id)?.basico ?? null,
    sueldoDesde: porId.get(f.id)?.vigente_desde ?? null,
  }));
}

export async function cargarTrabajador(db: Db, trabajadorId: string) {
  const [t] = await db.select().from(trabajadores).where(eq(trabajadores.id, trabajadorId)).limit(1);
  if (!t) throw new TrabajadorInvalido(["el trabajador no existe en esta empresa"]);

  return {
    trabajador: t,
    remuneraciones: await historialRemuneraciones(db, trabajadorId),
    contratos: await db
      .select()
      .from(contratos)
      .where(eq(contratos.trabajadorId, trabajadorId))
      .orderBy(desc(contratos.fechaInicio)),
    conceptos: await db
      .select()
      .from(trabajadorConceptos)
      .where(eq(trabajadorConceptos.trabajadorId, trabajadorId))
      .orderBy(desc(trabajadorConceptos.vigenteDesde)),
  };
}

// ─── Historial de remuneraciones ──────────────────────────────────────────

export type CambioRemuneracion = {
  id: string;
  vigenteDesde: string;
  basico: string;
  /** El sueldo de la fila anterior. Se deriva; no se guarda por duplicado. */
  anterior: string | null;
  variacion: string | null;
  variacionPorcentaje: string | null;
  motivo: string | null;
};

/**
 * La evolución salarial de un trabajador, de la más reciente a la más antigua.
 *
 * El importe anterior y la variación se **derivan** de la fila de al lado en vez
 * de guardarse. Guardarlos permitiría que las dos cifras se contradijeran —basta
 * con corregir una fecha— y entonces habría que decidir cuál creer.
 */
export async function historialRemuneraciones(
  db: Db,
  trabajadorId: string,
): Promise<CambioRemuneracion[]> {
  const filas = await db
    .select()
    .from(remuneraciones)
    .where(eq(remuneraciones.trabajadorId, trabajadorId))
    .orderBy(desc(remuneraciones.vigenteDesde));

  return filas.map((f, i) => {
    const previa = filas[i + 1];
    const actual = dec(f.basico);
    const anterior = previa ? dec(previa.basico) : null;
    const variacion = anterior ? money.sub(actual, anterior) : null;
    return {
      id: f.id,
      vigenteDesde: f.vigenteDesde,
      basico: txt2(actual),
      anterior: anterior ? txt2(anterior) : null,
      variacion: variacion ? txt2(variacion) : null,
      variacionPorcentaje:
        anterior && !money.isZero(anterior)
          ? txt2(money.mul(money.div(variacion!, anterior), money.dec("100")))
          : null,
      motivo: f.motivo,
    };
  });
}

export async function guardarRemuneracion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    trabajadorId: string;
    vigenteDesde: string;
    basico: string;
    motivo?: string;
    observaciones?: string;
  },
): Promise<void> {
  const motivos: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.vigenteDesde)) motivos.push("la fecha de vigencia es inválida");
  if (!money.gt(dec(datos.basico), money.ZERO)) motivos.push("la remuneración debe ser positiva");
  if (motivos.length) throw new PlanillaSueldosInvalida(motivos);

  const [t] = await db
    .select({ ingreso: trabajadores.fechaIngreso })
    .from(trabajadores)
    .where(eq(trabajadores.id, datos.trabajadorId))
    .limit(1);
  if (!t) throw new TrabajadorInvalido(["el trabajador no existe en esta empresa"]);
  if (datos.vigenteDesde < t.ingreso) {
    motivos.push("la vigencia no puede ser anterior a la fecha de ingreso");
  }
  if (motivos.length) throw new PlanillaSueldosInvalida(motivos);

  await db
    .insert(remuneraciones)
    .values({
      empresaId,
      trabajadorId: datos.trabajadorId,
      vigenteDesde: datos.vigenteDesde,
      basico: datos.basico,
      motivo: datos.motivo?.trim() || null,
      observaciones: datos.observaciones?.trim() || null,
      creadoPor: usuarioId,
    })
    .onConflictDoUpdate({
      target: [remuneraciones.trabajadorId, remuneraciones.vigenteDesde],
      set: {
        basico: datos.basico,
        motivo: datos.motivo?.trim() || null,
        actualizadoEn: new Date(),
      },
    });
}

/** El sueldo que regía en una fecha. El más reciente que no sea posterior. */
export async function basicoEn(
  db: Db,
  trabajadorId: string,
  fecha: string,
): Promise<string | null> {
  const [f] = await db
    .select({ basico: remuneraciones.basico })
    .from(remuneraciones)
    .where(and(eq(remuneraciones.trabajadorId, trabajadorId), lte(remuneraciones.vigenteDesde, fecha)))
    .orderBy(desc(remuneraciones.vigenteDesde))
    .limit(1);
  return f?.basico ?? null;
}

// ─── Contratos y sus vencimientos ─────────────────────────────────────────

export async function guardarContrato(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    trabajadorId: string;
    tipo: string;
    modalidad?: string;
    fechaInicio: string;
    fechaFin?: string;
    cargo?: string;
    jornadaHoras?: string;
    observaciones?: string;
  },
  contratoId?: string,
): Promise<string> {
  const motivos: string[] = [];
  if (!["indeterminado", "plazo_fijo", "parcial", "practicas"].includes(datos.tipo)) {
    motivos.push("el tipo de contrato no es válido");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaInicio)) motivos.push("la fecha de inicio es inválida");
  // Un plazo fijo sin fecha de fin es un indeterminado disfrazado, y esa es
  // justamente la confusión que acaba en juicio.
  if (datos.tipo !== "indeterminado" && !datos.fechaFin) {
    motivos.push("un contrato que no es indeterminado necesita fecha de fin");
  }
  if (datos.fechaFin && datos.fechaFin < datos.fechaInicio) {
    motivos.push("el contrato no puede terminar antes de empezar");
  }
  if (motivos.length) throw new PlanillaSueldosInvalida(motivos);

  const valores = {
    tipo: datos.tipo,
    modalidad: datos.modalidad?.trim() || null,
    fechaInicio: datos.fechaInicio,
    fechaFin: datos.tipo === "indeterminado" ? null : (datos.fechaFin ?? null),
    cargo: datos.cargo?.trim() || null,
    jornadaHoras: datos.jornadaHoras ?? null,
    observaciones: datos.observaciones?.trim() || null,
  };

  if (contratoId) {
    await db.update(contratos).set({ ...valores, actualizadoEn: new Date() })
      .where(eq(contratos.id, contratoId));
    return contratoId;
  }
  const [fila] = await db
    .insert(contratos)
    .values({ empresaId, trabajadorId: datos.trabajadorId, creadoPor: usuarioId, ...valores })
    .returning({ id: contratos.id });
  return fila!.id;
}

export type ContratoPorVencer = {
  contratoId: string;
  trabajadorId: string;
  trabajador: string;
  documento: string;
  cargo: string | null;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  /** Negativo si ya venció. Es la cifra que ordena la lista. */
  diasParaVencer: number;
  /** Ya pasó la fecha y nadie renovó ni terminó la relación. */
  vencido: boolean;
};

/**
 * Contratos que vencen dentro de `dias`, y los que ya vencieron.
 *
 * Los vencidos van primero y no se esconden nunca. Un plazo fijo que expiró sin
 * renovar convierte la relación en indeterminada por ley: la empresa se entera
 * cuando el trabajador lo reclama, y para entonces ya no hay nada que decidir.
 * Por eso la lista no es «lo que vence pronto» sino «lo que ya se pasó **y** lo
 * que va a pasarse».
 */
export async function contratosPorVencer(
  db: Db,
  dias = 60,
  hoy = new Date(),
): Promise<ContratoPorVencer[]> {
  const ref = hoy.toISOString().slice(0, 10);
  const filas = (await db.execute(sql`
    SELECT c.id::text AS contrato_id, t.id::text AS trabajador_id,
           t.apellido_paterno || ' ' || coalesce(t.apellido_materno, '') || ', ' || t.nombres
             AS trabajador,
           t.numero_documento AS documento, coalesce(c.cargo, t.cargo) AS cargo,
           c.tipo, c.fecha_inicio::text, c.fecha_fin::text,
           (c.fecha_fin - ${ref}::date)::int AS dias
      FROM contratos c
      JOIN trabajadores t ON t.id = c.trabajador_id
     WHERE c.estado = 'vigente'
       AND c.fecha_fin IS NOT NULL
       AND t.situacion = 'activo'
       AND c.fecha_fin <= ${ref}::date + ${dias}::int
     ORDER BY c.fecha_fin ASC`)) as unknown as {
    contrato_id: string; trabajador_id: string; trabajador: string; documento: string;
    cargo: string | null; tipo: string; fecha_inicio: string; fecha_fin: string; dias: number;
  }[];

  return filas.map((f) => ({
    contratoId: f.contrato_id,
    trabajadorId: f.trabajador_id,
    trabajador: f.trabajador.replace(/\s+,/, ","),
    documento: f.documento,
    cargo: f.cargo,
    tipo: f.tipo,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    diasParaVencer: f.dias,
    vencido: f.dias < 0,
  }));
}

/** Renueva un contrato: cierra el anterior y encadena el nuevo. */
export async function renovarContrato(
  db: Db,
  empresaId: string,
  usuarioId: string,
  contratoId: string,
  datos: { fechaInicio: string; fechaFin: string; cargo?: string; observaciones?: string },
): Promise<string> {
  const [anterior] = await db.select().from(contratos).where(eq(contratos.id, contratoId)).limit(1);
  if (!anterior) throw new PlanillaSueldosInvalida(["el contrato no existe en esta empresa"]);
  if (anterior.estado !== "vigente") {
    throw new PlanillaSueldosInvalida(["sólo se renueva un contrato vigente"]);
  }
  // Un hueco entre el fin del anterior y el inicio del nuevo es una relación
  // interrumpida, y romper la continuidad cambia el cómputo de los beneficios.
  if (anterior.fechaFin && datos.fechaInicio > sumarDias(anterior.fechaFin, 1)) {
    throw new PlanillaSueldosInvalida([
      `el contrato anterior termina el ${anterior.fechaFin}: la renovación deja un vacío`,
    ]);
  }

  const nuevo = await guardarContrato(db, empresaId, usuarioId, {
    trabajadorId: anterior.trabajadorId,
    tipo: anterior.tipo,
    ...(anterior.modalidad ? { modalidad: anterior.modalidad } : {}),
    fechaInicio: datos.fechaInicio,
    fechaFin: datos.fechaFin,
    ...(datos.cargo ?? anterior.cargo ? { cargo: datos.cargo ?? anterior.cargo! } : {}),
    ...(anterior.jornadaHoras ? { jornadaHoras: anterior.jornadaHoras } : {}),
    ...(datos.observaciones ? { observaciones: datos.observaciones } : {}),
  });
  await db
    .update(contratos)
    .set({ estado: "renovado", renuevaA: nuevo, actualizadoEn: new Date() })
    .where(eq(contratos.id, contratoId));
  return nuevo;
}

function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Planillas ────────────────────────────────────────────────────────────

export type TipoPlanilla = "mensual" | "gratificacion" | "cts" | "liquidacion";

export type DatosPlanillaSueldos = {
  numero: string;
  tipo?: TipoPlanilla;
  /** AAAAMM. */
  periodo: string;
  quincena?: 1 | 2;
  fecha: string;
  fechaPago?: string;
  observaciones?: string;
  /** Quiénes entran. Vacío: todos los activos en la fecha. */
  trabajadorIds?: readonly string[];
  /** Días trabajados por trabajador; por omisión, el mes entero. */
  dias?: Readonly<Record<string, number>>;
  /** Importes de los conceptos manuales: `{ trabajadorId: { HEX25: "120" } }`. */
  manuales?: Readonly<Record<string, Record<string, string>>>;
  /** La empresa aporta al SENATI. Sólo actividad industrial. */
  aportaSenati?: boolean;
};

export type PlanillaSueldosCalculada = {
  planillaId: string;
  trabajadores: number;
  totalIngresos: string;
  totalDescuentos: string;
  totalAportes: string;
  totalNeto: string;
  /** Lo que impide cerrar: una AFP sin tasas, un sueldo sin fijar. */
  avisos: readonly string[];
};

/**
 * Calcula la planilla y la guarda como borrador.
 *
 * Si ya existe un borrador del mismo tipo, periodo y quincena, **se rehace**.
 * Es lo que hace que corregir un sueldo y volver a darle a calcular funcione
 * como espera cualquiera. Una planilla cerrada no se toca: se extorna.
 */
export async function calcularPlanillaSueldos(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPlanillaSueldos,
): Promise<PlanillaSueldosCalculada> {
  const tipo = datos.tipo ?? "mensual";
  const motivos: string[] = [];
  if (!/^\d{6}$/.test(datos.periodo)) motivos.push("el periodo debe tener el formato AAAAMM");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) motivos.push("la fecha es inválida");
  if (!datos.numero?.trim()) motivos.push("indique el número de la planilla");
  if (tipo !== "mensual" && datos.quincena) {
    motivos.push("sólo la planilla mensual tiene quincenas");
  }
  if (motivos.length) throw new PlanillaSueldosInvalida(motivos);

  const fechaParametros = primerDia(datos.periodo);
  const p = await parametrosDeEmpresa(db, empresaId, fechaParametros);
  const catalogo = await catalogoConceptos(db);

  const existente = await db
    .select({ id: planillasSueldos.id, estado: planillasSueldos.estado })
    .from(planillasSueldos)
    .where(
      and(
        eq(planillasSueldos.tipo, tipo),
        eq(planillasSueldos.periodo, datos.periodo),
        datos.quincena
          ? eq(planillasSueldos.quincena, datos.quincena)
          : isNull(planillasSueldos.quincena),
      ),
    )
    .limit(1);
  const previa = existente[0];
  if (previa && previa.estado !== "borrador" && previa.estado !== "anulada") {
    throw new PlanillaSueldosInvalida([
      `la planilla de ${datos.periodo} ya está ${previa.estado}; extórnela antes de recalcular`,
    ]);
  }

  // Quiénes entran: los activos a la fecha, o los que se pidieron.
  const candidatos = await db
    .select()
    .from(trabajadores)
    .where(
      datos.trabajadorIds?.length
        ? inArray(trabajadores.id, [...datos.trabajadorIds])
        : and(
            eq(trabajadores.situacion, "activo"),
            lte(trabajadores.fechaIngreso, datos.fecha),
          ),
    )
    .orderBy(asc(trabajadores.apellidoPaterno), asc(trabajadores.nombres));

  if (candidatos.length === 0) {
    throw new PlanillaSueldosInvalida(["no hay trabajadores para esta planilla"]);
  }

  const avisos: string[] = [];
  const boletas: {
    trabajador: (typeof candidatos)[number];
    dias: number;
    lineas: { codigo: string; nombre: string; tipo: string; importe: string; nota?: string; orden: number }[];
    base: Dec;
    ingresos: Dec;
    descuentos: Dec;
    aportes: Dec;
    neto: Dec;
  }[] = [];

  for (const t of candidatos) {
    const basico = await basicoEn(db, t.id, datos.fecha);
    if (!basico) {
      // No se le pone cero: una boleta en cero parece pagada y no lo está.
      avisos.push(`${nombreDe(t)}: no tiene remuneración vigente al ${datos.fecha}`);
      continue;
    }

    const dias = datos.dias?.[t.id] ?? 30;
    const manuales = { ...(datos.manuales?.[t.id] ?? {}) };
    // Los conceptos fijos del trabajador —una bonificación permanente, la cuota
    // de un préstamo— entran como si se hubieran tecleado, y lo tecleado manda.
    for (const c of await conceptosVigentes(db, t.id, datos.fecha)) {
      if (manuales[c.codigo] === undefined) manuales[c.codigo] = c.importe;
    }

    const trabajadorDominio = {
      id: t.id,
      nombre: nombreDe(t),
      basico,
      tieneHijos: t.tieneHijos,
      regimen:
        t.regimenPension === "afp"
          ? ({ sistema: "afp", afp: t.afpCodigo ?? "", comision: (t.afpComision ?? "flujo") as "flujo" | "mixta" } as const)
          : t.regimenPension === "onp"
            ? ({ sistema: "onp" } as const)
            : ({ sistema: "ninguno" } as const),
    };

    if (tipo === "mensual") {
      const acumulado = await acumuladoAnual(db, t.id, datos.periodo);
      const b = calcularBoleta({
        trabajador: trabajadorDominio,
        periodo: {
          periodo: datos.periodo,
          fecha: datos.fecha,
          diasTrabajados: dias,
          ...(datos.quincena ? { quincena: datos.quincena } : {}),
          ...(datos.quincena === 2
            ? { adelantoQuincena: await netoDeQuincena(db, datos.periodo, t.id) }
            : {}),
        },
        conceptos: catalogo,
        manuales,
        parametros: p,
        acumulado,
        ...(datos.aportaSenati ? { aportaSenati: true } : {}),
      });
      avisos.push(...b.avisos);
      boletas.push({
        trabajador: t,
        dias,
        lineas: b.lineas.map((l, i) => ({ ...l, orden: i })),
        base: dec(b.baseRemunerativa),
        ingresos: dec(b.totalIngresos),
        descuentos: dec(b.totalDescuentos),
        aportes: dec(b.totalAportes),
        neto: dec(b.neto),
      });
    } else {
      const extra = await beneficioDelPeriodo(db, t, basico, tipo, datos, p);
      boletas.push(extra);
    }
  }

  if (boletas.length === 0) {
    throw new PlanillaSueldosInvalida([
      "ningún trabajador quedó en la planilla: " + (avisos[0] ?? "revise los datos"),
    ]);
  }

  // ── Guardar ──────────────────────────────────────────────────────────
  const totales = boletas.reduce(
    (a, b) => ({
      ingresos: money.add(a.ingresos, b.ingresos),
      descuentos: money.add(a.descuentos, b.descuentos),
      aportes: money.add(a.aportes, b.aportes),
      neto: money.add(a.neto, b.neto),
    }),
    { ingresos: money.ZERO, descuentos: money.ZERO, aportes: money.ZERO, neto: money.ZERO },
  );

  let planillaId = previa?.id;
  const cabecera = {
    numero: datos.numero.trim(),
    tipo,
    periodo: datos.periodo,
    quincena: datos.quincena ?? null,
    fecha: datos.fecha,
    fechaPago: datos.fechaPago ?? null,
    estado: "borrador",
    totalIngresos: txt2(totales.ingresos),
    totalDescuentos: txt2(totales.descuentos),
    totalAportes: txt2(totales.aportes),
    totalNeto: txt2(totales.neto),
    observaciones: datos.observaciones?.trim() || null,
  };

  if (planillaId) {
    // Rehacer, no acumular: las líneas viejas se van con el detalle en cascada.
    await db.delete(planillaTrabajadores).where(eq(planillaTrabajadores.planillaId, planillaId));
    await db.update(planillasSueldos).set({ ...cabecera, actualizadoEn: new Date() })
      .where(eq(planillasSueldos.id, planillaId));
  } else {
    const [fila] = await db
      .insert(planillasSueldos)
      .values({ empresaId, creadoPor: usuarioId, ...cabecera })
      .returning({ id: planillasSueldos.id });
    planillaId = fila!.id;
  }

  for (const b of boletas) {
    const [pt] = await db
      .insert(planillaTrabajadores)
      .values({
        empresaId,
        planillaId,
        trabajadorId: b.trabajador.id,
        diasTrabajados: b.dias,
        regimenPension: b.trabajador.regimenPension,
        afpCodigo: b.trabajador.afpCodigo,
        baseRemunerativa: txt2(b.base),
        totalIngresos: txt2(b.ingresos),
        totalDescuentos: txt2(b.descuentos),
        totalAportes: txt2(b.aportes),
        neto: txt2(b.neto),
        creadoPor: usuarioId,
      })
      .returning({ id: planillaTrabajadores.id });

    if (b.lineas.length) {
      await db.insert(planillaLineas).values(
        b.lineas.map((l) => ({
          empresaId,
          planillaTrabajadorId: pt!.id,
          codigo: l.codigo,
          nombre: l.nombre,
          tipo: l.tipo,
          importe: l.importe,
          nota: l.nota ?? null,
          orden: l.orden,
          creadoPor: usuarioId,
        })),
      );
    }
  }

  return {
    planillaId,
    trabajadores: boletas.length,
    totalIngresos: txt2(totales.ingresos),
    totalDescuentos: txt2(totales.descuentos),
    totalAportes: txt2(totales.aportes),
    totalNeto: txt2(totales.neto),
    avisos,
  };
}

const nombreDe = (t: { apellidoPaterno: string; apellidoMaterno: string | null; nombres: string }) =>
  `${t.apellidoPaterno} ${t.apellidoMaterno ?? ""}`.trim() + `, ${t.nombres}`;

/** Los conceptos fijos del trabajador que estaban vigentes en la fecha. */
async function conceptosVigentes(db: Db, trabajadorId: string, fecha: string) {
  return db
    .select({ codigo: trabajadorConceptos.codigo, importe: trabajadorConceptos.importe })
    .from(trabajadorConceptos)
    .where(
      and(
        eq(trabajadorConceptos.trabajadorId, trabajadorId),
        lte(trabajadorConceptos.vigenteDesde, fecha),
        or(isNull(trabajadorConceptos.vigenteHasta), sql`${trabajadorConceptos.vigenteHasta} >= ${fecha}`),
      ),
    );
}

/**
 * Lo que el trabajador lleva ganado y retenido en el ejercicio.
 *
 * Es lo que la quinta categoría necesita para proyectar. Sale de las planillas
 * **cerradas** del año: incluir los borradores haría que la retención cambiara
 * cada vez que alguien recalcula un mes que todavía no existe.
 */
export async function acumuladoAnual(
  db: Db,
  trabajadorId: string,
  periodo: string,
): Promise<AcumuladoAnual> {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));

  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(pt.base_remunerativa), 0)::text AS renta,
           coalesce(sum(l.importe) FILTER (WHERE l.codigo = 'QUINTA'), 0)::text AS retenido
      FROM planilla_trabajadores pt
      JOIN planillas_sueldos p ON p.id = pt.planilla_id
      LEFT JOIN planilla_lineas l ON l.planilla_trabajador_id = pt.id
     WHERE pt.trabajador_id = ${trabajadorId}
       AND p.periodo LIKE ${anio + "%"}
       AND p.periodo < ${periodo}
       AND p.estado IN ('cerrada', 'pagada')`)) as unknown as [
    { renta: string; retenido: string },
  ];

  return {
    rentaPagada: fila?.renta ?? "0",
    retenido: fila?.retenido ?? "0",
    mesesRestantes: 12 - mes + 1,
    // Julio y diciembre. Cuentan las que aún no se han pagado en el año.
    gratificacionesRestantes: (mes <= 7 ? 1 : 0) + (mes <= 12 ? 1 : 0),
  };
}

/** El neto ya entregado en la primera quincena del mismo periodo. */
async function netoDeQuincena(db: Db, periodo: string, trabajadorId: string): Promise<string> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(pt.neto), 0)::text AS neto
      FROM planilla_trabajadores pt
      JOIN planillas_sueldos p ON p.id = pt.planilla_id
     WHERE pt.trabajador_id = ${trabajadorId}
       AND p.periodo = ${periodo} AND p.quincena = 1
       AND p.estado IN ('cerrada', 'pagada')`)) as unknown as [{ neto: string }];
  return fila?.neto ?? "0";
}

/** Gratificación o CTS de un trabajador, como líneas de boleta. */
async function beneficioDelPeriodo(
  db: Db,
  t: { id: string; apellidoPaterno: string; apellidoMaterno: string | null; nombres: string;
       fechaIngreso: string; tieneHijos: boolean; regimenPension: string; afpCodigo: string | null },
  basico: string,
  tipo: TipoPlanilla,
  datos: DatosPlanillaSueldos,
  p: Parametros,
) {
  const asignacion = t.tieneHijos ? txt2(money.mul(p.rmv, p.tasaAsignacionFamiliar)) : "0.00";
  const remuneracion = money.add(dec(basico), dec(asignacion));
  const lineas: { codigo: string; nombre: string; tipo: string; importe: string; nota?: string; orden: number }[] = [];
  let ingresos = money.ZERO;

  if (tipo === "gratificacion") {
    const anio = Number(datos.periodo.slice(0, 4));
    const mes = Number(datos.periodo.slice(4, 6));
    const semestre = semestreGratificacion(mes <= 7 ? "julio" : "diciembre", anio);
    const desde = t.fechaIngreso > semestre.desde ? t.fechaIngreso : semestre.desde;
    const { meses } = mesesYDias(desde, semestre.hasta);
    const g = gratificacion(txt2(remuneracion), meses, p);

    lineas.push({ codigo: "GRATIFICACION", nombre: `Gratificación (${g.meses}/6)`, tipo: "ingreso", importe: g.gratificacion, orden: 0 });
    lineas.push({ codigo: "BONIF_GRATI", nombre: "Bonificación extraordinaria Ley 30334 (9 %)", tipo: "ingreso", importe: g.bonificacion, orden: 1 });
    ingresos = dec(g.total);
  } else {
    // CTS. La computable lleva un sexto de la última gratificación: sin ella
    // sale un 8 % corta y el trabajador lo nota contra la del año anterior.
    const ultima = await ultimaGratificacion(db, t.id);
    const rc = computableCts(basico, asignacion, ultima);
    const semestre = semestreCts(datos.periodo);
    const desde = t.fechaIngreso > semestre.desde ? t.fechaIngreso : semestre.desde;
    const { meses, dias } = mesesYDias(desde, semestre.hasta);
    const c = cts(rc, meses, dias);

    lineas.push({
      codigo: "CTS",
      nombre: `CTS (${meses} meses y ${dias} días)`,
      tipo: "ingreso",
      importe: c.total,
      nota: `computable ${c.remuneracionComputable}, incluye 1/6 de gratificación`,
      orden: 0,
    });
    ingresos = dec(c.total);
  }

  return {
    trabajador: t as never,
    dias: 30,
    lineas,
    base: money.ZERO,
    ingresos,
    descuentos: money.ZERO,
    aportes: money.ZERO,
    neto: ingresos,
  };
}

/** Los semestres de la CTS cierran en abril y en octubre. */
function semestreCts(periodo: string) {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(4, 6));
  return mes <= 5
    ? { desde: `${anio - 1}-11-01`, hasta: `${anio}-04-30` }
    : { desde: `${anio}-05-01`, hasta: `${anio}-10-31` };
}

async function ultimaGratificacion(db: Db, trabajadorId: string): Promise<string> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(l.importe), 0)::text AS importe
      FROM planilla_lineas l
      JOIN planilla_trabajadores pt ON pt.id = l.planilla_trabajador_id
      JOIN planillas_sueldos p ON p.id = pt.planilla_id
     WHERE pt.trabajador_id = ${trabajadorId}
       AND p.tipo = 'gratificacion' AND p.estado IN ('cerrada', 'pagada')
       AND l.codigo = 'GRATIFICACION'
       AND p.periodo = (SELECT max(p2.periodo) FROM planillas_sueldos p2
                          JOIN planilla_trabajadores pt2 ON pt2.planilla_id = p2.id
                         WHERE pt2.trabajador_id = ${trabajadorId}
                           AND p2.tipo = 'gratificacion'
                           AND p2.estado IN ('cerrada', 'pagada'))`)) as unknown as [
    { importe: string },
  ];
  return fila?.importe ?? "0";
}

// ─── Cierre, asiento y extorno ────────────────────────────────────────────

/**
 * Cuentas del PCGE que usa el asiento de planilla.
 *
 * Se resuelven aquí y no en el catálogo de conceptos porque la contrapartida no
 * pertenece al concepto: el básico va al gasto 6211 y su contrapartida a la 4111
 * sea cual sea el concepto que lo generó.
 */
const CUENTAS = {
  /** Remuneraciones por pagar. Es lo que la empresa le debe al trabajador. */
  porPagar: "4111",
  /** Tributos por pagar: ONP y renta de quinta. */
  onp: "4032",
  quinta: "4017",
  /** AFP por pagar. */
  afp: "4071",
  /** EsSalud por pagar. */
  essalud: "4031",
  /** Otras cuentas por pagar: retenciones judiciales, descuentos varios. */
  otras: "4191",
  /** Cuentas por cobrar al personal: adelantos y préstamos. */
  personal: "1411",
  /** Gasto de personal por naturaleza, cuando el concepto no dice otra cosa. */
  gasto: "6211",
  /** Contribuciones del empleador. */
  gastoAportes: "6271",
} as const;

/**
 * Cierra la planilla y deja su asiento.
 *
 * El asiento es el que enseña cualquier manual y el que cuadra con la PLAME:
 * **al debe** el gasto de personal por naturaleza (clase 62) y las
 * contribuciones del empleador; **al haber** lo que se le debe al trabajador
 * (4111, el neto) y lo que se le debe a terceros por cuenta suya —ONP, AFP,
 * quinta categoría, EsSalud, retenciones—.
 *
 * El neto **no** es lo que se paga aún: el pago sale de caja y bancos y cancela
 * la 4111. Confundirlos deja la planilla contabilizada y el banco sin mover, que
 * es lo que impide conciliar.
 */
export async function cerrarPlanillaSueldos(
  db: Db,
  empresaId: string,
  usuarioId: string,
  planillaId: string,
): Promise<{ asientoId: string }> {
  const [cab] = await db
    .select()
    .from(planillasSueldos)
    .where(eq(planillasSueldos.id, planillaId))
    .limit(1);
  if (!cab) throw new PlanillaSueldosInvalida(["la planilla no existe en esta empresa"]);
  if (cab.estado !== "borrador") {
    throw new PlanillaSueldosInvalida([`la planilla ya está ${cab.estado}`]);
  }

  const detalle = await db
    .select()
    .from(planillaTrabajadores)
    .where(eq(planillaTrabajadores.planillaId, planillaId));
  if (detalle.length === 0) {
    throw new PlanillaSueldosInvalida(["la planilla no tiene trabajadores"]);
  }

  const lineas = await db
    .select()
    .from(planillaLineas)
    .where(inArray(planillaLineas.planillaTrabajadorId, detalle.map((d) => d.id)));

  // Una línea con aviso es una que no se pudo calcular. Cerrar con ella dejaría
  // una boleta firmada por un importe que el sistema sabe que está mal.
  const sinCalcular = lineas.filter((l) => l.nota?.startsWith("sin ") || l.nota?.startsWith("falta "));
  if (sinCalcular.length > 0) {
    throw new PlanillaSueldosInvalida([
      `hay ${sinCalcular.length} conceptos sin calcular; resuélvalos antes de cerrar`,
      ...sinCalcular.slice(0, 3).map((l) => `${l.nombre}: ${l.nota}`),
    ]);
  }

  const catalogo = new Map((await catalogoConceptos(db)).map((c) => [c.codigo, c]));

  /*
   * El gasto se imputa al centro de costo de cada trabajador, no al montón.
   *
   * Sin esto, el resultado por centro de `/contabilidad/centros` dejaría fuera
   * el sueldo, que en una empresa de servicios es la mayor parte del costo, y
   * cada obra parecería mucho más rentable de lo que es. Las cuentas de la clase
   * 62 además lo exigen en el plan.
   */
  const centroPorTrabajador = new Map(
    (
      await db
        .select({ id: trabajadores.id, centro: trabajadores.centroCostoId })
        .from(trabajadores)
        .where(inArray(trabajadores.id, detalle.map((d) => d.trabajadorId)))
    ).map((t) => [t.id, t.centro]),
  );
  const centroPorFila = new Map(
    detalle.map((d) => [d.id, centroPorTrabajador.get(d.trabajadorId) ?? null]),
  );

  // Clave: cuenta y centro de costo. Dos trabajadores de obras distintas no se
  // suman en una sola línea, porque entonces el reparto se perdería.
  const debe = new Map<string, Dec>();
  const haber = new Map<string, Dec>();
  const clave = (cuenta: string, centro: string | null) => `${cuenta}|${centro ?? ""}`;
  const sumar = (m: Map<string, Dec>, cuenta: string, centro: string | null, importe: Dec) =>
    m.set(clave(cuenta, centro), money.add(m.get(clave(cuenta, centro)) ?? money.ZERO, importe));

  for (const l of lineas) {
    const c = catalogo.get(l.codigo);
    const importe = dec(l.importe);
    if (money.isZero(importe)) continue;
    const centro = centroPorFila.get(l.planillaTrabajadorId) ?? null;

    if (l.tipo === "ingreso") {
      sumar(debe, c?.cuenta ?? CUENTAS.gasto, centro, importe);
    } else if (l.tipo === "aporte") {
      // El aporte es gasto de la empresa y deuda con la entidad, a la vez.
      sumar(debe, c?.cuenta ?? CUENTAS.gastoAportes, centro, importe);
      sumar(haber, l.codigo === "ESSALUD" ? CUENTAS.essalud : CUENTAS.otras, null, importe);
    } else {
      // Un descuento no reduce el gasto: lo reparte. El bruto ya está al debe;
      // aquí sólo cambia a quién se le debe.
      sumar(haber, cuentaDescuento(l.codigo, c?.cuenta), null, importe);
    }
  }

  // El neto es lo que queda para el trabajador: bruto menos lo retenido.
  const neto = detalle.reduce((a, d) => money.add(a, dec(d.neto)), money.ZERO);
  if (!money.isZero(neto)) sumar(haber, CUENTAS.porPagar, null, neto);

  const glosa =
    cab.tipo === "mensual"
      ? `Planilla ${cab.periodo}${cab.quincena ? ` · quincena ${cab.quincena}` : ""}`
      : `${cab.tipo === "cts" ? "CTS" : cab.tipo === "gratificacion" ? "Gratificación" : "Liquidación"} ${cab.periodo}`;

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo: cab.periodo,
    fecha: cab.fecha,
    // Subdiario de planillas. Es el que el contador espera ver en el libro diario.
    subdiario: "07",
    glosa,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "planillas",
    origenId: planillaId,
    lineas: [
      ...[...debe].map(([k, importe]) => {
        const [cuenta, centro] = k.split("|");
        return { cuenta: cuenta!, debe: txt2(importe), glosa, ...(centro ? { centroCostoId: centro } : {}) };
      }),
      ...[...haber].map(([k, importe]) => {
        const [cuenta] = k.split("|");
        return { cuenta: cuenta!, haber: txt2(importe), glosa };
      }),
    ],
  });

  await db
    .update(planillasSueldos)
    .set({ estado: "cerrada", asientoId, actualizadoEn: new Date() })
    .where(eq(planillasSueldos.id, planillaId));

  return { asientoId };
}

/** A quién se le debe lo que se le descontó al trabajador. */
function cuentaDescuento(codigo: string, cuentaConcepto?: string): string {
  if (cuentaConcepto) return cuentaConcepto;
  if (codigo === "ONP") return CUENTAS.onp;
  if (codigo.startsWith("AFP")) return CUENTAS.afp;
  if (codigo === "QUINTA") return CUENTAS.quinta;
  if (codigo === "ADELANTO" || codigo === "PRESTAMO") return CUENTAS.personal;
  return CUENTAS.otras;
}

export async function anularPlanillaSueldos(
  db: Db,
  planillaId: string,
  motivo: string,
): Promise<void> {
  const [cab] = await db
    .select()
    .from(planillasSueldos)
    .where(eq(planillasSueldos.id, planillaId))
    .limit(1);
  if (!cab) throw new PlanillaSueldosInvalida(["la planilla no existe en esta empresa"]);
  if (cab.estado === "pagada") {
    // Una planilla pagada ya salió del banco: anularla dejaría el dinero fuera
    // sin nada que lo sustente. Se extorna el asiento y se hace una nueva.
    throw new PlanillaSueldosInvalida([
      "una planilla pagada no se anula; extorne su asiento y registre la corrección",
    ]);
  }
  await db
    .update(planillasSueldos)
    .set({
      estado: "anulada",
      observaciones: [cab.observaciones, `Anulada: ${motivo}`].filter(Boolean).join(" · "),
      actualizadoEn: new Date(),
    })
    .where(eq(planillasSueldos.id, planillaId));
}

// ─── Consultas ────────────────────────────────────────────────────────────

export async function listarPlanillasSueldos(db: Db, filtro?: { tipo?: string; periodo?: string }) {
  const cond = [
    filtro?.tipo ? eq(planillasSueldos.tipo, filtro.tipo) : undefined,
    filtro?.periodo ? eq(planillasSueldos.periodo, filtro.periodo) : undefined,
  ].filter(Boolean);
  return db
    .select()
    .from(planillasSueldos)
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(planillasSueldos.periodo), desc(planillasSueldos.fecha));
}

export async function cargarPlanillaSueldos(db: Db, planillaId: string) {
  const [cabecera] = await db
    .select()
    .from(planillasSueldos)
    .where(eq(planillasSueldos.id, planillaId))
    .limit(1);
  if (!cabecera) throw new PlanillaSueldosInvalida(["la planilla no existe en esta empresa"]);

  const detalle = await db
    .select({
      id: planillaTrabajadores.id,
      trabajadorId: planillaTrabajadores.trabajadorId,
      apellidoPaterno: trabajadores.apellidoPaterno,
      apellidoMaterno: trabajadores.apellidoMaterno,
      nombres: trabajadores.nombres,
      documento: trabajadores.numeroDocumento,
      cargo: trabajadores.cargo,
      diasTrabajados: planillaTrabajadores.diasTrabajados,
      regimenPension: planillaTrabajadores.regimenPension,
      afpCodigo: planillaTrabajadores.afpCodigo,
      baseRemunerativa: planillaTrabajadores.baseRemunerativa,
      totalIngresos: planillaTrabajadores.totalIngresos,
      totalDescuentos: planillaTrabajadores.totalDescuentos,
      totalAportes: planillaTrabajadores.totalAportes,
      neto: planillaTrabajadores.neto,
      motivoCese: planillaTrabajadores.motivoCese,
      fechaCese: planillaTrabajadores.fechaCese,
    })
    .from(planillaTrabajadores)
    .innerJoin(trabajadores, eq(trabajadores.id, planillaTrabajadores.trabajadorId))
    .where(eq(planillaTrabajadores.planillaId, planillaId))
    .orderBy(asc(trabajadores.apellidoPaterno), asc(trabajadores.nombres));

  const lineas = detalle.length
    ? await db
        .select()
        .from(planillaLineas)
        .where(inArray(planillaLineas.planillaTrabajadorId, detalle.map((d) => d.id)))
        .orderBy(asc(planillaLineas.orden))
    : [];

  const porTrabajador = new Map<string, typeof lineas>();
  for (const l of lineas) {
    const lista = porTrabajador.get(l.planillaTrabajadorId) ?? [];
    lista.push(l);
    porTrabajador.set(l.planillaTrabajadorId, lista);
  }

  return {
    cabecera,
    boletas: detalle.map((d) => ({ ...d, lineas: porTrabajador.get(d.id) ?? [] })),
  };
}

// ─── Cese y liquidación de beneficios sociales ────────────────────────────

export type DatosCese = {
  trabajadorId: string;
  fechaCese: string;
  motivo: MotivoCese;
  /** Días del mes del cese efectivamente trabajados, sobre 30. */
  diasDelMes?: number;
  /** Vacaciones ganadas y no gozadas, en días. */
  diasVacacionesPendientes?: number;
  descuentos?: readonly { codigo: string; nombre: string; importe: string }[];
  observaciones?: string;
};

/**
 * Da de baja al trabajador y genera su liquidación de beneficios sociales.
 *
 * Es lo que el cliente pidió: que al cesar a alguien salga sola la liquidación,
 * con los cálculos que el sistema ya tiene. Las dos cosas ocurren en la misma
 * transacción —o se cesa y se liquida, o no pasa nada—, porque un trabajador
 * dado de baja sin liquidación es el que desaparece de la planilla y de la
 * memoria a la vez.
 *
 * Lo que **no** hace: pagar. La liquidación queda contabilizada como deuda con
 * el trabajador; el desembolso sale de caja y bancos, con su cheque o su
 * transferencia, igual que cualquier otro pago.
 */
export async function cesarTrabajador(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCese,
): Promise<{ planillaId: string; neto: string; conceptos: number }> {
  const [t] = await db
    .select()
    .from(trabajadores)
    .where(eq(trabajadores.id, datos.trabajadorId))
    .limit(1);
  if (!t) throw new TrabajadorInvalido(["el trabajador no existe en esta empresa"]);
  if (t.situacion === "cesado") {
    throw new TrabajadorInvalido([`${nombreDe(t)} ya está cesado desde el ${t.fechaCese}`]);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaCese)) {
    throw new PlanillaSueldosInvalida(["la fecha de cese es inválida"]);
  }
  if (datos.fechaCese < t.fechaIngreso) {
    throw new PlanillaSueldosInvalida(["el cese no puede ser anterior al ingreso"]);
  }

  const basico = await basicoEn(db, t.id, datos.fechaCese);
  if (!basico) {
    throw new PlanillaSueldosInvalida([
      `${nombreDe(t)} no tiene remuneración vigente al ${datos.fechaCese}: sin ella no hay liquidación`,
    ]);
  }

  const p = await parametrosDeEmpresa(db, empresaId, datos.fechaCese);
  const asignacion = t.tieneHijos ? txt2(money.mul(p.rmv, p.tasaAsignacionFamiliar)) : "0.00";

  const liquidacion = liquidacionBeneficios(
    {
      motivo: datos.motivo,
      fechaIngreso: t.fechaIngreso,
      fechaCese: datos.fechaCese,
      remuneracion: basico,
      asignacionFamiliar: asignacion,
      ultimaGratificacion: await ultimaGratificacion(db, t.id),
      ctsDesde: await ultimoDepositoCts(db, t.id, datos.fechaCese),
      vacacionesDesde: await ultimoPeriodoVacacional(t.fechaIngreso, datos.fechaCese),
      diasDelMes: datos.diasDelMes ?? Math.min(Number(datos.fechaCese.slice(8, 10)), 30),
      ...(datos.diasVacacionesPendientes
        ? { diasVacacionesPendientes: datos.diasVacacionesPendientes }
        : {}),
      ...(datos.descuentos ? { descuentos: datos.descuentos } : {}),
    },
    p,
  );

  const periodo = datos.fechaCese.slice(0, 4) + datos.fechaCese.slice(5, 7);
  const [cab] = await db
    .insert(planillasSueldos)
    .values({
      empresaId,
      numero: `LIQ-${t.numeroDocumento}-${datos.fechaCese.replace(/-/g, "")}`,
      tipo: "liquidacion",
      periodo,
      fecha: datos.fechaCese,
      estado: "borrador",
      totalIngresos: liquidacion.totalBruto,
      totalDescuentos: liquidacion.totalDescuentos,
      totalNeto: liquidacion.neto,
      observaciones: datos.observaciones?.trim() || null,
      creadoPor: usuarioId,
    })
    .returning({ id: planillasSueldos.id });

  const [pt] = await db
    .insert(planillaTrabajadores)
    .values({
      empresaId,
      planillaId: cab!.id,
      trabajadorId: t.id,
      diasTrabajados: datos.diasDelMes ?? Math.min(Number(datos.fechaCese.slice(8, 10)), 30),
      regimenPension: t.regimenPension,
      afpCodigo: t.afpCodigo,
      totalIngresos: liquidacion.totalBruto,
      totalDescuentos: liquidacion.totalDescuentos,
      neto: liquidacion.neto,
      motivoCese: datos.motivo,
      fechaCese: datos.fechaCese,
      creadoPor: usuarioId,
    })
    .returning({ id: planillaTrabajadores.id });

  const filas = [
    ...liquidacion.conceptos.map((c, i) => ({
      empresaId,
      planillaTrabajadorId: pt!.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: "ingreso",
      importe: c.importe,
      nota: c.nota ?? null,
      orden: i,
      creadoPor: usuarioId,
    })),
    ...liquidacion.descuentos.map((c, i) => ({
      empresaId,
      planillaTrabajadorId: pt!.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: "descuento",
      importe: c.importe,
      nota: null,
      orden: 100 + i,
      creadoPor: usuarioId,
    })),
  ];
  if (filas.length) await db.insert(planillaLineas).values(filas);

  // El cese y la liquidación van juntos: un trabajador dado de baja sin
  // liquidación es el que desaparece de la planilla y de la memoria a la vez.
  await db
    .update(trabajadores)
    .set({
      situacion: "cesado",
      fechaCese: datos.fechaCese,
      motivoCese: datos.motivo,
      actualizadoEn: new Date(),
    })
    .where(eq(trabajadores.id, t.id));

  // Los contratos vigentes dejan de estarlo, o seguirían saliendo en el aviso
  // de vencimientos de alguien que ya no trabaja aquí.
  await db
    .update(contratos)
    .set({ estado: "terminado", actualizadoEn: new Date() })
    .where(and(eq(contratos.trabajadorId, t.id), eq(contratos.estado, "vigente")));

  return {
    planillaId: cab!.id,
    neto: liquidacion.neto,
    conceptos: liquidacion.conceptos.length,
  };
}

/** Desde cuándo corre la CTS trunca: el último depósito, o el semestre en curso. */
async function ultimoDepositoCts(db: Db, trabajadorId: string, hasta: string): Promise<string> {
  const [fila] = (await db.execute(sql`
    SELECT max(p.periodo) AS periodo
      FROM planillas_sueldos p
      JOIN planilla_trabajadores pt ON pt.planilla_id = p.id
     WHERE pt.trabajador_id = ${trabajadorId}
       AND p.tipo = 'cts' AND p.estado IN ('cerrada', 'pagada')`)) as unknown as [
    { periodo: string | null },
  ];
  if (fila?.periodo) {
    const s = semestreCts(fila.periodo);
    return sumarDias(s.hasta, 1);
  }
  // Sin depósitos previos, el semestre en curso. Los anteriores ya se pagaron
  // o nunca existieron, y suponerlos pagaría de más.
  const s = semestreCts(hasta.slice(0, 4) + hasta.slice(5, 7));
  return s.desde;
}

/** El periodo vacacional en curso: el último aniversario de ingreso. */
function ultimoPeriodoVacacional(fechaIngreso: string, fechaCese: string): string {
  const [ai, mi, di] = fechaIngreso.split("-").map(Number) as [number, number, number];
  let anio = Number(fechaCese.slice(0, 4));
  const aniversario = (a: number) =>
    `${a}-${String(mi).padStart(2, "0")}-${String(di).padStart(2, "0")}`;
  if (aniversario(anio) > fechaCese) anio -= 1;
  return aniversario(Math.max(anio, ai));
}
