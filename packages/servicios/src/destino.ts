/**
 * Asiento de destino y estado de resultados por función.
 *
 * El PCGE registra los gastos por **naturaleza** en la clase 6 —personal,
 * servicios, tributos, depreciación— y eso es lo que exige SUNAT en los libros.
 * Pero la pregunta que se hace una gerencia es otra: cuánto costó vender y
 * cuánto administrar. Esa vista es la **funcional**, vive en la clase 9, y se
 * llega a ella con el «asiento de destino»: se cargan las cuentas 92, 94, 95 y
 * 97 y se abona la 79 por el total.
 *
 * Tres propiedades que el módulo garantiza:
 *
 * - **No cambia el resultado.** La clase 9 y la 79 se anulan entre sí, así que
 *   el balance y la utilidad son exactamente los de antes. Lo único que cambia
 *   es cómo se presenta.
 * - **No reclasifica dos veces.** Se mide lo ya destinado y sólo se lleva la
 *   diferencia, de modo que volver a correrlo el mismo mes no duplica nada.
 * - **Lo que no tiene regla se denuncia.** Un gasto sin destino no se reparte
 *   por una regla inventada: aparece en `sinDestino` y el estado por función
 *   avisa de que está incompleto.
 *
 * El costo de ventas (69) no entra: ya está por función —es el costo de lo
 * vendido— y reclasificarlo lo contaría dos veces.
 */
import { asc, eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { asentar, exigirPeriodoAbierto, type LineaAsientoEntrada } from "./contabilidad.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const { reglasDestino, centrosCosto } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class DestinoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "DestinoInvalido");
  }
}

/** Cuenta de contrapartida del asiento de destino. */
export const CUENTA_CARGAS = "791";

/** Las cuatro funciones con las que trabaja una empresa comercial. */
export const FUNCIONES = [
  { cuenta: "92", nombre: "Costo de producción" },
  { cuenta: "94", nombre: "Gastos de administración" },
  { cuenta: "95", nombre: "Gastos de ventas" },
  { cuenta: "97", nombre: "Gastos financieros" },
] as const;

// ─── Reglas ───────────────────────────────────────────────────────────────

export type DatosRegla = {
  /** Prefijo de cuenta de la clase 6. Vacío significa «cualquiera». */
  cuenta?: string | null;
  centroCostoId?: string | null;
  cuentaDestino: string;
};

export async function guardarReglas(
  db: Db,
  empresaId: string,
  usuarioId: string,
  reglas: DatosRegla[],
): Promise<void> {
  const motivos: string[] = [];
  for (const [i, r] of reglas.entries()) {
    if (!r.cuentaDestino.trim()) motivos.push(`regla ${i + 1}: indique la cuenta de destino`);
    if (!/^9\d*$/.test(r.cuentaDestino.trim())) {
      motivos.push(
        `regla ${i + 1}: el destino «${r.cuentaDestino}» no es una cuenta de la clase 9`,
      );
    }
    if (r.cuenta?.trim() && !/^6\d*$/.test(r.cuenta.trim())) {
      motivos.push(`regla ${i + 1}: la cuenta «${r.cuenta}» no es de la clase 6`);
    }
  }
  if (motivos.length) throw new DestinoInvalido(motivos);

  await db.delete(reglasDestino);
  if (reglas.length === 0) return;

  await db.insert(reglasDestino).values(
    reglas.map((r) => ({
      empresaId,
      cuenta: r.cuenta?.trim() || null,
      centroCostoId: r.centroCostoId ?? null,
      cuentaDestino: r.cuentaDestino.trim(),
      creadoPor: usuarioId,
    })),
  );
}

export const listarReglas = (db: Db) =>
  db
    .select({
      id: reglasDestino.id,
      cuenta: reglasDestino.cuenta,
      centroCostoId: reglasDestino.centroCostoId,
      centro: centrosCosto.nombre,
      centroCodigo: centrosCosto.codigo,
      cuentaDestino: reglasDestino.cuentaDestino,
      activa: reglasDestino.activa,
    })
    .from(reglasDestino)
    .leftJoin(centrosCosto, eq(centrosCosto.id, reglasDestino.centroCostoId))
    .orderBy(asc(reglasDestino.cuentaDestino), asc(reglasDestino.cuenta));

