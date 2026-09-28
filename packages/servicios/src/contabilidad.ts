/**
 * Contabilización.
 *
 * Toda operación que mueva dinero termina aquí. El asiento se valida en el
 * dominio —partida doble, en las dos monedas— y además contra el plan de
 * cuentas de la empresa, que es lo que el dominio no puede saber: si la cuenta
 * existe, si admite movimiento, y si exige tercero, centro de costo o
 * documento.
 *
 * El libro es append-only, garantizado por un trigger en la base y no sólo por
 * este código. Un asiento se corrige extornándolo, nunca editándolo.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { money, contabilidad as dominio } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { cuentasDe } from "./parametros.ts";
import { sincronizarPlanCuentas } from "./maestros.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const { asientos, asientoLineas, planCuentas, periodos } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class ContabilizacionInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "ContabilizacionInvalida");
  }
}

export type LineaAsientoEntrada = {
  cuenta: string;
  glosa?: string;
  /** Importe en la moneda de la operación. Uno de los dos, no ambos. */
  debe?: string;
  haber?: string;
  /**
   * Equivalentes en moneda funcional. Si se omiten, se calculan con el tipo de
   * cambio de la cabecera, que es lo correcto salvo que la operación mezcle
   * partidas convertidas a tipos distintos.
   */
  debeFuncional?: string;
  haberFuncional?: string;
  centroCostoId?: string;
  anexoId?: string;
  documento?: { tipo: string; serie: string; numero: string; fecha: string };
};

export type EntradaAsiento = {
  periodo: string;
  fecha: string;
  subdiario: string;
  glosa: string;
  moneda: string;
  tipoCambio: string;
  origenModulo?: string;
  origenId?: string;
  lineas: LineaAsientoEntrada[];
};

/**
 * Crea y contabiliza un asiento en un solo paso.
 *
 * Se contabiliza directamente porque quien llama es otro módulo —una
 * liquidación, un pago— y esas operaciones no tienen un estado intermedio de
 * borrador: o se hicieron o no se hicieron. El borrador es para la captura
 * manual de asientos, que pasa por otro camino.
 */
export async function asentar(
  db: Db,
  empresaId: string,
  usuarioId: string,
  entrada: EntradaAsiento,
): Promise<string> {
  await exigirPeriodoAbierto(db, entrada.periodo);

  const tipoCambio = dec(entrada.tipoCambio);
  const lineas = entrada.lineas.map((l) => completarFuncional(l, tipoCambio));

  const asiento: dominio.Asiento = {
    id: "nuevo",
    periodo: entrada.periodo,
    fecha: new Date(`${entrada.fecha}T00:00:00Z`),
    subdiario: entrada.subdiario,
    glosa: entrada.glosa,
    moneda: entrada.moneda,
    tipoCambio,
    estado: "borrador",
    lineas: lineas.map((l) => ({
      cuenta: l.cuenta,
      ...(l.glosa ? { glosa: l.glosa } : {}),
      debe: dec(l.debe),
      haber: dec(l.haber),
      debeFuncional: dec(l.debeFuncional),
      haberFuncional: dec(l.haberFuncional),
      ...(l.centroCostoId ? { centroCostoId: l.centroCostoId } : {}),
      ...(l.anexoId ? { anexoId: l.anexoId } : {}),
    })),
  };

  const motivos = [
    ...dominio.validar(asiento),
    ...(await validarContraPlan(db, lineas)),
  ];
  if (motivos.length > 0) throw new ContabilizacionInvalida(motivos);

  const numero = await siguienteNumero(db, entrada.periodo);

  const [cab] = await db
    .insert(asientos)
    .values({
      empresaId,
      periodo: entrada.periodo,
      numero,
      fecha: entrada.fecha,
      subdiario: entrada.subdiario,
      glosa: entrada.glosa,
      moneda: entrada.moneda,
      tipoCambio: entrada.tipoCambio,
      estado: "contabilizado",
      origenModulo: entrada.origenModulo ?? null,
      origenId: entrada.origenId ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: asientos.id });

  await db.insert(asientoLineas).values(
    lineas.map((l, i) => ({
      empresaId,
      asientoId: cab!.id,
      linea: i + 1,
      cuenta: l.cuenta,
      glosa: l.glosa ?? null,
      debe: l.debe ?? "0",
      haber: l.haber ?? "0",
      debeFuncional: l.debeFuncional ?? "0",
      haberFuncional: l.haberFuncional ?? "0",
      centroCostoId: l.centroCostoId ?? null,
      anexoId: l.anexoId ?? null,
      documentoTipo: l.documento?.tipo ?? null,
      documentoSerie: l.documento?.serie ?? null,
      documentoNumero: l.documento?.numero ?? null,
      documentoFecha: l.documento?.fecha ?? null,
    })),
  );

  return cab!.id;
}

/**
 * Extorna un asiento generando su inverso.
 *
 * El original queda marcado como extornado y ambos permanecen en el libro. Un
 * asiento que desaparece deja un libro que no prueba nada.
 */
