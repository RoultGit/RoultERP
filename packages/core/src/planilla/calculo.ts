/**
 * El cálculo de una planilla, sin base de datos de por medio.
 *
 * Recibe el trabajador, sus conceptos y los parámetros de la fecha, y devuelve
 * la boleta línea por línea. No lee, no escribe y no conoce a Postgres: es lo
 * que permite probar cada regla con números a mano y comparar contra la planilla
 * que la empresa lleva hoy, que es exactamente lo que SERVIDIMAR pidió —«las
 * mismas fórmulas y criterios»— y lo que no se puede comprobar si el cálculo
 * está enterrado en una consulta.
 *
 * Tres reglas gobiernan todo lo de abajo:
 *
 * **Las bases se calculan una vez y en orden.** Primero los ingresos, de ahí
 * sale la base remunerativa; sobre ella los descuentos de pensión; después la
 * quinta categoría, que necesita saber lo ya descontado; y al final los aportes
 * del empleador, que no tocan el neto. Alterar el orden cambia los números.
 *
 * **Lo no remunerativo no entra en ninguna base.** La movilidad de reparto no
 * paga pensión, ni EsSalud, ni engorda la CTS. Es la bandera que más caro sale
 * equivocar porque el error viaja hasta la liquidación.
 *
 * **Lo que no se puede calcular se dice.** Un trabajador en AFP sin AFP
 * asignada no se descuenta «por si acaso» ni se pasa a ONP: la línea sale con
 * su aviso y la planilla no se cierra.
 */
import * as money from "../money.ts";
import { type Concepto } from "./conceptos.ts";
import { type Parametros } from "./parametros.ts";

type Dec = money.Dec;
const d = (v: string): Dec => money.dec(v);
const cero = money.ZERO;
const r2 = (v: Dec): Dec => money.round(v, 2);

/** Días que la ley cuenta en un mes de planilla, sea cual sea el calendario. */
export const DIAS_MES = 30;

export type RegimenPension =
  | { sistema: "onp" }
  | { sistema: "afp"; afp: string; comision: "flujo" | "mixta" }
  | { sistema: "ninguno" };

export type Trabajador = {
  id: string;
  nombre: string;
  /** Remuneración básica mensual vigente en el periodo. */
  basico: string;
  regimen: RegimenPension;
  /** Da derecho a asignación familiar: hijos menores de 18, o hasta 24 estudiando. */
  tieneHijos: boolean;
  /**
   * Afiliado a EPS. Reduce el aporte a EsSalud en el crédito que corresponda;
   * aquí sólo se marca y el crédito se teclea, porque lo liquida la EPS.
   */
  eps?: boolean;
};

export type EntradaConcepto = {
  codigo: string;
  /** Para los conceptos `manual`. Se ignora en los demás. */
  importe?: string;
};

export type Periodo = {
  /** AAAA-MM. Decide qué parámetros rigen. */
  periodo: string;
  /** Primer día del periodo, AAAA-MM-DD. */
  fecha: string;
  /**
   * Días efectivamente trabajados, sobre 30. Prorratea los conceptos fijos.
   * Un ingreso a mitad de mes o una licencia sin goce entran por aquí.
   */
  diasTrabajados: number;
  /**
   * Quincena: 1 es el adelanto de mitad de mes y 2 el cierre.
   *
   * SERVIDIMAR paga quincenal. La ley y los aportes son mensuales, así que la
   * primera quincena es **un adelanto a cuenta** y no una planilla con su propia
   * ONP: descontar media pensión dos veces daría un total distinto al mensual
   * por el redondeo, y la declaración se calcula sobre el mes. La segunda
   * quincena liquida el mes entero y resta lo ya entregado.
   */
  quincena?: 1 | 2;
  /** Lo entregado en la primera quincena, para descontarlo en la segunda. */
  adelantoQuincena?: string;
};

