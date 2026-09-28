/**
 * Beneficios sociales: gratificación, CTS, vacaciones y liquidación.
 *
 * Es la parte de la planilla que no se paga todos los meses y donde más caro
 * sale el error, porque el trabajador la cobra una vez y la revisa entera.
 *
 * Todo lo de aquí comparte una idea: la **remuneración computable**. No es el
 * sueldo bruto; es el básico más lo que sea regular y remunerativo, y cada
 * beneficio la define un poco distinto. La CTS suma un sexto de la
 * gratificación; la gratificación no se suma a sí misma. Confundirlas paga de
 * más en una y de menos en otra.
 *
 * Los periodos se cuentan en **meses y días de treinta**, como manda la norma,
 * y no en días de calendario: un semestre trabajado entero son seis meses, no
 * ciento ochenta y dos días, y hacerlo por calendario da diferencias de céntimos
 * que en una liquidación se leen como un error.
 */
import * as money from "../money.ts";
import { type Parametros } from "./parametros.ts";

type Dec = money.Dec;
const d = (v: string): Dec => money.dec(v);
const r2 = (v: Dec): Dec => money.round(v, 2);
const num = (n: number): Dec => money.dec(String(n));

/**
 * Meses completos y días sueltos entre dos fechas, contando meses de treinta.
 *
 * El día de inicio cuenta y el de fin también: quien entra el 1 y sale el 31 de
 * enero trabajó el mes, no veintinueve días.
 */
export function mesesYDias(desde: string, hasta: string): { meses: number; dias: number } {
  const [a1, m1, d1] = desde.split("-").map(Number) as [number, number, number];
  const [a2, m2, d2] = hasta.split("-").map(Number) as [number, number, number];
  if (`${desde}` > `${hasta}`) return { meses: 0, dias: 0 };

  let meses = (a2 - a1) * 12 + (m2 - m1);
  // Los días de un mes incompleto se cuentan sobre treinta; el 31 se trata como
  // el 30, que es lo que hace el cómputo laboral.
  const dia1 = Math.min(d1, 30);
  const dia2 = Math.min(d2, 30);
  let dias = dia2 - dia1 + 1;
  if (dias >= 30) {
    meses += 1;
    dias -= 30;
  } else if (dias < 0) {
    meses -= 1;
    dias += 30;
  }
  return { meses: Math.max(meses, 0), dias: Math.max(dias, 0) };
}

/** El mayor de los dos primeros días del semestre de gratificación. */
export function semestreGratificacion(periodo: "julio" | "diciembre", anio: number) {
  return periodo === "julio"
    ? { desde: `${anio}-01-01`, hasta: `${anio}-06-30` }
    : { desde: `${anio}-07-01`, hasta: `${anio}-12-31` };
}

export type Gratificacion = {
  /** Meses completos del semestre que se reconocen. */
  meses: number;
  remuneracionComputable: string;
  /** El beneficio propiamente dicho: un sueldo por semestre completo. */
  gratificacion: string;
  /**
   * Bonificación extraordinaria de la Ley 30334: el 9 % de EsSalud que el
   * empleador deja de aportar se le entrega al trabajador. No es remunerativa.
   */
  bonificacion: string;
  total: string;
};

/**
 * Gratificación de julio o diciembre.
 *
 * Un sueldo entero por semestre completo, o tantos sextos como meses completos
 * se hayan trabajado. Los días sueltos **no** cuentan: la norma habla de meses
 * calendario completos, y repartirlos en treintavos —que es el error que sale
 * solo al copiar la fórmula de la CTS— paga de más.
 */