export async function extornar(
  db: Db,
  empresaId: string,
  usuarioId: string,
  asientoId: string,
  datos: { fecha: string; periodo: string; glosa?: string },
): Promise<string> {
  await exigirPeriodoAbierto(db, datos.periodo);

  const [cab] = await db.select().from(asientos).where(eq(asientos.id, asientoId)).limit(1);
  if (!cab) throw new ContabilizacionInvalida(["el asiento no existe"]);
  if (cab.estado !== "contabilizado") {
    throw new ContabilizacionInvalida([`el asiento está ${cab.estado}; sólo se extorna un contabilizado`]);
  }

  const lineas = await db
    .select()
    .from(asientoLineas)
    .where(eq(asientoLineas.asientoId, asientoId))
    .orderBy(asientoLineas.linea);

  const numero = await siguienteNumero(db, datos.periodo);

  const [extorno] = await db
    .insert(asientos)
    .values({
      empresaId,
      periodo: datos.periodo,
      numero,
      fecha: datos.fecha,
      subdiario: cab.subdiario,
      glosa: datos.glosa ?? `Extorno de: ${cab.glosa}`,
      moneda: cab.moneda,
      tipoCambio: cab.tipoCambio,
      estado: "contabilizado",
      extornaA: asientoId,
      origenModulo: cab.origenModulo,
      origenId: cab.origenId,
      creadoPor: usuarioId,
    })
    .returning({ id: asientos.id });

  await db.insert(asientoLineas).values(
    lineas.map((l, i) => ({
      empresaId,
      asientoId: extorno!.id,
      linea: i + 1,
      cuenta: l.cuenta,
      glosa: l.glosa,
      // Se invierten los lados; no se niegan los importes. Un haber negativo no
      // es contabilidad, es una hoja de cálculo.
      debe: l.haber,
      haber: l.debe,
      debeFuncional: l.haberFuncional,
      haberFuncional: l.debeFuncional,
      centroCostoId: l.centroCostoId,
      anexoId: l.anexoId,
      documentoTipo: l.documentoTipo,
      documentoSerie: l.documentoSerie,
      documentoNumero: l.documentoNumero,
      documentoFecha: l.documentoFecha,
    })),
  );

  await db.update(asientos).set({ estado: "extornado" }).where(eq(asientos.id, asientoId));
  return extorno!.id;
}

/** Balance de comprobación del periodo, en moneda funcional. */
export async function balanceComprobacion(db: Db, periodo: string) {
  const filas = await db.execute<{
    cuenta: string;
    descripcion: string | null;
    debe: string;
    haber: string;
    saldo: string;
  }>(sql`
    SELECT l.cuenta,
           pc.descripcion,
           sum(l.debe_funcional)::text  AS debe,
           sum(l.haber_funcional)::text AS haber,
           (sum(l.debe_funcional) - sum(l.haber_funcional))::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    LEFT JOIN plan_cuentas pc ON pc.cuenta = l.cuenta AND pc.empresa_id = a.empresa_id
    WHERE a.periodo = ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
    GROUP BY l.cuenta, pc.descripcion
    ORDER BY l.cuenta`);
  // El driver devuelve un objeto Result; se copia a un array para que el tipo
  // declarado coincida con el prototipo real.
  return [...(filas as unknown as {
    cuenta: string;
    descripcion: string | null;
    debe: string;
    haber: string;
    saldo: string;
  }[])];
}

/** Mayor de una cuenta: los movimientos que la componen. */
export async function mayorDeCuenta(db: Db, cuenta: string, periodo?: string) {
  const cond = periodo
    ? sql`l.cuenta = ${cuenta} AND a.periodo = ${periodo}`
    : sql`l.cuenta = ${cuenta}`;
  return db.execute(sql`
    SELECT a.fecha, a.numero, a.glosa AS glosa_asiento, l.glosa,
           l.debe_funcional::text AS debe, l.haber_funcional::text AS haber,
           l.documento_tipo, l.documento_serie, l.documento_numero
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE ${cond} AND a.estado IN ('contabilizado', 'extornado')
    ORDER BY a.fecha, a.numero, l.linea`);
}

// ─── Auxiliares ───────────────────────────────────────────────────────────

/**
 * Completa los importes en moneda funcional a partir del tipo de cambio.
 *
 * Con tipo de cambio 1 —la contabilidad en soles de una operación en soles— es
 * una copia. Con moneda extranjera es la conversión, y guardarla es lo que
 * permite reconstruir el balance sin volver a buscar el tipo de cambio de aquel
 * día.
 */
function completarFuncional(l: LineaAsientoEntrada, tipoCambio: Dec): LineaAsientoEntrada {
  const convertir = (v: string | undefined) =>
    v === undefined ? undefined : txt2(money.mul(dec(v), tipoCambio));
  const debeFuncional = l.debeFuncional ?? convertir(l.debe);
  const haberFuncional = l.haberFuncional ?? convertir(l.haber);
  return {
    ...l,
    ...(debeFuncional !== undefined ? { debeFuncional } : {}),
    ...(haberFuncional !== undefined ? { haberFuncional } : {}),
  };
}

/**
 * Valida contra el plan de cuentas de la empresa.
 *
 * Es lo que el dominio no puede comprobar solo, porque depende de cómo tenga
 * configurada su contabilidad cada empresa.
 */
async function validarContraPlan(db: Db, lineas: LineaAsientoEntrada[]): Promise<string[]> {
  const cuentas = [...new Set(lineas.map((l) => l.cuenta))];
  if (cuentas.length === 0) return [];

  // `inArray` parametriza la lista. Construirla interpolando texto en el SQL
  // sería una inyección esperando a que un nombre de cuenta venga de un
  // formulario, que es exactamente lo que pasa con la captura manual.
  const filas = await db.select().from(planCuentas).where(inArray(planCuentas.cuenta, cuentas));

  const porCuenta = new Map(filas.map((f) => [f.cuenta, f]));
  const motivos: string[] = [];

  lineas.forEach((l, i) => {
    const n = i + 1;
    const c = porCuenta.get(l.cuenta);
    if (!c) {
      motivos.push(`línea ${n}: la cuenta ${l.cuenta} no está en el plan de cuentas`);
      return;
    }
    if (!c.activa) motivos.push(`línea ${n}: la cuenta ${l.cuenta} está inactiva`);
    if (!c.esMovimiento) {
      motivos.push(`línea ${n}: la cuenta ${l.cuenta} no admite movimiento; use una divisionaria`);
    }
    if (c.exigeAnexo && !l.anexoId) {
      motivos.push(`línea ${n}: la cuenta ${l.cuenta} exige imputar un tercero`);
    }
    if (c.exigeCentroCosto && !l.centroCostoId) {
      motivos.push(`línea ${n}: la cuenta ${l.cuenta} exige centro de costo`);
    }
    if (c.exigeDocumento && !l.documento && !l.anexoId) {
      motivos.push(`línea ${n}: la cuenta ${l.cuenta} exige documento de referencia`);
    }
  });

  return motivos;
}