export type LineaBoleta = {
  codigo: string;
  nombre: string;
  tipo: Concepto["tipo"];
  importe: string;
  /** Por qué no se pudo calcular. Con esto puesto, la planilla no cierra. */
  aviso?: string;
};

export type Boleta = {
  lineas: readonly LineaBoleta[];
  /** Suma de los ingresos, remunerativos o no. */
  totalIngresos: string;
  /** Lo que entra en las bases de pensión, EsSalud, CTS y gratificación. */
  baseRemunerativa: string;
  totalDescuentos: string;
  /** Lo que paga la empresa por encima del sueldo. No sale del neto. */
  totalAportes: string;
  neto: string;
  /** Costo total para la empresa: ingresos + aportes. */
  costoEmpleador: string;
  avisos: readonly string[];
};

/** Lo que el trabajador ya lleva ganado y retenido en el año, para la quinta. */
export type AcumuladoAnual = {
  /** Remuneraciones afectas pagadas en meses anteriores del ejercicio. */
  rentaPagada: string;
  /** Quinta categoría ya retenida en el ejercicio. */
  retenido: string;
  /** Meses que faltan por pagar en el año, contando el actual. */
  mesesRestantes: number;
  /** Gratificaciones que faltan por pagar en el año. Son renta de quinta. */
  gratificacionesRestantes: number;
};

/**
 * Retención de quinta categoría del mes.
 *
 * El método es el que manda el reglamento: se **proyecta** lo que el trabajador
 * va a ganar en todo el ejercicio, se le quitan las 7 UIT, se aplica la escala,
 * y al impuesto anual resultante se le resta lo ya retenido; lo que queda se
 * reparte entre los meses que faltan.
 *
 * Proyectar y no retener sobre lo del mes es lo que reparte la carga en doce
 * partes parejas. Reteniendo mes a mes, el trabajador de sueldo variable pagaría
 * mucho en los meses buenos y nada en los malos, y acabaría el año con saldo a
 * favor o en contra según en qué orden le tocaron.
 */
export function quintaCategoria(
  remuneracionMes: Dec,
  acumulado: AcumuladoAnual,
  p: Parametros,
): { retencion: Dec; proyeccion: Dec; impuestoAnual: Dec } {
  const meses = Math.max(acumulado.mesesRestantes, 1);
  const proyeccion = money.add(
    money.add(
      d(acumulado.rentaPagada),
      money.mul(remuneracionMes, money.dec(String(meses))),
    ),
    // Las gratificaciones son renta de quinta y hay que proyectarlas: si no, la
    // retención se queda corta y julio y diciembre llegan con un salto.
    money.mul(remuneracionMes, money.dec(String(acumulado.gratificacionesRestantes))),
  );

  const deduccion = money.mul(p.uit, money.dec(String(7)));
  const neta = money.max(money.sub(proyeccion, deduccion), cero);

  const impuestoAnual = impuestoPorEscala(neta, p.uit);
  const pendiente = money.max(money.sub(impuestoAnual, d(acumulado.retenido)), cero);
  return { retencion: r2(money.div(pendiente, money.dec(String(meses)))), proyeccion, impuestoAnual };
}

/** Aplica la escala progresiva. Cada tramo paga su tasa sólo sobre su parte. */
export function impuestoPorEscala(rentaNeta: Dec, uit: Dec): Dec {
  const TRAMOS: readonly [number | null, string][] = [
    [5, "0.08"],
    [20, "0.14"],
    [35, "0.17"],
    [45, "0.20"],
    [null, "0.30"],
  ];
  let restante = rentaNeta;
  let anterior = cero;
  let impuesto = cero;

  for (const [hastaUit, tasa] of TRAMOS) {
    if (money.lte(restante, cero)) break;
    const tope = hastaUit === null ? null : money.mul(uit, money.dec(String(hastaUit)));
    const anchoTramo = tope === null ? restante : money.sub(tope, anterior);
    const enEsteTramo = money.min(restante, anchoTramo);
    impuesto = money.add(impuesto, money.mul(enEsteTramo, d(tasa)));
    restante = money.sub(restante, enEsteTramo);
    if (tope !== null) anterior = tope;
  }
  return r2(impuesto);
}

