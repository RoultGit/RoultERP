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

const { asientos, asientoLineas, planCuentas, periodos } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class ContabilizacionInvalida extends Error {
  constructor(readonly motivos: readonly string[]) {
    super(motivos.join("; "));
    this.name = "ContabilizacionInvalida";
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
  return filas as unknown as {
    cuenta: string;
    descripcion: string | null;
    debe: string;
    haber: string;
    saldo: string;
  }[];
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

async function exigirPeriodoAbierto(db: Db, periodo: string): Promise<void> {
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