/**
 * Rechaza escribir en un periodo cerrado.
 *
 * Se exporta porque no sólo la contabilidad escribe en un periodo: una
 * transferencia entre almacenes no genera asiento pero sí mueve el kardex, y el
 * kardex alimenta el inventario valorizado de un mes que quizá ya se declaró.
 */
export async function exigirPeriodoAbierto(db: Db, periodo: string): Promise<void> {
  const [p] = await db
    .select({ estado: periodos.estado })
    .from(periodos)
    .where(eq(periodos.periodo, periodo))
    .limit(1);
  // Un periodo que no existe se considera abierto: obligar a crearlos por
  // adelantado sólo sirve para bloquear a quien registra el primer documento
  // del mes. Cerrarlo, en cambio, es un acto explícito.
  if (p && p.estado === "cerrado") {
    throw new ContabilizacionInvalida([
      `el periodo ${periodo} está cerrado y no admite asientos nuevos`,
    ]);
  }
}

/**
 * Correlativo del asiento dentro del periodo.
 *
 * Se calcula con `max + 1` dentro de la transacción. Dos asientos simultáneos
 * en el mismo periodo chocarían contra el índice único `(empresa, periodo,
 * numero)`, y ese choque es lo correcto: mejor reintentar que emitir dos
 * asientos con el mismo número.
 */
async function siguienteNumero(db: Db, periodo: string): Promise<string> {
  const filas = await db.execute<{ siguiente: number }>(sql`
    SELECT coalesce(max(numero::int), 0) + 1 AS siguiente
    FROM asientos WHERE periodo = ${periodo}`);
  const n = (filas[0] as { siguiente: number } | undefined)?.siguiente ?? 1;
  return String(n).padStart(6, "0");
}

export { dominio as contabilidadDominio };


// ─── Captura manual de asientos ───────────────────────────────────────────

/**
 * Guarda un asiento como borrador.
 *
 * A diferencia de `asentar`, que contabiliza en el acto porque quien llama es
 * otro módulo, la captura manual pasa por borrador: el contador escribe veinte
 * líneas, revisa, corrige y recién entonces contabiliza. Un borrador no entra
 * al balance ni a los libros.
 */
export async function guardarBorrador(
  db: Db,
  empresaId: string,
  usuarioId: string,
  entrada: EntradaAsiento,
  asientoId?: string,
): Promise<{ asientoId: string; motivos: string[] }> {
  await exigirPeriodoAbierto(db, entrada.periodo);

  const tipoCambio = dec(entrada.tipoCambio);
  const lineas = entrada.lineas.map((l) => completarFuncional(l, tipoCambio));

  // Un borrador se guarda aunque no cuadre —para eso es un borrador— pero se
  // devuelven los motivos, que es lo que el contador necesita ver mientras
  // trabaja.
  const motivos = [
    ...dominio.validar(comoAsientoDominio(entrada, lineas, "borrador")),
    ...(await validarContraPlan(db, lineas)),
  ];

  if (asientoId) {
    const [existente] = await db
      .select({ estado: asientos.estado })
      .from(asientos)
      .where(eq(asientos.id, asientoId))
      .limit(1);
    if (!existente) throw new ContabilizacionInvalida(["el asiento no existe"]);
    if (existente.estado !== "borrador") {
      throw new ContabilizacionInvalida([
        `el asiento está ${existente.estado} y ya no se edita; use un extorno`,
      ]);
    }

    await db
      .update(asientos)
      .set({
        fecha: entrada.fecha,
        subdiario: entrada.subdiario,
        glosa: entrada.glosa,
        moneda: entrada.moneda,
        tipoCambio: entrada.tipoCambio,
      })
      .where(eq(asientos.id, asientoId));
    await db.delete(asientoLineas).where(eq(asientoLineas.asientoId, asientoId));
    await insertarLineas(db, empresaId, asientoId, lineas);
    return { asientoId, motivos };
  }

  const numero = await siguienteNumero(db, entrada.periodo);
  const [cab] = await db
    .insert(asientos)
    .values({
      empresaId,
      periodo: entrada.periodo,
      numero,
      fecha: entrada.fecha,
      subdiario: entrada.subdiario,
      glosa: entrada.glosa,
      moneda: entrada.moneda,
      tipoCambio: entrada.tipoCambio,
      estado: "borrador",
      creadoPor: usuarioId,
    })
    .returning({ id: asientos.id });

  await insertarLineas(db, empresaId, cab!.id, lineas);
  return { asientoId: cab!.id, motivos };
}

/** Pasa un borrador a contabilizado, si es válido. */
export async function contabilizarBorrador(
  db: Db,
  asientoId: string,
): Promise<void> {
  const [cab] = await db.select().from(asientos).where(eq(asientos.id, asientoId)).limit(1);
  if (!cab) throw new ContabilizacionInvalida(["el asiento no existe"]);
  if (cab.estado !== "borrador") {
    throw new ContabilizacionInvalida([`el asiento ya está ${cab.estado}`]);
  }
  await exigirPeriodoAbierto(db, cab.periodo);

  const lineas = await db
    .select()
    .from(asientoLineas)
    .where(eq(asientoLineas.asientoId, asientoId))
    .orderBy(asientoLineas.linea);

  const comoEntrada: LineaAsientoEntrada[] = lineas.map((l) => ({
    cuenta: l.cuenta,
    ...(l.glosa ? { glosa: l.glosa } : {}),
    debe: l.debe,
    haber: l.haber,
    debeFuncional: l.debeFuncional,
    haberFuncional: l.haberFuncional,
    ...(l.centroCostoId ? { centroCostoId: l.centroCostoId } : {}),
    ...(l.anexoId ? { anexoId: l.anexoId } : {}),
  }));

  const motivos = [
    ...dominio.validar(
      comoAsientoDominio(
        {
          periodo: cab.periodo,
          fecha: cab.fecha,
          subdiario: cab.subdiario,
          glosa: cab.glosa,
          moneda: cab.moneda,
          tipoCambio: cab.tipoCambio,
          lineas: comoEntrada,
        },
        comoEntrada,
        "borrador",
      ),
    ),
    ...(await validarContraPlan(db, comoEntrada)),
  ];
  if (motivos.length > 0) throw new ContabilizacionInvalida(motivos);

  await db.update(asientos).set({ estado: "contabilizado" }).where(eq(asientos.id, asientoId));
}