export type EntradaCalculo = {
  trabajador: Trabajador;
  periodo: Periodo;
  /** Los conceptos que aplican, ya resueltos contra el catálogo de la empresa. */
  conceptos: readonly Concepto[];
  /** Importes tecleados para los conceptos manuales, por código. */
  manuales?: Readonly<Record<string, string>>;
  parametros: Parametros;
  acumulado?: AcumuladoAnual;
  /** La empresa aporta al SENATI. Sólo actividad industrial. */
  aportaSenati?: boolean;
};

export function calcularBoleta(e: EntradaCalculo): Boleta {
  const { trabajador: t, periodo, parametros: p } = e;
  const manuales = e.manuales ?? {};
  const avisos: string[] = [];
  const lineas: LineaBoleta[] = [];

  const proporcion = money.div(
    money.dec(String(Math.min(periodo.diasTrabajados, DIAS_MES))),
    money.dec(String(DIAS_MES)),
  );

  const ordenados = [...e.conceptos].sort((a, b) => a.orden - b.orden);
  const ingresos = ordenados.filter((c) => c.tipo === "ingreso");

  // ── 1. Ingresos ────────────────────────────────────────────────────────
  let totalIngresos = cero;
  let baseRemunerativa = cero;
  let baseQuinta = cero;

  for (const c of ingresos) {
    let importe = cero;
    if (c.calculo === "fijo") {
      importe = r2(money.mul(d(t.basico), proporcion));
    } else if (c.calculo === "manual") {
      importe = r2(d(manuales[c.codigo] ?? "0"));
    } else if (c.calculo === "porcentaje") {
      importe = r2(money.mul(baseRemunerativa, d(c.tasa ?? "0")));
    } else if (c.regla === "asignacion_familiar") {
      // La asignación familiar no se prorratea por días: es un monto fijo por
      // tener hijos a cargo, no una contraprestación por el tiempo trabajado.
      importe = t.tieneHijos ? r2(money.mul(p.rmv, p.tasaAsignacionFamiliar)) : cero;
    }

    if (money.isZero(importe) && c.calculo !== "fijo") continue;
    lineas.push({ codigo: c.codigo, nombre: c.nombre, tipo: "ingreso", importe: money.toString(importe, 2) });
    totalIngresos = money.add(totalIngresos, importe);
    if (c.remunerativo) baseRemunerativa = money.add(baseRemunerativa, importe);
    if (c.afectaQuinta) baseQuinta = money.add(baseQuinta, importe);
  }

  // ── 2. Descuentos ──────────────────────────────────────────────────────
  let totalDescuentos = cero;
  const descuentos = ordenados.filter((c) => c.tipo === "descuento");
  const enAfp = t.regimen.sistema === "afp" ? t.regimen : null;
  const tasasAfp = enAfp ? p.afp.find((a) => a.codigo === enAfp.afp) : undefined;
  if (enAfp && !tasasAfp) {
    avisos.push(`${t.nombre}: la AFP «${enAfp.afp}» no está en la tabla de tasas vigente`);
  }

  for (const c of descuentos) {
    let importe = cero;
    let aviso: string | undefined;

    if (c.calculo === "manual") {
      importe = r2(d(manuales[c.codigo] ?? "0"));
    } else if (c.calculo === "porcentaje") {
      importe = r2(money.mul(baseRemunerativa, d(c.tasa ?? "0")));
    } else {
      switch (c.regla) {
        case "onp":
          if (t.regimen.sistema !== "onp") continue;
          importe = r2(money.mul(baseRemunerativa, p.tasaOnp));
          break;
        case "afp_aporte":
        case "afp_comision":
        case "afp_prima": {
          if (!enAfp) continue;
          if (!tasasAfp) {
            // No se pasa a ONP ni se deja en cero en silencio: el trabajador
            // vería un neto mayor que el suyo y la diferencia la debe la empresa.
            aviso = "sin tasas de AFP vigentes para este periodo";
            break;
          }
          if (c.regla === "afp_aporte") {
            importe = r2(money.mul(baseRemunerativa, d(tasasAfp.aporte)));
          } else if (c.regla === "afp_comision") {
            // Con comisión mixta no hay descuento sobre la remuneración: se
            // cobra sobre el saldo del fondo y lo hace la AFP, no la planilla.
            importe = enAfp?.comision === "mixta"
              ? cero
              : r2(money.mul(baseRemunerativa, d(tasasAfp.comisionFlujo)));
          } else {
            // La prima se calcula sobre la remuneración topada por la máxima
            // asegurable; sin el tope, los sueldos altos pagan de más.
            const base = money.min(baseRemunerativa, p.remuneracionMaximaAsegurable);
            importe = r2(money.mul(base, d(tasasAfp.primaSeguro)));
          }
          break;
        }
        case "quinta": {
          if (!e.acumulado) {
            aviso = "falta el acumulado del ejercicio para proyectar la quinta";
            break;
          }
          importe = quintaCategoria(baseQuinta, e.acumulado, p).retencion;
          break;
        }
        default:
          continue;
      }
    }

    if (aviso) {
      avisos.push(`${t.nombre}: ${aviso}`);
      lineas.push({ codigo: c.codigo, nombre: c.nombre, tipo: "descuento", importe: "0.00", aviso });
      continue;
    }
    if (money.isZero(importe)) continue;
    lineas.push({ codigo: c.codigo, nombre: c.nombre, tipo: "descuento", importe: money.toString(importe, 2) });
    totalDescuentos = money.add(totalDescuentos, importe);
  }

  // ── 3. Aportes del empleador ───────────────────────────────────────────
  let totalAportes = cero;
  for (const c of ordenados.filter((x) => x.tipo === "aporte")) {
    let importe = cero;
    if (c.calculo === "manual") {
      importe = r2(d(manuales[c.codigo] ?? "0"));
    } else if (c.calculo === "porcentaje") {
      importe = r2(money.mul(baseRemunerativa, d(c.tasa ?? "0")));
    } else if (c.regla === "essalud") {
      // El aporte tiene un piso: se calcula sobre la RMV aunque el trabajador
      // gane menos, que es lo que pasa con un part-time o un mes incompleto.
      const base = money.max(baseRemunerativa, p.rmv);
      importe = r2(money.mul(base, p.tasaEsSalud));
    } else if (c.regla === "senati") {
      if (!e.aportaSenati) continue;
      importe = r2(money.mul(baseRemunerativa, p.tasaSenati));
    } else {
      continue;
    }
    if (money.isZero(importe)) continue;
    lineas.push({ codigo: c.codigo, nombre: c.nombre, tipo: "aporte", importe: money.toString(importe, 2) });
    totalAportes = money.add(totalAportes, importe);
  }

  // ── 4. Neto ────────────────────────────────────────────────────────────
  let neto = money.sub(totalIngresos, totalDescuentos);
  if (periodo.quincena === 2 && periodo.adelantoQuincena) {
    // La primera quincena fue un adelanto a cuenta, no una planilla aparte: se
    // resta del neto del mes en vez de recalcular medias pensiones, que por el
    // redondeo no sumarían lo mismo que el mes entero.
    neto = money.sub(neto, d(periodo.adelantoQuincena));
  }

  return {
    lineas,
    totalIngresos: money.toString(totalIngresos, 2),
    baseRemunerativa: money.toString(baseRemunerativa, 2),
    totalDescuentos: money.toString(totalDescuentos, 2),
    totalAportes: money.toString(totalAportes, 2),
    neto: money.toString(neto, 2),
    costoEmpleador: money.toString(money.add(totalIngresos, totalAportes), 2),
    avisos,
  };
}