export function gratificacion(
  remuneracionComputable: string,
  mesesCompletos: number,
  p: Parametros,
): Gratificacion {
  const meses = Math.max(0, Math.min(mesesCompletos, 6));
  const rc = d(remuneracionComputable);
  const grati = r2(money.mul(money.div(rc, num(6)), num(meses)));
  const bono = r2(money.mul(grati, p.tasaBonificacionGratificacion));
  return {
    meses,
    remuneracionComputable: money.toString(rc, 2),
    gratificacion: money.toString(grati, 2),
    bonificacion: money.toString(bono, 2),
    total: money.toString(money.add(grati, bono), 2),
  };
}

export type Cts = {
  meses: number;
  dias: number;
  /** Básico + asignación familiar + un sexto de la última gratificación. */
  remuneracionComputable: string;
  porMeses: string;
  porDias: string;
  total: string;
};

/**
 * Compensación por tiempo de servicios de un semestre.
 *
 * Se deposita en mayo y en noviembre por los semestres que cierran en abril y
 * en octubre. La fórmula es un doceavo de la remuneración computable por mes
 * completo, más un treintavo de ese doceavo por cada día suelto.
 *
 * **El sexto de la gratificación entra en la computable.** Es la parte que más
 * se olvida y la que más pesa: sin ella la CTS sale un 8 % corta, y el
 * trabajador lo descubre comparando con la del año anterior.
 */
export function cts(
  remuneracionComputable: string,
  meses: number,
  dias: number,
): Cts {
  const rc = d(remuneracionComputable);
  const porMes = money.div(rc, num(12));
  const porMeses = money.mul(porMes, num(Math.max(0, Math.min(meses, 6))));
  // Se multiplica antes de dividir. Al revés —dividir entre 360 y luego
  // multiplicar— el cociente se corta en seis decimales y el resultado sale un
  // céntimo por debajo del que da la calculadora, que es el que el trabajador
  // trae apuntado.
  const porDias = money.div(money.mul(rc, num(Math.max(0, dias))), num(360));
  return {
    meses,
    dias,
    remuneracionComputable: money.toString(rc, 2),
    porMeses: money.toString(r2(porMeses), 2),
    porDias: money.toString(r2(porDias), 2),
    total: money.toString(r2(money.add(porMeses, porDias)), 2),
  };
}

/**
 * Remuneración computable de la CTS: básico + asignación familiar + 1/6 de la
 * última gratificación, más el promedio de lo regular variable.
 *
 * «Regular» quiere decir percibido al menos tres veces en el semestre. Se recibe
 * ya promediado porque quién cumple ese requisito lo sabe la planilla histórica,
 * no esta función.
 */
export function computableCts(
  basico: string,
  asignacionFamiliar: string,
  ultimaGratificacion: string,
  promedioVariable = "0",
): string {
  return money.toString(
    r2(
      money.add(
        money.add(d(basico), d(asignacionFamiliar)),
        money.add(money.div(d(ultimaGratificacion), num(6)), d(promedioVariable)),
      ),
    ),
    2,
  );
}

export type Vacaciones = {
  meses: number;
  dias: number;
  /** Un sueldo por año completo; proporcional si es trunco. */
  total: string;
};

/**
 * Vacaciones truncas: un doceavo de la remuneración por mes completo.
 *
 * Se pagan al cese aunque no se haya cumplido el año. El récord vacacional no
 * ganado no se pierde: se paga en proporción, y ése es justo el concepto que
 * más veces falta en una liquidación hecha a mano.
 */
export function vacacionesTruncas(remuneracion: string, meses: number, dias: number): Vacaciones {
  const rc = d(remuneracion);
  const porMes = money.div(rc, num(12));
  const total = money.add(
    money.mul(porMes, num(Math.max(0, meses))),
    // Multiplicar antes de dividir: ver la nota en `cts`.
    money.div(money.mul(rc, num(Math.max(0, dias))), num(360)),
  );
  return { meses, dias, total: money.toString(r2(total), 2) };
}

export type MotivoCese =
  | "renuncia"
  | "vencimiento_contrato"
  | "mutuo_acuerdo"
  | "falta_grave"
  | "despido_arbitrario"
  | "jubilacion"
  | "fallecimiento";