/** Borra un borrador. Sólo un borrador: lo contabilizado se extorna. */
export async function eliminarBorrador(db: Db, asientoId: string): Promise<void> {
  const [cab] = await db
    .select({ estado: asientos.estado })
    .from(asientos)
    .where(eq(asientos.id, asientoId))
    .limit(1);
  if (!cab) throw new ContabilizacionInvalida(["el asiento no existe"]);
  if (cab.estado !== "borrador") {
    throw new ContabilizacionInvalida([
      `el asiento está ${cab.estado}; lo contabilizado se extorna, no se borra`,
    ]);
  }
  await db.delete(asientoLineas).where(eq(asientoLineas.asientoId, asientoId));
  await db.delete(asientos).where(eq(asientos.id, asientoId));
}

function comoAsientoDominio(
  entrada: Omit<EntradaAsiento, "origenModulo" | "origenId">,
  lineas: LineaAsientoEntrada[],
  estado: dominio.Estado,
): dominio.Asiento {
  return {
    id: "captura",
    periodo: entrada.periodo,
    fecha: new Date(`${entrada.fecha}T00:00:00Z`),
    subdiario: entrada.subdiario,
    glosa: entrada.glosa,
    moneda: entrada.moneda,
    tipoCambio: dec(entrada.tipoCambio),
    estado,
    lineas: lineas.map((l) => ({
      cuenta: l.cuenta,
      ...(l.glosa ? { glosa: l.glosa } : {}),
      debe: dec(l.debe),
      haber: dec(l.haber),
      debeFuncional: dec(l.debeFuncional),
      haberFuncional: dec(l.haberFuncional),
      ...(l.centroCostoId ? { centroCostoId: l.centroCostoId } : {}),
      ...(l.anexoId ? { anexoId: l.anexoId } : {}),
    })),
  };
}

async function insertarLineas(
  db: Db,
  empresaId: string,
  asientoId: string,
  lineas: LineaAsientoEntrada[],
): Promise<void> {
  if (lineas.length === 0) return;
  await db.insert(asientoLineas).values(
    lineas.map((l, i) => ({
      empresaId,
      asientoId,
      linea: i + 1,
      cuenta: l.cuenta,
      glosa: l.glosa ?? null,
      debe: l.debe ?? "0",
      haber: l.haber ?? "0",
      debeFuncional: l.debeFuncional ?? "0",
      haberFuncional: l.haberFuncional ?? "0",
      centroCostoId: l.centroCostoId ?? null,
      anexoId: l.anexoId ?? null,
      documentoTipo: l.documento?.tipo ?? null,
      documentoSerie: l.documento?.serie ?? null,
      documentoNumero: l.documento?.numero ?? null,
      documentoFecha: l.documento?.fecha ?? null,
    })),
  );
}

export async function cargarAsiento(db: Db, asientoId: string) {
  const [cabecera] = await db.select().from(asientos).where(eq(asientos.id, asientoId)).limit(1);
  if (!cabecera) throw new ContabilizacionInvalida(["el asiento no existe"]);
  const lineas = await db
    .select()
    .from(asientoLineas)
    .where(eq(asientoLineas.asientoId, asientoId))
    .orderBy(asientoLineas.linea);
  return { cabecera, lineas };
}

/**
 * Asientos del periodo con su importe.
 *
 * El importe sale de un LEFT JOIN agrupado y no de una subconsulta
 * correlacionada dentro del `select`: esa forma no correlaciona bien con este
 * driver y devuelve cero en silencio, que es peor que fallar.
 */
export async function listarAsientos(db: Db, periodo: string) {
  const filas = (await db.execute(sql`
    SELECT a.id, a.numero, a.fecha::text AS fecha, a.subdiario, a.glosa, a.moneda,
           a.estado, a.origen_modulo,
           coalesce(sum(l.debe_funcional), 0)::text AS importe
    FROM asientos a
    LEFT JOIN asiento_lineas l ON l.asiento_id = a.id
    WHERE a.periodo = ${periodo}
    GROUP BY a.id
    -- Los últimos 500, no los primeros: con el orden ascendente, un periodo con
    -- más de 500 asientos mostraba los más viejos y escondía sin avisar el que
    -- el contador acababa de hacer.
    ORDER BY a.numero DESC
    LIMIT 500`)) as unknown as {
    id: string;
    numero: string;
    fecha: string;
    subdiario: string;
    glosa: string;
    moneda: string;
    estado: string;
    origen_modulo: string | null;
    importe: string;
  }[];
  // Se presentan en el orden en que se hicieron, que es como se lee un diario.
  return [...filas].reverse();
}

// ─── Estados financieros ──────────────────────────────────────────────────

export type LineaEstado = {
  concepto: string;
  cuentas: string;
  importe: Dec;
  /** Nivel de sangría al presentarlo. */
  nivel: number;
  esTotal?: boolean;
};

/**
 * Estado de situación financiera, en el formato de SUNAT.
 *
 * Se arma agrupando por los primeros dígitos de la cuenta. Es una aproximación
 * deliberada: el balance formal exige reclasificaciones que dependen del
 * criterio del contador —qué parte de una deuda es corriente, qué provisiones
 * se estiman—, y este informe sirve para revisar, no para presentar. Lo que sí
 * garantiza es que activo, pasivo y patrimonio salgan de los mismos asientos
 * que el balance de comprobación.
 */
