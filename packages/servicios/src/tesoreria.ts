/**
 * Caja y bancos.
 *
 * El módulo lleva dos libros y los compara:
 *
 * - El **libro auxiliar** es lo que la empresa cree que pasó en cada cuenta.
 *   Se alimenta solo desde los pagos y las cobranzas, y a mano para lo que no
 *   viene de otro módulo: una comisión bancaria, un préstamo, un aporte.
 *
 * - El **extracto** es lo que el banco dice que pasó. Se importa del archivo
 *   que el banco entrega.
 *
 * Conciliar es aparearlos. Lo que queda sin pareja es justamente lo interesante:
 * un cargo que la empresa no registró —comisión, ITF, portes— o un depósito que
 * nadie contabilizó.
 *
 * El arqueo es el equivalente para efectivo: se cuenta lo que hay y se compara
 * con lo que debería haber.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { asentar } from "./contabilidad.ts";
import { cuentasDe } from "./parametros.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const { cuentasEfectivo, movimientosEfectivo, extractoBancario, arqueos, terceros } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class TesoreriaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "TesoreriaInvalida");
  }
}

// ─── Cuentas ──────────────────────────────────────────────────────────────

export type DatosCuenta = {
  codigo: string;
  nombre: string;
  tipo: "caja" | "caja_chica" | "banco";
  moneda: string;
  cuentaContable: string;
  banco?: string;
  numeroCuenta?: string;
  cci?: string;
  fondoFijo?: string;
};

export async function crearCuenta(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCuenta,
): Promise<string> {
  if (datos.tipo === "banco" && !datos.numeroCuenta) {
    throw new TesoreriaInvalida(["una cuenta bancaria necesita su número"]);
  }
  // El fondo fijo sólo tiene sentido en caja chica: es el importe que se
  // repone cada vez que se rinde.
  if (datos.tipo !== "caja_chica" && datos.fondoFijo && !money.isZero(dec(datos.fondoFijo))) {
    throw new TesoreriaInvalida(["el fondo fijo sólo aplica a una caja chica"]);
  }

  const [fila] = await db
    .insert(cuentasEfectivo)
    .values({
      empresaId,
      codigo: datos.codigo,
      nombre: datos.nombre,
      tipo: datos.tipo,
      moneda: datos.moneda,
      cuentaContable: datos.cuentaContable,
      banco: datos.banco ?? null,
      numeroCuenta: datos.numeroCuenta ?? null,
      cci: datos.cci ?? null,
      fondoFijo: datos.fondoFijo ?? "0",
      creadoPor: usuarioId,
    })
    .returning({ id: cuentasEfectivo.id });
  return fila!.id;
}

/**
 * Cuentas con su saldo actual.
 *
 * El saldo sale de sumar los movimientos, no de una columna que haya que
 * mantener: una columna de saldo se desincroniza en cuanto alguien inserta un
 * movimiento sin actualizarla, y entonces nadie sabe cuál de las dos cifras
 * creer.
 */
export async function cuentasConSaldo(db: Db) {
  const filas = (await db.execute(sql`
    SELECT c.id, c.codigo, c.nombre, c.tipo, c.moneda, c.cuenta_contable,
           c.banco, c.numero_cuenta, c.fondo_fijo::text AS fondo_fijo, c.activa,
           coalesce(sum(CASE WHEN m.sentido = 'ingreso' THEN m.importe
                             ELSE -m.importe END), 0)::text AS saldo,
           count(m.id) FILTER (WHERE m.conciliado_en IS NULL)::int AS sin_conciliar
    FROM cuentas_efectivo c
    LEFT JOIN movimientos_efectivo m ON m.cuenta_id = c.id
    GROUP BY c.id
    ORDER BY c.codigo`)) as unknown as {
    id: string;
    codigo: string;
    nombre: string;
    tipo: string;
    moneda: string;
    cuenta_contable: string;
    banco: string | null;
    numero_cuenta: string | null;
    fondo_fijo: string;
    activa: boolean;
    saldo: string;
    sin_conciliar: number;
  }[];
  return [...filas];
}

// ─── Movimientos ──────────────────────────────────────────────────────────