export type Liquidacion = {
  motivo: MotivoCese;
  fechaIngreso: string;
  fechaCese: string;
  tiempoServicio: { anios: number; meses: number; dias: number };
  conceptos: readonly { codigo: string; nombre: string; importe: string; nota?: string }[];
  totalBruto: string;
  descuentos: readonly { codigo: string; nombre: string; importe: string }[];
  totalDescuentos: string;
  neto: string;
};

export type EntradaLiquidacion = {
  motivo: MotivoCese;
  fechaIngreso: string;
  fechaCese: string;
  /** Remuneración del mes del cese: básico + asignación familiar. */
  remuneracion: string;
  asignacionFamiliar: string;
  /** Última gratificación percibida; entra en la computable de la CTS. */
  ultimaGratificacion: string;
  /** Último depósito de CTS hecho; el trunco corre desde el semestre en curso. */
  ctsDesde: string;
  /** Inicio del periodo vacacional no pagado. */
  vacacionesDesde: string;
  /** Días del mes del cese efectivamente trabajados, sobre 30. */
  diasDelMes: number;
  /** Adelantos, préstamos y demás que se descuentan de la liquidación. */
  descuentos?: readonly { codigo: string; nombre: string; importe: string }[];
  /** Vacaciones ya ganadas y no gozadas, en días. Se pagan además del trunco. */
  diasVacacionesPendientes?: number;
};

/**
 * Liquidación de beneficios sociales.
 *
 * Es la operación que el cliente pidió que saliera sola al dar de baja a un
 * trabajador. Reúne cinco cosas y ninguna se puede olvidar: los días del mes
 * trabajados, la CTS trunca, la gratificación trunca, las vacaciones truncas y,
 * si el cese fue un despido arbitrario, la indemnización.
 *
 * **La indemnización se calcula pero se marca.** Sólo corresponde en despido
 * arbitrario, y calificar un cese como arbitrario es una decisión legal, no un
 * desplegable: la cifra sale con su nota para que alguien la confirme.
 *
 * **La falta grave no quita la CTS ni las vacaciones.** Se pierde la
 * indemnización, no lo ganado. Es el error que más veces se comete al liquidar
 * enfadado.
 */