export async function situacionFinanciera(db: Db, periodo: string) {
  const saldos = (await db.execute(sql`
    SELECT left(l.cuenta, 2) AS grupo,
           sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
    GROUP BY left(l.cuenta, 2)
    ORDER BY 1`)) as unknown as { grupo: string; saldo: string }[];

  const porGrupo = new Map([...saldos].map((s) => [s.grupo, dec(s.saldo)]));
  const suma = (...grupos: string[]) =>
    grupos.reduce<Dec>((a, g) => money.add(a, porGrupo.get(g) ?? money.ZERO), money.ZERO);

  // El pasivo y el patrimonio tienen saldo acreedor, es decir negativo con la
  // convención debe − haber. Se invierten para presentarlos en positivo.
  const inv = (v: Dec) => money.neg(v);

  const efectivo = suma("10");
  const cobrar = suma("12", "13", "14", "16", "17", "18");
  const existencias = suma("20", "21", "22", "23", "24", "25", "26", "27", "28");
  const activoCorriente = money.add(money.add(efectivo, cobrar), existencias);

  const inmovilizado = suma("30", "31", "32", "33", "34", "35", "36", "37", "38");
  const depreciacion = suma("39");
  const activoNoCorriente = money.add(inmovilizado, depreciacion);

  const tributos = inv(suma("40"));
  const remuneraciones = inv(suma("41"));
  const pagar = inv(suma("42", "43", "44", "45", "46", "47", "48", "49"));
  const pasivo = money.add(money.add(tributos, remuneraciones), pagar);

  const capital = inv(suma("50", "51", "52", "56", "57", "58"));
  const resultados = inv(suma("59"));
  // El resultado del ejercicio es la diferencia entre ingresos (7) y gastos (6).
  const resultadoEjercicio = money.sub(inv(suma("70", "71", "72", "73", "74", "75", "76", "77", "78")), suma("60", "61", "62", "63", "64", "65", "66", "67", "68", "69"));
  const patrimonio = money.add(money.add(capital, resultados), resultadoEjercicio);

  const activo: LineaEstado[] = [
    { concepto: "Efectivo y equivalentes de efectivo", cuentas: "10", importe: efectivo, nivel: 1 },
    { concepto: "Cuentas por cobrar", cuentas: "12-18", importe: cobrar, nivel: 1 },
    { concepto: "Existencias", cuentas: "20-28", importe: existencias, nivel: 1 },
    { concepto: "Total activo corriente", cuentas: "", importe: activoCorriente, nivel: 0, esTotal: true },
    { concepto: "Propiedad, planta y equipo", cuentas: "30-38", importe: inmovilizado, nivel: 1 },
    { concepto: "Depreciación acumulada", cuentas: "39", importe: depreciacion, nivel: 1 },
    { concepto: "Total activo no corriente", cuentas: "", importe: activoNoCorriente, nivel: 0, esTotal: true },
    {
      concepto: "TOTAL ACTIVO",
      cuentas: "",
      importe: money.add(activoCorriente, activoNoCorriente),
      nivel: 0,
      esTotal: true,
    },
  ];

  const pasivoPatrimonio: LineaEstado[] = [
    { concepto: "Tributos por pagar", cuentas: "40", importe: tributos, nivel: 1 },
    { concepto: "Remuneraciones por pagar", cuentas: "41", importe: remuneraciones, nivel: 1 },
    { concepto: "Cuentas por pagar", cuentas: "42-49", importe: pagar, nivel: 1 },
    { concepto: "Total pasivo", cuentas: "", importe: pasivo, nivel: 0, esTotal: true },
    { concepto: "Capital", cuentas: "50-58", importe: capital, nivel: 1 },
    { concepto: "Resultados acumulados", cuentas: "59", importe: resultados, nivel: 1 },
    { concepto: "Resultado del ejercicio", cuentas: "6 y 7", importe: resultadoEjercicio, nivel: 1 },
    { concepto: "Total patrimonio", cuentas: "", importe: patrimonio, nivel: 0, esTotal: true },
    {
      concepto: "TOTAL PASIVO Y PATRIMONIO",
      cuentas: "",
      importe: money.add(pasivo, patrimonio),
      nivel: 0,
      esTotal: true,
    },
  ];

  const totalActivo = money.add(activoCorriente, activoNoCorriente);
  const totalPasivoPatrimonio = money.add(pasivo, patrimonio);

  return {
    activo,
    pasivoPatrimonio,
    cuadra: money.isZero(money.round(money.sub(totalActivo, totalPasivoPatrimonio), 2)),
    descuadre: money.sub(totalActivo, totalPasivoPatrimonio),
  };
}

/**
 * Estado de resultados por naturaleza.
 *
 * Es el que corresponde al PCGE peruano: se presenta por naturaleza del gasto
 * —compras, servicios, personal— y no por función. El resultado tiene que
 * coincidir con el que sale en el balance, y hay una prueba que lo comprueba.
 */