export type DatosMovimiento = {
  cuentaId: string;
  fecha: string;
  sentido: "ingreso" | "egreso";
  concepto: string;
  importe: string;
  referencia?: string;
  terceroId?: string;
  /** Contrapartida contable: 6373 comisiones, 6711 intereses, 759 otros… */
  cuentaContrapartida: string;
  centroCostoId?: string;
};

/**
 * Registra un movimiento manual y lo contabiliza.
 *
 * Es para lo que no viene de otro módulo: comisiones, ITF, intereses, aportes.
 * Los pagos y las cobranzas generan su movimiento por su cuenta, con su propio
 * asiento, y no pasan por aquí.
 */
/**
 * Anota el movimiento de caja de una operación que **ya se contabilizó**.
 *
 * La usan cobranzas, pagos y cualquier módulo que genere su propio asiento: si
 * llamaran a `registrarMovimientoEfectivo` se contabilizaría dos veces.
 *
 * Existe porque sin ella el módulo de tesorería vivía en otro mundo: la
 * contabilidad decía que el banco se había movido y la pantalla de Caja y
 * Bancos seguía marcando cero. Con dos verdades sobre el mismo dinero la
 * conciliación bancaria no puede funcionar, que es justamente para lo que
 * existe el módulo.
 */
export async function anotarMovimientoDeOtroModulo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    cuentaId: string;
    fecha: string;
    sentido: "ingreso" | "egreso";
    concepto: string;
    importe: string;
    referencia?: string;
    terceroId?: string;
    origenModulo: string;
    origenId: string;
    asientoId?: string;
  },
): Promise<string | null> {
  const [cuenta] = await db
    .select()
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.id, datos.cuentaId))
    .limit(1);
  // Sin cuenta no se anota nada: el asiento ya existe y la operación es válida.
  // Es lo que ocurre mientras la empresa no ha dado de alta sus cuentas.
  if (!cuenta || !cuenta.activa) return null;

  const [mov] = await db
    .insert(movimientosEfectivo)
    .values({
      empresaId,
      cuentaId: datos.cuentaId,
      fecha: datos.fecha,
      sentido: datos.sentido,
      concepto: datos.concepto,
      importe: datos.importe,
      moneda: cuenta.moneda,
      referencia: datos.referencia ?? null,
      terceroId: datos.terceroId ?? null,
      origenModulo: datos.origenModulo,
      origenId: datos.origenId,
      asientoId: datos.asientoId ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: movimientosEfectivo.id });

  return mov!.id;
}

/** Cuentas de efectivo activas, para elegir de dónde sale o entra el dinero. */
export const cuentasParaOperar = (db: Db) =>
  db
    .select({
      id: cuentasEfectivo.id,
      codigo: cuentasEfectivo.codigo,
      nombre: cuentasEfectivo.nombre,
      moneda: cuentasEfectivo.moneda,
      cuentaContable: cuentasEfectivo.cuentaContable,
    })
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.activa, true))
    .orderBy(cuentasEfectivo.codigo);

export async function registrarMovimientoEfectivo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosMovimiento,
): Promise<{ movimientoId: string; asientoId: string }> {
  if (!money.gt(dec(datos.importe), money.ZERO)) {
    throw new TesoreriaInvalida(["el importe debe ser mayor que cero"]);
  }

  const [cuenta] = await db
    .select()
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.id, datos.cuentaId))
    .limit(1);
  if (!cuenta) throw new TesoreriaInvalida(["la cuenta no existe en esta empresa"]);
  if (!cuenta.activa) throw new TesoreriaInvalida([`la cuenta ${cuenta.nombre} está inactiva`]);

  const [mov] = await db
    .insert(movimientosEfectivo)
    .values({
      empresaId,
      cuentaId: datos.cuentaId,
      fecha: datos.fecha,
      sentido: datos.sentido,
      concepto: datos.concepto,
      importe: datos.importe,
      moneda: cuenta.moneda,
      referencia: datos.referencia ?? null,
      terceroId: datos.terceroId ?? null,
      origenModulo: "tesoreria",
      creadoPor: usuarioId,
    })
    .returning({ id: movimientosEfectivo.id });

  const entra = datos.sentido === "ingreso";
  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa: datos.concepto,
    moneda: cuenta.moneda,
    tipoCambio: "1",
    origenModulo: "tesoreria",
    origenId: mov!.id,
    lineas: [
      entra
        ? { cuenta: cuenta.cuentaContable, glosa: datos.concepto, debe: datos.importe }
        : { cuenta: cuenta.cuentaContable, glosa: datos.concepto, haber: datos.importe },
      entra
        ? {
            cuenta: datos.cuentaContrapartida,
            glosa: datos.concepto,
            haber: datos.importe,
            ...(datos.terceroId ? { anexoId: datos.terceroId } : {}),
            ...(datos.centroCostoId ? { centroCostoId: datos.centroCostoId } : {}),
          }
        : {
            cuenta: datos.cuentaContrapartida,
            glosa: datos.concepto,
            debe: datos.importe,
            ...(datos.terceroId ? { anexoId: datos.terceroId } : {}),
            ...(datos.centroCostoId ? { centroCostoId: datos.centroCostoId } : {}),
          },
    ],
  });

  await db
    .update(movimientosEfectivo)
    .set({ asientoId })
    .where(eq(movimientosEfectivo.id, mov!.id));

  return { movimientoId: mov!.id, asientoId };
}