/**
 * Elige la regla que se aplica a un gasto.
 *
 * Gana la más específica: nombrar cuenta y centro pesa más que nombrar sólo la
 * cuenta, y entre dos de la misma clase gana la del prefijo más largo. Sin ese
 * orden explícito el destino dependería de cómo estén guardadas las filas, que
 * es una forma silenciosa de que los números cambien solos.
 */
export function elegirRegla<
  T extends { cuenta: string | null; centroCostoId: string | null; cuentaDestino: string },
>(reglas: readonly T[], cuenta: string, centroCostoId: string | null): T | null {
  let mejor: T | null = null;
  let mejorPeso = -1;

  for (const r of reglas) {
    if (r.centroCostoId !== null && r.centroCostoId !== centroCostoId) continue;
    if (r.cuenta !== null && !cuenta.startsWith(r.cuenta)) continue;

    // El centro vale más que cualquier prefijo; entre iguales, el más largo.
    const peso = (r.centroCostoId !== null ? 1000 : 0) + (r.cuenta?.length ?? 0);
    if (peso > mejorPeso) {
      mejor = r;
      mejorPeso = peso;
    }
  }
  return mejor;
}

// ─── Asiento de destino ───────────────────────────────────────────────────

export type VistaDestino = {
  periodo: string;
  /** Por cuenta de la clase 9: lo que corresponde llevar. */
  porFuncion: { cuenta: string; nombre: string; importe: string }[];
  /** Lo que ya se destinó en periodos anteriores o en otra corrida. */
  yaDestinado: string;
  /** Lo que falta por destinar: la diferencia, y lo que se asentaría. */
  pendiente: string;
  detalle: { cuenta: string; centro: string; importe: string; destino: string }[];
  /** Gastos sin regla. No se reparten: se denuncian. */
  sinDestino: { cuenta: string; centro: string; importe: string }[];
  totalSinDestino: string;
};

/**
 * Calcula el asiento de destino sin escribir nada.
 *
 * Es lo que el contador mira antes de contabilizarlo: qué va a cada función y
 * qué se queda fuera por falta de regla.
 */
export async function previsualizarDestino(
  db: Db,
  periodo: string,
): Promise<VistaDestino> {
  if (!/^\d{6}$/.test(periodo)) {
    throw new DestinoInvalido(["el periodo debe tener el formato AAAAMM"]);
  }

  const reglas = await db
    .select({
      cuenta: reglasDestino.cuenta,
      centroCostoId: reglasDestino.centroCostoId,
      cuentaDestino: reglasDestino.cuentaDestino,
    })
    .from(reglasDestino)
    .where(eq(reglasDestino.activa, true));

  // Gasto por naturaleza del periodo, por cuenta y centro.
  const gastos = (await db.execute(sql`
    SELECT l.cuenta, l.centro_costo_id::text AS centro_id,
           coalesce(c.nombre, 'Sin centro de costo') AS centro,
           sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    LEFT JOIN centros_costo c ON c.id = l.centro_costo_id
    WHERE a.periodo = ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) = '6'
      -- El costo de ventas ya está por función: es el costo de lo vendido, no
      -- un gasto por naturaleza pendiente de clasificar. Reclasificarlo lo
      -- contaría dos veces en el estado por función.
      AND left(l.cuenta, 2) <> '69'
    GROUP BY l.cuenta, l.centro_costo_id, c.nombre
    ORDER BY l.cuenta`)) as unknown as {
    cuenta: string;
    centro_id: string | null;
    centro: string;
    saldo: string;
  }[];

  // Lo ya reclasificado: el saldo de la 79 del periodo, que es el total que ya
  // se llevó a la clase 9. Medirlo es lo que impide destinar dos veces.
  const [ya] = (await db.execute(sql`
    SELECT coalesce(sum(l.haber_funcional - l.debe_funcional), 0)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo = ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 2) = '79'`)) as unknown as [{ saldo: string }];

  const porFuncion = new Map<string, Dec>();
  const detalle: VistaDestino["detalle"] = [];
  const sinDestino: VistaDestino["sinDestino"] = [];
  let total = money.ZERO;

  for (const g of [...gastos]) {
    const importe = dec(g.saldo);
    if (money.isZero(money.round(importe, 2))) continue;

    const regla = elegirRegla(reglas, g.cuenta, g.centro_id);
    if (!regla) {
      sinDestino.push({ cuenta: g.cuenta, centro: g.centro, importe: txt2(importe) });
      continue;
    }
    porFuncion.set(
      regla.cuentaDestino,
      money.add(porFuncion.get(regla.cuentaDestino) ?? money.ZERO, importe),
    );
    detalle.push({
      cuenta: g.cuenta,
      centro: g.centro,
      importe: txt2(importe),
      destino: regla.cuentaDestino,
    });
    total = money.add(total, importe);
  }

  const yaDestinado = dec(ya?.saldo);

  return {
    periodo,
    porFuncion: [...porFuncion]
      .map(([cuenta, importe]) => ({
        cuenta,
        nombre: FUNCIONES.find((f) => cuenta.startsWith(f.cuenta))?.nombre ?? cuenta,
        importe: txt2(importe),
      }))
      .sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    yaDestinado: txt2(yaDestinado),
    pendiente: txt2(money.sub(total, yaDestinado)),
    detalle,
    sinDestino,
    totalSinDestino: txt2(
      sinDestino.reduce<Dec>((a, x) => money.add(a, dec(x.importe)), money.ZERO),
    ),
  };
}