export async function estadoResultados(db: Db, periodo: string) {
  const saldos = (await db.execute(sql`
    SELECT left(l.cuenta, 2) AS grupo,
           sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) IN ('6', '7')
      -- La 79 es la contrapartida del asiento de destino, no un ingreso: se
      -- abona por el total de los gastos que se reclasifican a la clase 9.
      -- Contarla aquí dejaba el resultado en cero en cuanto alguien destinaba.
      AND left(l.cuenta, 2) <> '79'
    GROUP BY left(l.cuenta, 2)
    ORDER BY 1`)) as unknown as { grupo: string; saldo: string }[];

  const porGrupo = new Map([...saldos].map((s) => [s.grupo, dec(s.saldo)]));
  const g = (grupo: string) => porGrupo.get(grupo) ?? money.ZERO;
  const inv = (v: Dec) => money.neg(v);

  const ventas = inv(g("70"));
  const costoVentas = g("69");
  const utilidadBruta = money.sub(ventas, costoVentas);

  /*
   * Los gastos operativos se derivan, no se enumeran.
   *
   * Antes se sumaban tres grupos concretos —63, 64 y 65— y cualquier otro
   * quedaba fuera: la planilla del 62 y la depreciación del 68 no aparecían en
   * el estado de resultados, y la utilidad operativa salía inflada por el
   * importe de la planilla del mes. Ahora entra todo el elemento 6 salvo el
   * costo de ventas y los gastos financieros, que tienen su propio renglón.
   */
  const NOMBRE_GASTO: Record<string, string> = {
    "60": "Compras",
    "61": "Variación de existencias",
    "62": "Gastos de personal",
    "63": "Servicios de terceros",
    "64": "Gastos por tributos",
    "65": "Otros gastos de gestión",
    "66": "Pérdidas por medición de activos",
    "68": "Depreciación, amortización y provisiones",
  };

  const gruposGasto = [...porGrupo.keys()]
    .filter((k) => k.startsWith("6") && k !== "69" && k !== "67")
    .filter((k) => !money.isZero(g(k)))
    .sort();

  const gastosOperativos = gruposGasto.reduce<Dec>((a, k) => money.add(a, g(k)), money.ZERO);
  const utilidadOperativa = money.sub(utilidadBruta, gastosOperativos);

  const ingresosFinancieros = inv(g("77"));
  const gastosFinancieros = g("67");

  /* Lo mismo del lado de los ingresos: todo el elemento 7 que no sea la venta
     ni el ingreso financiero es otro ingreso de gestión. */
  const gruposOtroIngreso = [...porGrupo.keys()]
    .filter((k) => k.startsWith("7") && k !== "70" && k !== "77")
    .filter((k) => !money.isZero(g(k)))
    .sort();
  const otrosIngresos = gruposOtroIngreso.reduce<Dec>((a, k) => money.add(a, inv(g(k))), money.ZERO);

  const resultado = money.add(
    money.sub(money.add(utilidadOperativa, ingresosFinancieros), gastosFinancieros),
    otrosIngresos,
  );

  const lineas: LineaEstado[] = [
    { concepto: "Ventas netas", cuentas: "70", importe: ventas, nivel: 1 },
    { concepto: "Costo de ventas", cuentas: "69", importe: money.neg(costoVentas), nivel: 1 },
    { concepto: "Utilidad bruta", cuentas: "", importe: utilidadBruta, nivel: 0, esTotal: true },
    ...gruposGasto.map((k) => ({
      concepto: NOMBRE_GASTO[k] ?? `Gastos del grupo ${k}`,
      cuentas: k,
      importe: money.neg(g(k)),
      nivel: 1,
    })),
    { concepto: "Utilidad operativa", cuentas: "", importe: utilidadOperativa, nivel: 0, esTotal: true },
    { concepto: "Ingresos financieros", cuentas: "77", importe: ingresosFinancieros, nivel: 1 },
    { concepto: "Gastos financieros", cuentas: "67", importe: money.neg(gastosFinancieros), nivel: 1 },
    ...(money.isZero(otrosIngresos)
      ? []
      : [
          {
            concepto: "Otros ingresos de gestión",
            cuentas: gruposOtroIngreso.join(", "),
            importe: otrosIngresos,
            nivel: 1,
          },
        ]),
    { concepto: "RESULTADO DEL EJERCICIO", cuentas: "", importe: resultado, nivel: 0, esTotal: true },
  ];

  return { lineas, resultado };
}

// ─── Cierre de periodo ────────────────────────────────────────────────────

/**
 * Cierra un periodo contable.
 *
 * Un periodo cerrado no admite asientos nuevos, que es lo que impide que
 * alguien toque un mes ya declarado a SUNAT. No se cierra si queda algún
 * borrador sin resolver ni si el balance no cuadra: cerrar sobre un descuadre
 * lo convierte en permanente.
 */
export async function cerrarPeriodo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  periodo: string,
): Promise<void> {
  const motivos: string[] = [];

  const borradores = (await db.execute(sql`
    SELECT count(*)::int AS n FROM asientos
    WHERE periodo = ${periodo} AND estado = 'borrador'`)) as unknown as [{ n: number }];
  if (borradores[0]!.n > 0) {
    const n = borradores[0]!.n;
    motivos.push(
      n === 1
        ? "queda 1 asiento en borrador; contabilícelo o elimínelo antes de cerrar"
        : `quedan ${n} asientos en borrador; contabilícelos o elimínelos antes de cerrar`,
    );
  }

  const saldos = await balanceComprobacion(db, periodo);
  const descuadre = saldos.reduce<Dec>((a, s) => money.add(a, dec(s.saldo)), money.ZERO);
  if (!money.isZero(money.round(descuadre, 2))) {
    motivos.push(
      `el balance del periodo no cuadra por ${money.toString(descuadre, 2)}; cerrar lo haría permanente`,
    );
  }

  if (motivos.length > 0) throw new ContabilizacionInvalida(motivos);

  await db
    .insert(periodos)
    .values({ empresaId, periodo, estado: "cerrado", cerradoPor: usuarioId })
    .onConflictDoUpdate({
      target: [periodos.empresaId, periodos.periodo],
      set: { estado: "cerrado", cerradoPor: usuarioId },
    });
}

/** Reabre un periodo. Deja rastro de quién lo hizo en la bitácora. */
export async function reabrirPeriodo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  periodo: string,
): Promise<void> {
  await db
    .insert(periodos)
    .values({ empresaId, periodo, estado: "abierto", cerradoPor: usuarioId })
    .onConflictDoUpdate({
      target: [periodos.empresaId, periodos.periodo],
      set: { estado: "abierto" },
    });
}

export const listarPeriodos = (db: Db) =>
  db.select().from(periodos).orderBy(sql`${periodos.periodo} DESC`).limit(36);

// ─── Cierre de ejercicio ──────────────────────────────────────────────────

