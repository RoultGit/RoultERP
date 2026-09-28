/**
 * Presupuesto y análisis presupuestal.
 *
 * Lo que la empresa **planea** gastar e ingresar, por centro de costo y por
 * mes, contra lo que de verdad ocurrió. No es contabilidad: no genera asientos
 * ni toca saldos. Su único trabajo es servir de vara de medir.
 *
 * Es lo que convierte el resultado por obra en una herramienta de gestión.
 * Saber que una obra perdió 3 000 soles dice poco; saber que perdió 3 000 sobre
 * un plan de ganar 5 000 dice qué hacer y a quién preguntarle.
 *
 * Dos decisiones que sostienen el módulo:
 *
 * - **Lo ejecutado sale del mayor**, igual que todo lo demás. Un presupuesto
 *   que se compara contra cifras propias no compara nada.
 * - **Lo gastado fuera de presupuesto se denuncia.** Un análisis que sólo mira
 *   las partidas presupuestadas deja fuera justo lo que nadie planeó, que suele
 *   ser lo que más duele. Aparece en `sinPresupuestar`.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { presupuestos, presupuestoLineas, centrosCosto } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class PresupuestoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "PresupuestoInvalido");
  }
}

export const ESTADO_PRESUPUESTO = {
  BORRADOR: "borrador",
  APROBADO: "aprobado",
  CERRADO: "cerrado",
} as const;

// ─── Mantenimiento ────────────────────────────────────────────────────────

export type PartidaPresupuesto = {
  centroCostoId?: string | null;
  /** Prefijo de cuenta: «63», «6351», «70». */
  cuenta: string;
  /** 1 a 12. Sin mes, el importe se reparte por doceavas partes. */
  mes?: number;
  importe: string;
};

export type DatosPresupuesto = {
  codigo: string;
  nombre: string;
  ejercicio: number;
  observaciones?: string;
  partidas: PartidaPresupuesto[];
};

/**
 * Reparte un importe anual en doce meses sin perder un céntimo.
 *
 * Doceavas partes exactas casi nunca existen —10 000 / 12 no es redondo— y
 * repartir por redondeo deja la suma del año descuadrada respecto del total que
 * alguien aprobó. Con resto mayor, la suma vuelve a ser el anual.
 */
export function doceavas(anual: Dec): Dec[] {
  return money.distribute(anual, Array.from({ length: 12 }, () => money.dec("1")), 2);
}

/**
 * Crea o reemplaza un presupuesto.
 *
 * Reemplaza las partidas enteras, como los formatos: editarlas una a una dejaba
 * presupuestos a medio cambiar cuando alguien cerraba la pantalla antes de
 * tiempo. Un presupuesto aprobado no se toca: para eso está el estado.
 */