/**
 * Movimientos de una cuenta, los últimos 500.
 *
 * Los **últimos**, no los primeros: con el orden ascendente, una cuenta con más
 * de quinientos movimientos mostraba los más viejos y escondía sin avisar los
 * de esta semana, que son los que se miran. Se devuelven en orden cronológico,
 * que es como se lee un libro de caja.
 */
export const movimientosDe = async (
  db: Db,
  cuentaId: string,
  rango?: { desde?: string; hasta?: string },
) => {
  const cond = [eq(movimientosEfectivo.cuentaId, cuentaId)];
  if (rango?.desde) cond.push(sql`${movimientosEfectivo.fecha} >= ${rango.desde}`);
  if (rango?.hasta) cond.push(sql`${movimientosEfectivo.fecha} <= ${rango.hasta}`);
  const filas = db
    .select({
      id: movimientosEfectivo.id,
      fecha: movimientosEfectivo.fecha,
      sentido: movimientosEfectivo.sentido,
      concepto: movimientosEfectivo.concepto,
      importe: movimientosEfectivo.importe,
      referencia: movimientosEfectivo.referencia,
      origenModulo: movimientosEfectivo.origenModulo,
      // El origen y el asiento viajan en la consulta: son lo que permite ir
      // del extracto del banco a la cobranza que lo produjo, y de ahí a su
      // asiento. Sin eso, conciliar es adivinar.
      origenId: movimientosEfectivo.origenId,
      asientoId: movimientosEfectivo.asientoId,
      conciliadoEn: movimientosEfectivo.conciliadoEn,
      tercero: terceros.razonSocial,
    })
    .from(movimientosEfectivo)
    .leftJoin(terceros, eq(terceros.id, movimientosEfectivo.terceroId))
    .where(and(...cond))
    .orderBy(desc(movimientosEfectivo.fecha), desc(movimientosEfectivo.creadoEn))
    .limit(500);
  return (await filas).reverse();
};

// ─── Conciliación bancaria ────────────────────────────────────────────────

export type LineaExtracto = {
  fecha: string;
  descripcion: string;
  /** Positivo si entra, negativo si sale. */
  importe: string;
  referencia?: string;
  saldo?: string;
};

/** Importa las líneas del extracto que entrega el banco. */
export async function importarExtracto(
  db: Db,
  empresaId: string,
  usuarioId: string,
  cuentaId: string,
  lineas: LineaExtracto[],
): Promise<{ importadas: number }> {
  if (lineas.length === 0) throw new TesoreriaInvalida(["el extracto está vacío"]);

  await db.insert(extractoBancario).values(
    lineas.map((l) => ({
      empresaId,
      cuentaId,
      fecha: l.fecha,
      descripcion: l.descripcion,
      importe: l.importe,
      referencia: l.referencia ?? null,
      saldo: l.saldo ?? null,
      creadoPor: usuarioId,
    })),
  );
  return { importadas: lineas.length };
}

export type Emparejamiento = {
  extractoId: string;
  movimientoId: string;
  /** Por qué se propuso: exacta, por referencia o aproximada. */
  motivo: "referencia" | "exacta" | "aproximada";
};