/**
 * Grupos de cuentas monetarias, los únicos que se revalúan.
 *
 * Una partida monetaria es un derecho o una obligación por un número fijo de
 * unidades de moneda: el dólar que está en el banco, la factura que hay que
 * pagar en dólares. Una existencia comprada en dólares no lo es —su costo en
 * soles quedó fijado el día que entró al almacén— y revaluarla sería inventar
 * una ganancia que no existe.
 */
const GRUPOS_MONETARIOS = [
  "10", "12", "13", "14", "16", "17", "18",
  "42", "43", "44", "45", "46", "47",
];

export type AjusteCambio = {
  cuenta: string;
  /** El tercero de la partida, cuando la cuenta lo exige. */
  anexoId: string | null;
  /** Saldo en moneda extranjera, deudor positivo. */
  saldoMe: Dec;
  /** Equivalente en soles ya registrado. */
  saldoFuncional: Dec;
  /** Lo que hay que añadir en soles para llevarlo al tipo de cambio de cierre. */
  ajuste: Dec;
};

/**
 * Ajusta por diferencia de cambio los saldos en moneda extranjera.
 *
 * El asiento se emite en dólares con importes cero en la moneda de la
 * operación y sólo con el equivalente funcional: el ajuste no mueve un dólar,
 * mueve la cifra en soles de los dólares que ya estaban. Eso es también lo que
 * permite volver a ejecutarlo el año siguiente sin duplicar nada, porque el
 * saldo en dólares no cambia y el funcional sí acumula lo ya ajustado.
 */
export async function ajustarDiferenciaCambio(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { periodo: string; fecha: string; tipoCambio: string },
): Promise<{ asientoId: string | null; ajustes: AjusteCambio[] }> {
  await exigirPeriodoAbierto(db, datos.periodo);
  const tc = dec(datos.tipoCambio);

  // Se agrupa también por tercero: la cuenta 42 lo exige, y además la
  // diferencia de cambio se determina partida por partida, no por el neto de
  // la cuenta.
  const filas = (await db.execute(sql`
    SELECT l.cuenta, l.anexo_id,
           sum(l.debe - l.haber)::text AS me,
           sum(l.debe_funcional - l.haber_funcional)::text AS funcional
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${datos.periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND a.moneda <> 'PEN'
    GROUP BY l.cuenta, l.anexo_id
    ORDER BY l.cuenta`)) as unknown as {
    cuenta: string;
    anexo_id: string | null;
    me: string;
    funcional: string;
  }[];

  const ajustes = [...filas]
    .filter((f) => GRUPOS_MONETARIOS.includes(f.cuenta.slice(0, 2)))
    .map((f) => {
      const saldoMe = dec(f.me);
      const saldoFuncional = dec(f.funcional);
      return {
        cuenta: f.cuenta,
        anexoId: f.anexo_id,
        saldoMe,
        saldoFuncional,
        ajuste: money.round(money.sub(money.mul(saldoMe, tc), saldoFuncional), 2),
      };
    })
    .filter((a) => !money.isZero(a.ajuste));

  if (ajustes.length === 0) return { asientoId: null, ajustes: [] };

  // Un ajuste positivo sube el equivalente en soles de la partida: se carga la
  // cuenta y la contrapartida es ganancia. Sirve igual para un activo —hay más
  // soles— que para un pasivo, donde un ajuste negativo agranda la deuda y la
  // contrapartida es pérdida.
  const lineas: LineaAsientoEntrada[] = ajustes.map((a) => ({
    cuenta: a.cuenta,
    glosa: "Ajuste por diferencia de cambio al cierre",
    debe: "0",
    haber: "0",
    ...(a.anexoId ? { anexoId: a.anexoId } : {}),
    ...(money.gt(a.ajuste, money.ZERO)
      ? { debeFuncional: txt2(a.ajuste), haberFuncional: "0" }
      : { debeFuncional: "0", haberFuncional: txt2(money.neg(a.ajuste)) }),
  }));

  const neto = ajustes.reduce<Dec>((acc, a) => money.add(acc, a.ajuste), money.ZERO);
  const cuentas = await cuentasDe(db);
  lineas.push({
    cuenta: money.gt(neto, money.ZERO)
      ? cuentas.get("ganancia_cambio")
      : cuentas.get("perdida_cambio"),
    glosa: "Diferencia de cambio del ejercicio",
    debe: "0",
    haber: "0",
    ...(money.gt(neto, money.ZERO)
      ? { debeFuncional: "0", haberFuncional: txt2(neto) }
      : { debeFuncional: txt2(money.neg(neto)), haberFuncional: "0" }),
  });

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo: datos.periodo,
    fecha: datos.fecha,
    subdiario: "08",
    glosa: `Ajuste por diferencia de cambio al ${datos.tipoCambio}`,
    moneda: "USD",
    tipoCambio: datos.tipoCambio,
    origenModulo: "cierre",
    lineas,
  });

  return { asientoId, ajustes };
}

export type ResultadoCierre = {
  /** Asiento que cancela las cuentas de resultado contra la 89. */
  asientoResultado: string;
  /** Asiento que traslada la 89 a resultados acumulados. */
  asientoTraslado: string;
  /** Positivo si el ejercicio dio utilidad. */
  utilidad: Dec;
};

/**
 * Cierra el ejercicio.
 *
 * Son dos asientos, no uno, porque son dos hechos distintos y así se leen en el
 * mayor: primero las cuentas de resultado se cancelan contra la 89, que queda
 * mostrando el resultado del año; después la 89 se traslada a resultados
 * acumulados y queda en cero.
 *
 * Ambos van al periodo 13, que es el que SUNAT reserva para los asientos de
 * cierre y el que hace que diciembre siga cuadrando por sí solo.
 */
