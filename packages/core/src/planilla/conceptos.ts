/**
 * El catálogo de conceptos de la planilla.
 *
 * Un concepto es cada línea de la boleta: el básico, la asignación familiar,
 * las horas extras, el descuento de pensión, el aporte a EsSalud. Lo que decide
 * qué hace cada uno no es su nombre sino **cuatro banderas**, y son las cuatro
 * que hay que acertar:
 *
 * - `tipo`: si suma al bruto (`ingreso`), si lo resta (`descuento`) o si lo paga
 *   la empresa por encima (`aporte`). Un aporte no toca el neto del trabajador.
 * - `remunerativo`: si entra en la base de pensiones, EsSalud, CTS y
 *   gratificación. La movilidad de reparto no lo es; una bonificación regular
 *   sí. Equivocarlo es el error más caro de una planilla, porque se arrastra a
 *   los beneficios sociales y aparece años después en una liquidación.
 * - `afectaQuinta`: si entra en la renta de quinta categoría. Casi todo lo
 *   remunerativo lo hace, pero no al revés: la gratificación es no computable
 *   para pensiones y sí afecta a quinta.
 * - `computableCts`: si entra en la remuneración computable de la CTS.
 *
 * SERVIDIMAR pidió conservar sus fórmulas actuales. Por eso el catálogo es una
 * **semilla editable por empresa**, igual que el plan de cuentas: esto es lo que
 * manda la ley y lo que usa quien no dice nada, y cada empresa ajusta lo suyo
 * sin tocar el programa.
 */

export type TipoConcepto = "ingreso" | "descuento" | "aporte";

/**
 * Cómo se calcula el importe.
 *
 * Son cuatro y ninguna más, a propósito. Un lenguaje de fórmulas dentro de la
 * planilla parece flexible y acaba siendo un intérprete que nadie puede
 * auditar; cuando haga falta algo que no encaje, se añade un cálculo con
 * nombre —como `onp` o `quinta`— y se prueba aparte.
 */
export type Calculo =
  /** Importe fijo del trabajador, prorrateado por días trabajados. */
  | "fijo"
  /** Se teclea cada planilla: horas extras, un bono puntual, un adelanto. */
  | "manual"
  /** Porcentaje sobre la base remunerativa del periodo. */
  | "porcentaje"
  /** Uno de los cálculos con nombre: onp, afp, essalud, quinta, asignacion… */
  | "legal";

export type Concepto = {
  /** Código estable. Es lo que referencian las reglas y los asientos. */
  codigo: string;
  nombre: string;
  tipo: TipoConcepto;
  calculo: Calculo;
  remunerativo: boolean;
  afectaQuinta: boolean;
  computableCts: boolean;
  /** Para `porcentaje`: tanto por uno sobre la base remunerativa. */
  tasa?: string;
  /** Para `legal`: qué cálculo con nombre aplica. */
  regla?:
    | "asignacion_familiar"
    | "onp"
    | "afp_aporte"
    | "afp_comision"
    | "afp_prima"
    | "quinta"
    | "essalud"
    | "senati";
  /** Cuenta del PCGE a la que va. Sirve para el asiento de la planilla. */
  cuenta?: string;
  /** Orden en la boleta. Los ingresos primero, después descuentos y aportes. */
  orden: number;
};

/**
 * Catálogo de partida.
 *
 * Cubre la planilla de una empresa del régimen general: es lo que SERVIDIMAR
 * necesita el primer día. Lo que la empresa tenga de más —una bonificación por
 * cumplimiento, un descuento de comedor— se añade desde la pantalla.
 */