/**
 * Propone parejas entre el extracto y el libro auxiliar.
 *
 * Tres criterios, en orden de confianza. La referencia es la más fiable: si el
 * número de operación coincide, es el mismo movimiento. Después el par exacto
 * de fecha e importe. Por último, el mismo importe con hasta tres días de
 * diferencia, que cubre el desfase entre cuándo se emitió el cheque y cuándo lo
 * cobraron.
 *
 * La propuesta no concilia nada: la confirma una persona. Aparear automático
 * lo que no es seguro esconde justamente los errores que la conciliación busca.
 */
export async function proponerConciliacion(
  db: Db,
  cuentaId: string,
): Promise<Emparejamiento[]> {
  const extracto = await db
    .select()
    .from(extractoBancario)
    .where(and(eq(extractoBancario.cuentaId, cuentaId), isNull(extractoBancario.movimientoId)))
    .orderBy(asc(extractoBancario.fecha));

  const movimientos = await db
    .select()
    .from(movimientosEfectivo)
    .where(
      and(eq(movimientosEfectivo.cuentaId, cuentaId), isNull(movimientosEfectivo.conciliadoEn)),
    )
    .orderBy(asc(movimientosEfectivo.fecha));

  const propuestas: Emparejamiento[] = [];
  const usados = new Set<string>();

  const importeDelMovimiento = (m: (typeof movimientos)[number]): Dec =>
    m.sentido === "ingreso" ? dec(m.importe) : money.neg(dec(m.importe));

  const diasEntre = (a: string, b: string) =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

  for (const criterio of ["referencia", "exacta", "aproximada"] as const) {
    for (const e of extracto) {
      if (propuestas.some((p) => p.extractoId === e.id)) continue;

      const candidato = movimientos.find((m) => {
        if (usados.has(m.id)) return false;
        if (!money.eq(importeDelMovimiento(m), dec(e.importe))) return false;

        if (criterio === "referencia") {
          return !!e.referencia && !!m.referencia && e.referencia === m.referencia;
        }
        if (criterio === "exacta") return m.fecha === e.fecha;
        return diasEntre(m.fecha, e.fecha) <= 3;
      });

      if (candidato) {
        usados.add(candidato.id);
        propuestas.push({ extractoId: e.id, movimientoId: candidato.id, motivo: criterio });
      }
    }
  }

  return propuestas;
}

/** Confirma las parejas que una persona revisó. */
export async function confirmarConciliacion(
  db: Db,
  parejas: { extractoId: string; movimientoId: string }[],
  fecha: string,
): Promise<{ conciliados: number }> {
  for (const p of parejas) {
    await db
      .update(movimientosEfectivo)
      .set({ conciliadoEn: fecha, extractoId: p.extractoId })
      .where(eq(movimientosEfectivo.id, p.movimientoId));
    await db
      .update(extractoBancario)
      .set({ movimientoId: p.movimientoId })
      .where(eq(extractoBancario.id, p.extractoId));
  }
  return { conciliados: parejas.length };
}

export type ResumenConciliacion = {
  saldoLibro: Dec;
  saldoBanco: Dec;
  diferencia: Dec;
  /** Movimientos propios que el banco todavía no reconoce. */
  enTransito: { id: string; fecha: string; concepto: string; importe: string; sentido: string }[];
  /** Cargos y abonos del banco que la empresa no registró. */
  noRegistrados: { id: string; fecha: string; descripcion: string; importe: string }[];
};

/**
 * Estado de la conciliación de una cuenta.
 *
 * `diferencia` debe explicarse enteramente por lo que hay en tránsito y por lo
 * no registrado. Si sobra algo después de eso, hay un error real.
 */