export async function cerrarEjercicio(
  db: Db,
  empresaId: string,
  usuarioId: string,
  ejercicio: string,
): Promise<ResultadoCierre> {
  if (!/^\d{4}$/.test(ejercicio)) {
    throw new ContabilizacionInvalida(["el ejercicio se indica como AAAA"]);
  }
  const periodoCierre = `${ejercicio}13`;
  await exigirPeriodoAbierto(db, periodoCierre);
  // El plan puede haberse quedado atrás si la empresa se creó antes de que
  // el catálogo incluyera las cuentas del elemento 8. Se pone al día en vez de
  // fallar con «la cuenta 891 no está en el plan».
  await sincronizarPlanCuentas(db, empresaId);

  const motivos: string[] = [];

  const borradores = (await db.execute(sql`
    SELECT count(*)::int AS n FROM asientos
    WHERE periodo LIKE ${`${ejercicio}%`} AND estado = 'borrador'`)) as unknown as [{ n: number }];
  if (borradores[0]!.n > 0) {
    const n = borradores[0]!.n;
    motivos.push(
      n === 1
        ? `queda 1 asiento en borrador en el ejercicio ${ejercicio}`
        : `quedan ${n} asientos en borrador en el ejercicio ${ejercicio}`,
    );
  }

  const yaCerrado = (await db.execute(sql`
    SELECT count(*)::int AS n FROM asientos
    WHERE periodo = ${periodoCierre} AND origen_modulo = 'cierre_ejercicio'
      AND estado = 'contabilizado'`)) as unknown as [{ n: number }];
  if (yaCerrado[0]!.n > 0) {
    motivos.push(`el ejercicio ${ejercicio} ya está cerrado; extorne el cierre antes de repetirlo`);
  }

  // Se agrupa por cuenta *y* centro de costo: hay cuentas del plan que exigen
  // centro de costo, y una línea de cierre sin él no se puede asentar. Agrupar
  // sólo por cuenta dejaba el cierre anual bloqueado en cuanto la empresa usaba
  // centros de costo, que es siempre.
  const filas = (await db.execute(sql`
    SELECT l.cuenta, l.centro_costo_id,
           sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo LIKE ${`${ejercicio}%`}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) IN ('6', '7')
    GROUP BY l.cuenta, l.centro_costo_id
    ORDER BY l.cuenta`)) as unknown as {
    cuenta: string;
    centro_costo_id: string | null;
    saldo: string;
  }[];

  const saldos = [...filas]
    .map((f) => ({
      cuenta: f.cuenta,
      centroCostoId: f.centro_costo_id,
      saldo: money.round(dec(f.saldo), 2),
    }))
    .filter((f) => !money.isZero(f.saldo));

  if (saldos.length === 0) motivos.push("no hay cuentas de resultado que cerrar");
  if (motivos.length > 0) throw new ContabilizacionInvalida(motivos);

  // Σ(debe − haber) de las cuentas de resultado: positivo son más gastos que
  // ingresos, es decir pérdida.
  const neto = saldos.reduce<Dec>((a, f) => money.add(a, f.saldo), money.ZERO);
  const utilidad = money.neg(neto);
  const hayUtilidad = money.gt(utilidad, money.ZERO);
  const cuenta89 = hayUtilidad ? "891" : "892";
  const magnitud = hayUtilidad ? utilidad : neto;

  const fechaCierre = `${ejercicio}-12-31`;

  const asientoResultado = await asentar(db, empresaId, usuarioId, {
    periodo: periodoCierre,
    fecha: fechaCierre,
    subdiario: "08",
    glosa: `Cierre de las cuentas de resultado del ejercicio ${ejercicio}`,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "cierre_ejercicio",
    lineas: [
      // Cada cuenta se cancela con el importe contrario al que tiene.
      ...saldos.map((f) => ({
        cuenta: f.cuenta,
        glosa: "Cierre del ejercicio",
        ...(f.centroCostoId ? { centroCostoId: f.centroCostoId } : {}),
        ...(money.gt(f.saldo, money.ZERO)
          ? { haber: txt2(f.saldo) }
          : { debe: txt2(money.neg(f.saldo)) }),
      })),
      hayUtilidad
        ? { cuenta: cuenta89, haber: txt2(magnitud), glosa: "Resultado del ejercicio" }
        : { cuenta: cuenta89, debe: txt2(magnitud), glosa: "Resultado del ejercicio" },
    ],
  });

  const cuentasCierre = await cuentasDe(db);
  const asientoTraslado = await asentar(db, empresaId, usuarioId, {
    periodo: periodoCierre,
    fecha: fechaCierre,
    subdiario: "08",
    glosa: `Traslado del resultado del ejercicio ${ejercicio} a resultados acumulados`,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "cierre_ejercicio",
    lineas: hayUtilidad
      ? [
          { cuenta: "891", debe: txt2(magnitud), glosa: "Traslado del resultado" },
          {
            cuenta: cuentasCierre.get("utilidad_ejercicio"),
            haber: txt2(magnitud),
            glosa: "Utilidad del ejercicio",
          },
        ]
      : [
          {
            cuenta: cuentasCierre.get("perdida_ejercicio"),
            debe: txt2(magnitud),
            glosa: "Pérdida del ejercicio",
          },
          { cuenta: "892", haber: txt2(magnitud), glosa: "Traslado del resultado" },
        ],
  });

  // Cerrar los doce meses y el periodo 13 es lo que impide que alguien meta un
  // asiento en un ejercicio del que ya salió el resultado.
  const aCerrar = Array.from({ length: 12 }, (_, i) => `${ejercicio}${String(i + 1).padStart(2, "0")}`)
    .concat(periodoCierre);
  for (const periodo of aCerrar) {
    await db
      .insert(periodos)
      .values({ empresaId, periodo, estado: "cerrado", cerradoPor: usuarioId })
      .onConflictDoUpdate({
        target: [periodos.empresaId, periodos.periodo],
        set: { estado: "cerrado", cerradoPor: usuarioId },
      });
  }

  return { asientoResultado, asientoTraslado, utilidad };
}