export function liquidacionBeneficios(e: EntradaLiquidacion, p: Parametros): Liquidacion {
  const conceptos: { codigo: string; nombre: string; importe: string; nota?: string }[] = [];
  const total = mesesYDias(e.fechaIngreso, e.fechaCese);
  const remuneracionMes = money.add(d(e.remuneracion), d(e.asignacionFamiliar));

  // 1. Los días del mes del cese que sí se trabajaron.
  const porDiasDelMes = r2(
    money.div(money.mul(remuneracionMes, num(Math.max(0, e.diasDelMes))), num(30)),
  );
  if (!money.isZero(porDiasDelMes)) {
    conceptos.push({
      codigo: "REM_CESE",
      nombre: `Remuneración de ${e.diasDelMes} días del mes del cese`,
      importe: money.toString(porDiasDelMes, 2),
    });
  }

  // 2. CTS trunca desde el último depósito.
  const rcCts = computableCts(e.remuneracion, e.asignacionFamiliar, e.ultimaGratificacion);
  const periodoCts = mesesYDias(e.ctsDesde, e.fechaCese);
  const truncaCts = cts(rcCts, periodoCts.meses, periodoCts.dias);
  if (!money.isZero(d(truncaCts.total))) {
    conceptos.push({
      codigo: "CTS_TRUNCA",
      nombre: `CTS trunca (${periodoCts.meses} meses y ${periodoCts.dias} días)`,
      importe: truncaCts.total,
      nota: `computable ${truncaCts.remuneracionComputable}, incluye 1/6 de gratificación`,
    });
  }

  // 3. Gratificación trunca del semestre en curso.
  const mes = Number(e.fechaCese.slice(5, 7));
  const anio = Number(e.fechaCese.slice(0, 4));
  const semestre = semestreGratificacion(mes <= 6 ? "julio" : "diciembre", anio);
  const desdeGrati = e.fechaIngreso > semestre.desde ? e.fechaIngreso : semestre.desde;
  const periodoGrati = mesesYDias(desdeGrati, e.fechaCese);
  const truncaGrati = gratificacion(
    money.toString(remuneracionMes, 2),
    periodoGrati.meses,
    p,
  );
  if (!money.isZero(d(truncaGrati.total))) {
    conceptos.push({
      codigo: "GRATI_TRUNCA",
      nombre: `Gratificación trunca (${truncaGrati.meses}/6)`,
      importe: truncaGrati.gratificacion,
    });
    conceptos.push({
      codigo: "BONIF_GRATI",
      nombre: "Bonificación extraordinaria Ley 30334 (9 %)",
      importe: truncaGrati.bonificacion,
    });
  }

  // 4. Vacaciones: las ganadas y no gozadas, más las truncas del periodo actual.
  if (e.diasVacacionesPendientes) {
    const importe = r2(
      money.div(money.mul(remuneracionMes, num(e.diasVacacionesPendientes)), num(30)),
    );
    conceptos.push({
      codigo: "VAC_PENDIENTES",
      nombre: `Vacaciones ganadas no gozadas (${e.diasVacacionesPendientes} días)`,
      importe: money.toString(importe, 2),
    });
  }
  const periodoVac = mesesYDias(e.vacacionesDesde, e.fechaCese);
  const truncasVac = vacacionesTruncas(
    money.toString(remuneracionMes, 2),
    periodoVac.meses,
    periodoVac.dias,
  );
  if (!money.isZero(d(truncasVac.total))) {
    conceptos.push({
      codigo: "VAC_TRUNCAS",
      nombre: `Vacaciones truncas (${periodoVac.meses} meses y ${periodoVac.dias} días)`,
      importe: truncasVac.total,
    });
  }

  // 5. Indemnización, sólo en despido arbitrario.
  if (e.motivo === "despido_arbitrario") {
    // Sueldo y medio por año, con tope de doce sueldos. Los meses sueltos van
    // en dozavos y los días en treintavos del dozavo.
    const porAnio = money.mul(remuneracionMes, money.dec("1.5"));
    const anios = Math.floor(total.meses / 12);
    const mesesSueltos = total.meses % 12;
    const bruto = money.add(
      money.mul(porAnio, num(anios)),
      money.add(
        money.mul(money.div(porAnio, num(12)), num(mesesSueltos)),
        money.div(money.mul(porAnio, num(total.dias)), num(360)),
      ),
    );
    const tope = money.mul(remuneracionMes, num(12));
    conceptos.push({
      codigo: "INDEMNIZACION",
      nombre: "Indemnización por despido arbitrario",
      importe: money.toString(r2(money.min(bruto, tope)), 2),
      nota:
        "Calificar el cese como despido arbitrario es una decisión legal: confirme " +
        "antes de pagar. Tope de 12 remuneraciones.",
    });
  }

  const totalBruto = money.sum(conceptos.map((c) => d(c.importe)));
  const descuentos = e.descuentos ?? [];
  const totalDescuentos = money.sum(descuentos.map((x) => d(x.importe)));

  return {
    motivo: e.motivo,
    fechaIngreso: e.fechaIngreso,
    fechaCese: e.fechaCese,
    tiempoServicio: {
      anios: Math.floor(total.meses / 12),
      meses: total.meses % 12,
      dias: total.dias,
    },
    conceptos,
    totalBruto: money.toString(r2(totalBruto), 2),
    descuentos,
    totalDescuentos: money.toString(r2(totalDescuentos), 2),
    neto: money.toString(r2(money.sub(totalBruto, totalDescuentos)), 2),
  };
}