export const CONCEPTOS_BASE: readonly Concepto[] = [
  // ─── Ingresos ───────────────────────────────────────────────────────────
  { codigo: "BASICO", nombre: "Remuneración básica", tipo: "ingreso", calculo: "fijo",
    remunerativo: true, afectaQuinta: true, computableCts: true, cuenta: "6211", orden: 10 },
  { codigo: "ASIGFAM", nombre: "Asignación familiar", tipo: "ingreso", calculo: "legal",
    regla: "asignacion_familiar", remunerativo: true, afectaQuinta: true, computableCts: true,
    cuenta: "6211", orden: 20 },
  { codigo: "HEX25", nombre: "Horas extras 25 %", tipo: "ingreso", calculo: "manual",
    remunerativo: true, afectaQuinta: true, computableCts: true, cuenta: "6214", orden: 30 },
  { codigo: "HEX35", nombre: "Horas extras 35 %", tipo: "ingreso", calculo: "manual",
    remunerativo: true, afectaQuinta: true, computableCts: true, cuenta: "6214", orden: 31 },
  { codigo: "BONIF", nombre: "Bonificaciones", tipo: "ingreso", calculo: "manual",
    remunerativo: true, afectaQuinta: true, computableCts: true, cuenta: "6215", orden: 40 },
  /*
   * La movilidad de reparto y los gastos de representación sujetos a rendición
   * son condición de trabajo, no remuneración: no van a pensiones, ni a CTS, ni
   * a gratificación. Meterlos como remunerativos infla todos los beneficios y el
   * error no se ve hasta que alguien se va.
   */
  { codigo: "MOVILIDAD", nombre: "Movilidad (condición de trabajo)", tipo: "ingreso",
    calculo: "manual", remunerativo: false, afectaQuinta: false, computableCts: false,
    cuenta: "6391", orden: 50 },

  // ─── Descuentos del trabajador ──────────────────────────────────────────
  { codigo: "ONP", nombre: "ONP (13 %)", tipo: "descuento", calculo: "legal", regla: "onp",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "4032", orden: 100 },
  { codigo: "AFP_APORTE", nombre: "AFP · aporte obligatorio", tipo: "descuento", calculo: "legal",
    regla: "afp_aporte", remunerativo: false, afectaQuinta: false, computableCts: false,
    cuenta: "4071", orden: 110 },
  { codigo: "AFP_COMISION", nombre: "AFP · comisión", tipo: "descuento", calculo: "legal",
    regla: "afp_comision", remunerativo: false, afectaQuinta: false, computableCts: false,
    cuenta: "4071", orden: 111 },
  { codigo: "AFP_PRIMA", nombre: "AFP · prima de seguro", tipo: "descuento", calculo: "legal",
    regla: "afp_prima", remunerativo: false, afectaQuinta: false, computableCts: false,
    cuenta: "4071", orden: 112 },
  { codigo: "QUINTA", nombre: "Renta de quinta categoría", tipo: "descuento", calculo: "legal",
    regla: "quinta", remunerativo: false, afectaQuinta: false, computableCts: false,
    cuenta: "4017", orden: 120 },
  { codigo: "ADELANTO", nombre: "Adelanto de remuneración", tipo: "descuento", calculo: "manual",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "1411", orden: 130 },
  { codigo: "PRESTAMO", nombre: "Descuento de préstamo", tipo: "descuento", calculo: "manual",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "1412", orden: 131 },
  { codigo: "JUDICIAL", nombre: "Retención judicial", tipo: "descuento", calculo: "manual",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "4191", orden: 132 },

  // ─── Aportes del empleador ──────────────────────────────────────────────
  { codigo: "ESSALUD", nombre: "EsSalud (9 %)", tipo: "aporte", calculo: "legal", regla: "essalud",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "6271", orden: 200 },
  { codigo: "SENATI", nombre: "SENATI (0.75 %)", tipo: "aporte", calculo: "legal", regla: "senati",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "6272", orden: 210 },
  { codigo: "SCTR", nombre: "SCTR", tipo: "aporte", calculo: "manual",
    remunerativo: false, afectaQuinta: false, computableCts: false, cuenta: "6273", orden: 220 },
] as const;

const PORCODIGO = new Map(CONCEPTOS_BASE.map((c) => [c.codigo, c]));
export const conceptoBase = (codigo: string): Concepto | undefined => PORCODIGO.get(codigo);