/**
 * Contabiliza el asiento de destino del periodo.
 *
 * Lleva **sólo lo pendiente**: si ya se destinó parte, se asienta la
 * diferencia. Correrlo dos veces el mismo mes no duplica nada, que es lo que
 * hace seguro dejarlo en manos de quien cierra el mes.
 *
 * No cambia el resultado del ejercicio: la clase 9 se carga y la 79 se abona
 * por el mismo importe. Si alguna vez dejara de ser así, el balance dejaría de
 * cuadrar y el cierre lo diría.
 */
export async function contabilizarDestino(
  db: Db,
  empresaId: string,
  usuarioId: string,
  periodo: string,
  fecha?: string,
): Promise<{ asientoId: string | null; importe: string; sinDestino: number }> {
  await exigirPeriodoAbierto(db, periodo);
  const vista = await previsualizarDestino(db, periodo);

  const pendiente = dec(vista.pendiente);
  if (money.isZero(money.round(pendiente, 2))) {
    return { asientoId: null, importe: "0.00", sinDestino: vista.sinDestino.length };
  }
  if (money.gt(money.ZERO, pendiente)) {
    throw new DestinoInvalido([
      `ya se destinó más de lo que hay por destinar (${vista.yaDestinado} contra ${txt2(money.add(pendiente, dec(vista.yaDestinado)))}): extorne el asiento de destino anterior`,
    ]);
  }

  /*
   * El reparto por función se hace sobre lo pendiente, no sobre el total.
   *
   * Cuando ya hubo una corrida parcial, repartir el total volvería a llevar lo
   * que ya estaba llevado. Se prorratea con resto mayor para que la suma de las
   * funciones sea exactamente el pendiente y el asiento cuadre al céntimo.
   */
  const total = vista.porFuncion.reduce<Dec>((a, f) => money.add(a, dec(f.importe)), money.ZERO);
  const partes = money.isZero(total)
    ? []
    : money.distribute(
        pendiente,
        vista.porFuncion.map((f) => dec(f.importe)),
        2,
      );

  const ultimoDia = new Date(
    Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(4, 6)), 0),
  )
    .toISOString()
    .slice(0, 10);

  const lineas: LineaAsientoEntrada[] = vista.porFuncion
    .map((f, i) => ({
      cuenta: `${f.cuenta}1`,
      glosa: f.nombre,
      debe: txt2(partes[i] ?? money.ZERO),
    }))
    .filter((l) => !money.isZero(dec(l.debe)));

  lineas.push({
    cuenta: CUENTA_CARGAS,
    glosa: "Cargas imputables a cuenta de costos y gastos",
    haber: txt2(pendiente),
  });

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: fecha ?? ultimoDia,
    subdiario: "00",
    glosa: `Asiento de destino ${periodo}`,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "destino",
    lineas,
  });

  return { asientoId, importe: txt2(pendiente), sinDestino: vista.sinDestino.length };
}

// ─── Estado de resultados por función ─────────────────────────────────────