export async function estadoConciliacion(
  db: Db,
  cuentaId: string,
  hasta?: string,
): Promise<ResumenConciliacion> {
  const corte = hasta ? sql`AND fecha <= ${hasta}` : sql``;

  const [libro] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN sentido = 'ingreso' THEN importe ELSE -importe END), 0)::text AS saldo
    FROM movimientos_efectivo WHERE cuenta_id = ${cuentaId} ${corte}`)) as unknown as [
    { saldo: string },
  ];

  // El saldo del banco es el que declara la última línea del extracto; si no lo
  // trae, se acumulan los importes.
  const [banco] = (await db.execute(sql`
    SELECT coalesce(
      (SELECT saldo::text FROM extracto_bancario
       WHERE cuenta_id = ${cuentaId} AND saldo IS NOT NULL ${corte}
       ORDER BY fecha DESC, creado_en DESC LIMIT 1),
      (SELECT coalesce(sum(importe), 0)::text FROM extracto_bancario
       WHERE cuenta_id = ${cuentaId} ${corte})
    ) AS saldo`)) as unknown as [{ saldo: string }];

  const enTransito = (await db.execute(sql`
    SELECT id, fecha::text, concepto, importe::text, sentido
    FROM movimientos_efectivo
    WHERE cuenta_id = ${cuentaId} AND conciliado_en IS NULL ${corte}
    ORDER BY fecha`)) as unknown as ResumenConciliacion["enTransito"];

  const noRegistrados = (await db.execute(sql`
    SELECT id, fecha::text, descripcion, importe::text
    FROM extracto_bancario
    WHERE cuenta_id = ${cuentaId} AND movimiento_id IS NULL ${corte}
    ORDER BY fecha`)) as unknown as ResumenConciliacion["noRegistrados"];

  const saldoLibro = dec(libro?.saldo);
  const saldoBanco = dec(banco?.saldo);

  return {
    saldoLibro,
    saldoBanco,
    diferencia: money.sub(saldoBanco, saldoLibro),
    enTransito: [...enTransito],
    noRegistrados: [...noRegistrados],
  };
}

// ─── Arqueo de caja ───────────────────────────────────────────────────────

/**
 * Registra un arqueo.
 *
 * Si hay diferencia se contabiliza: un faltante es un gasto y un sobrante un
 * ingreso. Dejarla sin asentar haría que el saldo contable y el real se
 * separaran para siempre, que es justo lo que el arqueo viene a evitar.
 */
export async function registrarArqueo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { cuentaId: string; fecha: string; saldoContado: string; observaciones?: string },
): Promise<{ arqueoId: string; saldoLibro: string; diferencia: string; asientoId: string | null }> {
  const [cuenta] = await db
    .select()
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.id, datos.cuentaId))
    .limit(1);
  if (!cuenta) throw new TesoreriaInvalida(["la cuenta no existe en esta empresa"]);

  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN sentido = 'ingreso' THEN importe ELSE -importe END), 0)::text AS saldo
    FROM movimientos_efectivo
    WHERE cuenta_id = ${datos.cuentaId} AND fecha <= ${datos.fecha}`)) as unknown as [
    { saldo: string },
  ];

  const saldoLibro = dec(fila?.saldo);
  const contado = dec(datos.saldoContado);
  const diferencia = money.sub(contado, saldoLibro);

  const [arqueo] = await db
    .insert(arqueos)
    .values({
      empresaId,
      cuentaId: datos.cuentaId,
      fecha: datos.fecha,
      saldoLibro: txt2(saldoLibro),
      saldoContado: txt2(contado),
      diferencia: txt2(diferencia),
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: arqueos.id });

  let asientoId: string | null = null;

  if (!money.isZero(diferencia)) {
    const sobrante = money.gt(diferencia, money.ZERO);
    const importe = txt2(sobrante ? diferencia : money.neg(diferencia));
    const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
    const cuentas = await cuentasDe(db);

    asientoId = await asentar(db, empresaId, usuarioId, {
      periodo,
      fecha: datos.fecha,
      subdiario: "01",
      glosa: `Arqueo de ${cuenta.nombre}: ${sobrante ? "sobrante" : "faltante"}`,
      moneda: cuenta.moneda,
      tipoCambio: "1",
      origenModulo: "arqueos",
      origenId: arqueo!.id,
      lineas: sobrante
        ? [
            { cuenta: cuenta.cuentaContable, glosa: "Sobrante de arqueo", debe: importe },
            // Un sobrante es un ingreso de gestión hasta que se identifique.
            { cuenta: cuentas.get("sobrante_caja"), glosa: "Sobrante de caja", haber: importe },
          ]
        : [
            // Un faltante es una pérdida; si después aparece el responsable, se
            // reclasifica a una cuenta por cobrar.
            { cuenta: cuentas.get("faltante_caja"), glosa: "Faltante de caja", debe: importe },
            { cuenta: cuenta.cuentaContable, glosa: "Faltante de arqueo", haber: importe },
          ],
    });

    // El ajuste también mueve el libro auxiliar: si no, el próximo arqueo
    // volvería a encontrar la misma diferencia.
    await db.insert(movimientosEfectivo).values({
      empresaId,
      cuentaId: datos.cuentaId,
      fecha: datos.fecha,
      sentido: sobrante ? "ingreso" : "egreso",
      concepto: `Ajuste por arqueo del ${datos.fecha}`,
      importe,
      moneda: cuenta.moneda,
      origenModulo: "arqueos",
      origenId: arqueo!.id,
      asientoId,
      creadoPor: usuarioId,
    });
  }

  return {
    arqueoId: arqueo!.id,
    saldoLibro: txt2(saldoLibro),
    diferencia: txt2(diferencia),
    asientoId,
  };
}