export async function guardarPresupuesto(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPresupuesto,
): Promise<string> {
  const motivos: string[] = [];
  if (!datos.codigo.trim()) motivos.push("el presupuesto necesita un código");
  if (!datos.nombre.trim()) motivos.push("el presupuesto necesita un nombre");
  if (!Number.isInteger(datos.ejercicio) || datos.ejercicio < 2000 || datos.ejercicio > 2100) {
    motivos.push("el ejercicio debe ser un año entre 2000 y 2100");
  }
  if (datos.partidas.length === 0) motivos.push("un presupuesto necesita al menos una partida");

  for (const [i, p] of datos.partidas.entries()) {
    if (!p.cuenta.trim()) motivos.push(`partida ${i + 1}: indique la cuenta`);
    if (!/^\d+$/.test(p.cuenta.trim())) {
      motivos.push(`partida ${i + 1}: la cuenta «${p.cuenta}» no es un prefijo numérico`);
    }
    if (p.mes !== undefined && (p.mes < 1 || p.mes > 12)) {
      motivos.push(`partida ${i + 1}: el mes debe estar entre 1 y 12`);
    }
  }
  if (motivos.length) throw new PresupuestoInvalido(motivos);

  const [existente] = await db
    .select({ id: presupuestos.id, estado: presupuestos.estado })
    .from(presupuestos)
    .where(eq(presupuestos.codigo, datos.codigo.trim()))
    .limit(1);
  if (existente && existente.estado !== ESTADO_PRESUPUESTO.BORRADOR) {
    throw new PresupuestoInvalido([
      `el presupuesto ${datos.codigo.trim()} está ${existente.estado} y ya no se edita`,
    ]);
  }

  const [cab] = await db
    .insert(presupuestos)
    .values({
      empresaId,
      codigo: datos.codigo.trim(),
      nombre: datos.nombre.trim(),
      ejercicio: datos.ejercicio,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .onConflictDoUpdate({
      target: [presupuestos.empresaId, presupuestos.codigo],
      set: {
        nombre: datos.nombre.trim(),
        ejercicio: datos.ejercicio,
        observaciones: datos.observaciones ?? null,
      },
    })
    .returning({ id: presupuestos.id });
  const presupuestoId = cab!.id;

  await db.delete(presupuestoLineas).where(eq(presupuestoLineas.presupuestoId, presupuestoId));

  // Una partida sin mes es anual y se reparte en doce. Acumular en un mapa
  // antes de insertar evita chocar con el índice único cuando alguien mete dos
  // veces la misma cuenta y centro: se suman, que es lo que quería decir.
  const acumulado = new Map<string, { centro: string | null; cuenta: string; mes: number; importe: Dec }>();
  for (const p of datos.partidas) {
    const centro = p.centroCostoId ?? null;
    const cuenta = p.cuenta.trim();
    const importes =
      p.mes === undefined
        ? doceavas(dec(p.importe)).map((v, i) => ({ mes: i + 1, importe: v }))
        : [{ mes: p.mes, importe: dec(p.importe) }];

    for (const { mes, importe } of importes) {
      const clave = `${centro ?? ""}|${cuenta}|${mes}`;
      const previo = acumulado.get(clave);
      acumulado.set(clave, {
        centro,
        cuenta,
        mes,
        importe: money.add(previo?.importe ?? money.ZERO, importe),
      });
    }
  }

  const filas = [...acumulado.values()].filter((f) => !money.isZero(f.importe));
  if (filas.length > 0) {
    await db.insert(presupuestoLineas).values(
      filas.map((f) => ({
        empresaId,
        presupuestoId,
        centroCostoId: f.centro,
        cuenta: f.cuenta,
        mes: f.mes,
        importe: txt2(f.importe),
        creadoPor: usuarioId,
      })),
    );
  }

  return presupuestoId;
}

/** Aprueba el presupuesto: a partir de aquí es la vara de medir y no se edita. */
export async function aprobarPresupuesto(
  db: Db,
  presupuestoId: string,
  usuarioId: string,
): Promise<void> {
  const [p] = await db
    .select({ estado: presupuestos.estado })
    .from(presupuestos)
    .where(eq(presupuestos.id, presupuestoId))
    .limit(1);
  if (!p) throw new PresupuestoInvalido(["el presupuesto no existe"]);
  if (p.estado !== ESTADO_PRESUPUESTO.BORRADOR) {
    throw new PresupuestoInvalido([`el presupuesto está ${p.estado} y ya no se aprueba`]);
  }
  await db
    .update(presupuestos)
    .set({
      estado: ESTADO_PRESUPUESTO.APROBADO,
      aprobadoPor: usuarioId,
      aprobadoEn: new Date(),
    })
    .where(eq(presupuestos.id, presupuestoId));
}

/**
 * Reabre un presupuesto aprobado.
 *
 * Existe porque un plan que no se puede corregir se abandona: a mitad de año
 * cambian los supuestos, y la alternativa a reabrirlo es que nadie vuelva a
 * mirarlo. Queda constancia de que se aprobó antes.
 */
export async function reabrirPresupuesto(db: Db, presupuestoId: string): Promise<void> {
  const [p] = await db
    .select({ estado: presupuestos.estado })
    .from(presupuestos)
    .where(eq(presupuestos.id, presupuestoId))
    .limit(1);
  if (!p) throw new PresupuestoInvalido(["el presupuesto no existe"]);
  if (p.estado === ESTADO_PRESUPUESTO.CERRADO) {
    throw new PresupuestoInvalido(["el presupuesto está cerrado y no se reabre"]);
  }
  await db
    .update(presupuestos)
    .set({ estado: ESTADO_PRESUPUESTO.BORRADOR })
    .where(eq(presupuestos.id, presupuestoId));
}

export async function cerrarPresupuesto(db: Db, presupuestoId: string): Promise<void> {
  const [p] = await db
    .select({ estado: presupuestos.estado })
    .from(presupuestos)
    .where(eq(presupuestos.id, presupuestoId))
    .limit(1);
  if (!p) throw new PresupuestoInvalido(["el presupuesto no existe"]);
  if (p.estado !== ESTADO_PRESUPUESTO.APROBADO) {
    throw new PresupuestoInvalido(["sólo se cierra un presupuesto aprobado"]);
  }
  await db
    .update(presupuestos)
    .set({ estado: ESTADO_PRESUPUESTO.CERRADO })
    .where(eq(presupuestos.id, presupuestoId));
}

export async function eliminarPresupuesto(db: Db, presupuestoId: string): Promise<void> {
  const [p] = await db
    .select({ estado: presupuestos.estado })
    .from(presupuestos)
    .where(eq(presupuestos.id, presupuestoId))
    .limit(1);
  if (!p) throw new PresupuestoInvalido(["el presupuesto no existe"]);
  if (p.estado !== ESTADO_PRESUPUESTO.BORRADOR) {
    throw new PresupuestoInvalido([
      `el presupuesto está ${p.estado}: reábralo antes de eliminarlo`,
    ]);
  }
  await db.delete(presupuestos).where(eq(presupuestos.id, presupuestoId));
}

export const listarPresupuestos = (db: Db, ejercicio?: number) =>
  db
    .select({
      id: presupuestos.id,
      codigo: presupuestos.codigo,
      nombre: presupuestos.nombre,
      ejercicio: presupuestos.ejercicio,
      estado: presupuestos.estado,
      partidas: sql<number>`count(${presupuestoLineas.id})`,
      total: sql<string>`coalesce(sum(${presupuestoLineas.importe}), 0)`,
    })
    .from(presupuestos)
    .leftJoin(presupuestoLineas, eq(presupuestoLineas.presupuestoId, presupuestos.id))
    .where(ejercicio ? eq(presupuestos.ejercicio, ejercicio) : sql`true`)
    .groupBy(
      presupuestos.id,
      presupuestos.codigo,
      presupuestos.nombre,
      presupuestos.ejercicio,
      presupuestos.estado,
    )
    .orderBy(desc(presupuestos.ejercicio), asc(presupuestos.codigo));

export async function cargarPresupuesto(db: Db, presupuestoId: string) {
  const [cabecera] = await db
    .select()
    .from(presupuestos)
    .where(eq(presupuestos.id, presupuestoId))
    .limit(1);
  if (!cabecera) throw new PresupuestoInvalido(["el presupuesto no existe"]);

  const partidas = await db
    .select({
      id: presupuestoLineas.id,
      centroCostoId: presupuestoLineas.centroCostoId,
      centro: centrosCosto.nombre,
      centroCodigo: centrosCosto.codigo,
      cuenta: presupuestoLineas.cuenta,
      mes: presupuestoLineas.mes,
      importe: presupuestoLineas.importe,
    })
    .from(presupuestoLineas)
    .leftJoin(centrosCosto, eq(centrosCosto.id, presupuestoLineas.centroCostoId))
    .where(eq(presupuestoLineas.presupuestoId, presupuestoId))
    .orderBy(asc(centrosCosto.codigo), asc(presupuestoLineas.cuenta), asc(presupuestoLineas.mes));

  return { cabecera, partidas };
}

// ─── Análisis presupuestal ────────────────────────────────────────────────

export type LineaEjecucion = {
  centroCostoId: string | null;
  centro: string;
  cuenta: string;
  presupuestado: string;
  ejecutado: string;
  /** Presupuestado menos ejecutado. Positivo es holgura; negativo, exceso. */
  desviacion: string;
  /** Ejecutado sobre presupuestado, en porcentaje. */
  avance: string;
  /** Se pasó de lo presupuestado. */
  excedido: boolean;
};

export type EjecucionPresupuestal = {
  presupuesto: { id: string; codigo: string; nombre: string; ejercicio: number; estado: string };
  /** Hasta qué mes se mide. 12 es el año entero. */
  hastaMes: number;
  lineas: LineaEjecucion[];
  totales: { presupuestado: string; ejecutado: string; desviacion: string };
  /**
   * Gasto e ingreso real que ninguna partida presupuestó.
   *
   * Un análisis que sólo mira lo presupuestado deja fuera justo lo que nadie
   * planeó, que suele ser lo que más duele. Aquí sale a la luz.
   */
  sinPresupuestar: { centroCostoId: string | null; centro: string; cuenta: string; ejecutado: string }[];
  totalSinPresupuestar: string;
};

/**
 * Compara el plan con lo que ocurrió.
 *
 * Lo ejecutado sale del mayor, no de una cifra propia: un presupuesto que se
 * compara contra sus propios números no compara nada.
 *
 * Los ingresos y los gastos se miden ambos en positivo —el gasto por su cargo,
 * el ingreso por su abono— para que «ejecutado sobre presupuestado» signifique
 * lo mismo en los dos casos. Sin eso, un ingreso presupuestado en 10 000 y
 * cobrado en 12 000 saldría con avance negativo.
 */
export async function ejecucionPresupuestal(
  db: Db,
  presupuestoId: string,
  opciones?: { hastaMes?: number; centroCostoId?: string },
): Promise<EjecucionPresupuestal> {
  const { cabecera, partidas } = await cargarPresupuesto(db, presupuestoId);
  const hastaMes = Math.min(Math.max(opciones?.hastaMes ?? 12, 1), 12);

  const desde = `${cabecera.ejercicio}01`;
  const hasta = `${cabecera.ejercicio}${String(hastaMes).padStart(2, "0")}`;

  /*
   * Saldos reales del ejercicio, por cuenta y centro de costo.
   *
   * El signo se normaliza aquí: los gastos (6) van por debe − haber y los
   * ingresos (7) por haber − debe, de modo que los dos salgan en positivo
   * cuando ocurren.
   */
  const reales = (await db.execute(sql`
    SELECT l.cuenta, l.centro_costo_id::text AS centro_id,
           coalesce(c.nombre, 'Sin centro de costo') AS centro,
           sum(CASE WHEN left(l.cuenta, 1) = '7'
                    THEN l.haber_funcional - l.debe_funcional
                    ELSE l.debe_funcional - l.haber_funcional END)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    LEFT JOIN centros_costo c ON c.id = l.centro_costo_id
    WHERE a.periodo BETWEEN ${desde} AND ${hasta}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) IN ('6', '7')
      -- La 79 es la contrapartida del asiento de destino, no un ingreso: si
      -- entrara, el presupuesto de ingresos parecería cumplido de golpe el día
      -- que el contador reclasifica los gastos.
      AND left(l.cuenta, 2) <> '79'
    GROUP BY l.cuenta, l.centro_costo_id, c.nombre`)) as unknown as {
    cuenta: string;
    centro_id: string | null;
    centro: string;
    saldo: string;
  }[];

  const movimientos = [...reales].filter(
    (r) => !opciones?.centroCostoId || r.centro_id === opciones.centroCostoId,
  );

  // Una partida agrupa los meses hasta el corte; el detalle mensual sigue en la
  // tabla, pero el análisis se lee por cuenta y centro.
  const plan = new Map<string, { centroId: string | null; centro: string; cuenta: string; importe: Dec }>();
  for (const p of partidas) {
    if (p.mes > hastaMes) continue;
    if (opciones?.centroCostoId && p.centroCostoId !== opciones.centroCostoId) continue;
    const clave = `${p.centroCostoId ?? ""}|${p.cuenta}`;
    const previo = plan.get(clave);
    plan.set(clave, {
      centroId: p.centroCostoId,
      centro: p.centro ?? "Sin centro de costo",
      cuenta: p.cuenta,
      importe: money.add(previo?.importe ?? money.ZERO, dec(p.importe)),
    });
  }

  // Lo ejecutado de una partida es todo lo que cae bajo su prefijo de cuenta en
  // su centro. Se marca lo consumido para saber qué quedó sin presupuestar.
  const consumido = new Set<string>();
  const lineas: LineaEjecucion[] = [...plan.values()]
    .map((p) => {
      let ejecutado = money.ZERO;
      for (const m of movimientos) {
        if (!m.cuenta.startsWith(p.cuenta)) continue;
        if ((m.centro_id ?? null) !== p.centroId) continue;
        consumido.add(`${m.centro_id ?? ""}|${m.cuenta}`);
        ejecutado = money.add(ejecutado, dec(m.saldo));
      }
      const desviacion = money.sub(p.importe, ejecutado);
      return {
        centroCostoId: p.centroId,
        centro: p.centro,
        cuenta: p.cuenta,
        presupuestado: txt2(p.importe),
        ejecutado: txt2(ejecutado),
        desviacion: txt2(desviacion),
        avance: money.isZero(p.importe)
          ? "0.00"
          : money.toString(
              money.round(money.mul(money.div(ejecutado, p.importe), money.dec("100")), 2),
              2,
            ),
        excedido: money.gt(ejecutado, p.importe),
      };
    })
    .sort(
      (a, b) => a.centro.localeCompare(b.centro) || a.cuenta.localeCompare(b.cuenta),
    );

  const sinPresupuestar = movimientos
    .filter((m) => !consumido.has(`${m.centro_id ?? ""}|${m.cuenta}`))
    .filter((m) => !money.isZero(money.round(dec(m.saldo), 2)))
    .map((m) => ({
      centroCostoId: m.centro_id,
      centro: m.centro,
      cuenta: m.cuenta,
      ejecutado: txt2(dec(m.saldo)),
    }))
    .sort((a, b) => a.centro.localeCompare(b.centro) || a.cuenta.localeCompare(b.cuenta));

  const presupuestado = lineas.reduce<Dec>((a, l) => money.add(a, dec(l.presupuestado)), money.ZERO);
  const ejecutado = lineas.reduce<Dec>((a, l) => money.add(a, dec(l.ejecutado)), money.ZERO);

  return {
    presupuesto: {
      id: cabecera.id,
      codigo: cabecera.codigo,
      nombre: cabecera.nombre,
      ejercicio: cabecera.ejercicio,
      estado: cabecera.estado,
    },
    hastaMes,
    lineas,
    totales: {
      presupuestado: txt2(presupuestado),
      ejecutado: txt2(ejecutado),
      desviacion: txt2(money.sub(presupuestado, ejecutado)),
    },
    sinPresupuestar,
    totalSinPresupuestar: txt2(
      sinPresupuestar.reduce<Dec>((a, m) => money.add(a, dec(m.ejecutado)), money.ZERO),
    ),
  };
}