export type EstadoPorFuncion = {
  periodo: string;
  lineas: { concepto: string; cuentas: string; importe: string; nivel: number; esTotal?: boolean }[];
  /** Gastos de la clase 6 que todavía no se destinaron. */
  sinDestinar: string;
  /** El estado está completo sólo si no queda nada por destinar. */
  completo: boolean;
};

/**
 * Estado de resultados por función.
 *
 * Sale de la clase 9, no de la 6: por eso hace falta el asiento de destino.
 * Mientras quede gasto sin destinar, el informe está incompleto y lo dice —
 * presentar un estado por función al que le faltan gastos es peor que no
 * presentarlo.
 */
export async function estadoResultadosPorFuncion(
  db: Db,
  periodo: string,
): Promise<EstadoPorFuncion> {
  const saldos = (await db.execute(sql`
    SELECT left(l.cuenta, 2) AS grupo,
           sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND (left(l.cuenta, 1) IN ('7', '9') OR left(l.cuenta, 2) = '69')
    GROUP BY left(l.cuenta, 2)`)) as unknown as { grupo: string; saldo: string }[];

  const porGrupo = new Map([...saldos].map((s) => [s.grupo, dec(s.saldo)]));
  const g = (grupo: string) => porGrupo.get(grupo) ?? money.ZERO;
  const inv = (v: Dec) => money.neg(v);

  const ventas = inv(g("70"));
  const costoVentas = g("69");
  const bruta = money.sub(ventas, costoVentas);

  const administracion = g("94");
  const ventasGasto = g("95");
  const produccion = g("92");
  const operativa = money.sub(bruta, money.add(money.add(administracion, ventasGasto), produccion));

  const financierosGasto = g("97");
  const financierosIngreso = inv(g("77"));
  const otrosIngresos = inv(g("75"));
  const resultado = money.add(
    money.sub(operativa, financierosGasto),
    money.add(financierosIngreso, otrosIngresos),
  );

  // Lo que queda sin destinar: gasto de la clase 6 menos lo ya llevado a la 79.
  const [pendiente] = (await db.execute(sql`
    SELECT (
      coalesce(sum(CASE WHEN left(l.cuenta, 1) = '6' AND left(l.cuenta, 2) <> '69'
                        THEN l.debe_funcional - l.haber_funcional ELSE 0 END), 0)
      - coalesce(sum(CASE WHEN left(l.cuenta, 2) = '79'
                          THEN l.haber_funcional - l.debe_funcional ELSE 0 END), 0)
    )::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')`)) as unknown as [{ saldo: string }];

  const sinDestinar = dec(pendiente?.saldo);

  return {
    periodo,
    lineas: [
      { concepto: "Ventas netas", cuentas: "70", importe: txt2(ventas), nivel: 1 },
      { concepto: "Costo de ventas", cuentas: "69", importe: txt2(money.neg(costoVentas)), nivel: 1 },
      { concepto: "Utilidad bruta", cuentas: "", importe: txt2(bruta), nivel: 0, esTotal: true },
      { concepto: "Gastos de administración", cuentas: "94", importe: txt2(money.neg(administracion)), nivel: 1 },
      { concepto: "Gastos de ventas", cuentas: "95", importe: txt2(money.neg(ventasGasto)), nivel: 1 },
      ...(money.isZero(produccion)
        ? []
        : [
            {
              concepto: "Costo de producción",
              cuentas: "92",
              importe: txt2(money.neg(produccion)),
              nivel: 1,
            },
          ]),
      { concepto: "Utilidad operativa", cuentas: "", importe: txt2(operativa), nivel: 0, esTotal: true },
      { concepto: "Gastos financieros", cuentas: "97", importe: txt2(money.neg(financierosGasto)), nivel: 1 },
      { concepto: "Ingresos financieros", cuentas: "77", importe: txt2(financierosIngreso), nivel: 1 },
      ...(money.isZero(otrosIngresos)
        ? []
        : [
            {
              concepto: "Otros ingresos de gestión",
              cuentas: "75",
              importe: txt2(otrosIngresos),
              nivel: 1,
            },
          ]),
      {
        concepto: "RESULTADO DEL EJERCICIO",
        cuentas: "",
        importe: txt2(resultado),
        nivel: 0,
        esTotal: true,
      },
    ],
    sinDestinar: txt2(sinDestinar),
    completo: money.isZero(money.round(sinDestinar, 2)),
  };
}