export const listarArqueos = (db: Db, cuentaId?: string) =>
  db
    .select({
      id: arqueos.id,
      fecha: arqueos.fecha,
      cuenta: cuentasEfectivo.nombre,
      saldoLibro: arqueos.saldoLibro,
      saldoContado: arqueos.saldoContado,
      diferencia: arqueos.diferencia,
      observaciones: arqueos.observaciones,
    })
    .from(arqueos)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, arqueos.cuentaId))
    .where(cuentaId ? eq(arqueos.cuentaId, cuentaId) : undefined)
    .orderBy(desc(arqueos.fecha))
    .limit(200);

// ─── Libro de bancos ──────────────────────────────────────────────────────

export type LineaLibroBancos = {
  fecha: string;
  concepto: string;
  referencia: string | null;
  tercero: string | null;
  origen: string | null;
  ingreso: string | null;
  egreso: string | null;
  saldo: string;
  conciliado: boolean;
};

export type LibroBancos = {
  cuenta: { id: string; codigo: string; nombre: string; moneda: string; cuentaContable: string; banco: string | null; numeroCuenta: string | null };
  desde: string;
  hasta: string;
  saldoInicial: string;
  ingresos: string;
  egresos: string;
  saldoFinal: string;
  /** Saldo de la cuenta contable a la misma fecha, para contrastar. */
  saldoContable: string;
  diferencia: string;
  cuadra: boolean;
  sinConciliar: number;
  lineas: LineaLibroBancos[];
  avisos: string[];
};

/**
 * Libro de bancos de una cuenta y un periodo.
 *
 * Es el auxiliar que se imprime y se archiva: saldo inicial, movimientos del
 * periodo con el saldo corriendo, y saldo final.
 *
 * Lo que lo hace útil y no un simple listado es la última columna del resumen:
 * el **contraste contra la cuenta contable**. El libro sale de
 * `movimientos_efectivo` y el mayor sale de los asientos; son dos caminos
 * distintos para el mismo dinero y sólo coinciden si todos los módulos anotan
 * las dos cosas. Cuando no coinciden hay que enterarse aquí, no tres meses
 * después al cerrar el ejercicio.
 *
 * El saldo contable se toma de la cuenta del PCGE que la cuenta de efectivo
 * declara. Si dos cuentas de efectivo comparten la misma —dos cuentas
 * corrientes en la 1041, que es lo normal— el contraste es del conjunto y se
 * avisa, porque comparar una contra el total daría una diferencia falsa.
 */
export async function libroBancos(
  db: Db,
  cuentaId: string,
  rango: { desde: string; hasta: string },
): Promise<LibroBancos | null> {
  const [cuenta] = await db
    .select({
      id: cuentasEfectivo.id,
      codigo: cuentasEfectivo.codigo,
      nombre: cuentasEfectivo.nombre,
      moneda: cuentasEfectivo.moneda,
      cuentaContable: cuentasEfectivo.cuentaContable,
      banco: cuentasEfectivo.banco,
      numeroCuenta: cuentasEfectivo.numeroCuenta,
    })
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.id, cuentaId))
    .limit(1);
  if (!cuenta) return null;

  const [inicial] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN sentido = 'ingreso' THEN importe ELSE -importe END), 0)::text
             AS saldo
    FROM movimientos_efectivo
    WHERE cuenta_id = ${cuentaId} AND fecha < ${rango.desde}`)) as unknown as [{ saldo: string }];

  const filas = (await db.execute(sql`
    SELECT m.fecha::text AS fecha, m.concepto, m.referencia, m.sentido,
           m.importe::text AS importe, m.origen_modulo, t.razon_social AS tercero,
           m.conciliado_en IS NOT NULL AS conciliado
    FROM movimientos_efectivo m
    LEFT JOIN terceros t ON t.id = m.tercero_id
    WHERE m.cuenta_id = ${cuentaId}
      AND m.fecha >= ${rango.desde} AND m.fecha <= ${rango.hasta}
    ORDER BY m.fecha, m.creado_en`)) as unknown as {
    fecha: string;
    concepto: string;
    referencia: string | null;
    sentido: string;
    importe: string;
    origen_modulo: string | null;
    tercero: string | null;
    conciliado: boolean;
  }[];

  let saldo = money.dec(inicial.saldo);
  let ingresos = money.ZERO;
  let egresos = money.ZERO;
  let sinConciliar = 0;

  const lineas: LineaLibroBancos[] = [...filas].map((f) => {
    const importe = money.dec(f.importe);
    const entra = f.sentido === "ingreso";
    if (entra) {
      saldo = money.add(saldo, importe);
      ingresos = money.add(ingresos, importe);
    } else {
      saldo = money.sub(saldo, importe);
      egresos = money.add(egresos, importe);
    }
    if (!f.conciliado) sinConciliar++;
    return {
      fecha: f.fecha,
      concepto: f.concepto,
      referencia: f.referencia,
      tercero: f.tercero,
      origen: f.origen_modulo,
      ingreso: entra ? money.toString(importe, 2) : null,
      egreso: entra ? null : money.toString(importe, 2),
      saldo: money.toString(saldo, 2),
      conciliado: f.conciliado,
    };
  });

  // El mayor de la cuenta contable hasta la misma fecha. Sólo asientos
  // contabilizados: un borrador todavía no es contabilidad.
  const [mayor] = (await db.execute(sql`
    SELECT coalesce(sum(l.debe_funcional - l.haber_funcional), 0)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.estado IN ('contabilizado', 'extornado')
      AND a.fecha <= ${rango.hasta}
      AND l.cuenta = ${cuenta.cuentaContable}`)) as unknown as [{ saldo: string }];

  const [compartida] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM cuentas_efectivo
    WHERE cuenta_contable = ${cuenta.cuentaContable}`)) as unknown as [{ n: number }];

  const saldoContable = money.dec(mayor.saldo);
  const diferencia = money.sub(saldo, saldoContable);

  const avisos: string[] = [];
  if (compartida.n > 1) {
    avisos.push(
      `La cuenta contable ${cuenta.cuentaContable} la comparten ${compartida.n} cuentas de ` +
        `efectivo, así que el saldo contable es el de todas juntas y la diferencia no es comparable.`,
    );
  } else if (!money.isZero(money.round(diferencia, 2))) {
    avisos.push(
      `El libro y la cuenta ${cuenta.cuentaContable} difieren en ` +
        `${money.toString(diferencia, 2)}: hay un movimiento sin asiento o un asiento sin movimiento.`,
    );
  }
  if (sinConciliar > 0) {
    avisos.push(
      `${sinConciliar} ${sinConciliar === 1 ? "movimiento" : "movimientos"} sin conciliar con el ` +
        `extracto del banco en este periodo.`,
    );
  }

  return {
    cuenta,
    desde: rango.desde,
    hasta: rango.hasta,
    saldoInicial: money.toString(money.dec(inicial.saldo), 2),
    ingresos: money.toString(ingresos, 2),
    egresos: money.toString(egresos, 2),
    saldoFinal: money.toString(saldo, 2),
    saldoContable: money.toString(saldoContable, 2),
    diferencia: money.toString(diferencia, 2),
    // Con la cuenta compartida no se puede afirmar que cuadre ni que no.
    cuadra: compartida.n > 1 || money.isZero(money.round(diferencia, 2)),
    sinConciliar,
    lineas,
    avisos,
  };
}
