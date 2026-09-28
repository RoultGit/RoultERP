/**
 * Los números que pone la ley, no la empresa.
 *
 * La RMV, la UIT, la tasa de ONP, la de EsSalud y las de cada AFP cambian por
 * norma —la UIT todos los eneros, la RMV cuando el Ejecutivo lo decide— y una
 * planilla se recalcula hacia atrás cuando alguien reabre un mes. Por eso nada
 * de esto es una constante en el código: **cada valor vive con su fecha de
 * vigencia** y el cálculo pide el que regía el día del periodo, no el de hoy.
 *
 * La diferencia importa el primer enero. Con constantes, recalcular diciembre
 * después de subir la UIT daría una quinta categoría distinta a la que se
 * declaró, y nadie sabría por qué. Con vigencias, diciembre sigue diciendo lo
 * que dijo.
 *
 * Los valores que trae este módulo son **el punto de partida legal**, no la
 * verdad de la empresa: SERVIDIMAR pidió conservar las fórmulas y criterios que
 * usa hoy, y esos hay que tomarlos de su planilla actual. La tabla de la
 * empresa manda sobre estos; esto es lo que se usa mientras nadie diga otra
 * cosa, igual que el plan de cuentas.
 */
import * as money from "../money.ts";

type Dec = money.Dec;

export type Vigencia<T> = {
  /** AAAA-MM-DD. Rige desde este día, inclusive. */
  desde: string;
  valor: T;
};

/** El valor que regía en `fecha`. El más reciente que no sea posterior. */
export function vigenteEn<T>(serie: readonly Vigencia<T>[], fecha: string): T | undefined {
  let elegido: T | undefined;
  for (const v of serie) if (v.desde <= fecha) elegido = v.valor;
  return elegido;
}

/**
 * Remuneración mínima vital. Base de la asignación familiar y piso de la
 * aportación a EsSalud.
 */
export const RMV: readonly Vigencia<string>[] = [
  { desde: "2022-05-01", valor: "1025.00" },
  { desde: "2024-01-01", valor: "1025.00" },
  { desde: "2025-01-01", valor: "1130.00" },
];

/**
 * Unidad impositiva tributaria. Base de los siete tramos exentos y de los
 * escalones de la quinta categoría.
 *
 * Cambia cada enero por decreto supremo. El año que no esté en esta lista, la
 * empresa tiene que cargarlo en sus parámetros antes de correr enero, y el
 * cálculo lo dice en vez de suponer el del año pasado: una UIT vieja retiene de
 * menos y la diferencia la paga el trabajador en la regularización.
 */
export const UIT: readonly Vigencia<string>[] = [
  { desde: "2023-01-01", valor: "4950.00" },
  { desde: "2024-01-01", valor: "5150.00" },
  { desde: "2025-01-01", valor: "5350.00" },
];

/** Aporte del trabajador al Sistema Nacional de Pensiones. */
export const TASA_ONP: readonly Vigencia<string>[] = [{ desde: "1900-01-01", valor: "0.13" }];

/** Aporte del empleador al seguro de salud. */
export const TASA_ESSALUD: readonly Vigencia<string>[] = [{ desde: "1900-01-01", valor: "0.09" }];

/** Asignación familiar: 10 % de la RMV para quien tiene hijos a cargo. */
export const TASA_ASIGNACION_FAMILIAR: readonly Vigencia<string>[] = [
  { desde: "1900-01-01", valor: "0.10" },
];

/**
 * Bonificación extraordinaria de la Ley 30334: el 9 % de EsSalud que el
 * empleador ya no aporta sobre la gratificación se le entrega al trabajador.
 * No es remunerativa y no está afecta a pensiones.
 */
export const TASA_BONIFICACION_GRATIFICACION: readonly Vigencia<string>[] = [
  { desde: "2015-07-01", valor: "0.09" },
];

/** Contribución al SENATI. Sólo empresas de actividad industrial. */
export const TASA_SENATI: readonly Vigencia<string>[] = [{ desde: "1900-01-01", valor: "0.0075" }];

export type TasasAfp = {
  codigo: string;
  nombre: string;
  /** Aporte obligatorio al fondo. Es del trabajador y va a su cuenta. */
  aporte: string;
  /** Comisión sobre la remuneración («por flujo»). */
  comisionFlujo: string;
  /** Comisión anual sobre el saldo («mixta»). Se declara, no se descuenta aquí. */
  comisionSaldo: string;
  /** Prima del seguro de invalidez y sobrevivencia. */
  primaSeguro: string;
};

/**
 * Tasas de las AFP.
 *
 * Las publica la SBS y cambian cada pocos meses. Están con su vigencia por lo
 * mismo que la UIT: recalcular un mes viejo con la tasa de hoy daría un
 * descuento distinto al que figura en la boleta que el trabajador ya firmó.
 */
export const AFP: readonly Vigencia<readonly TasasAfp[]>[] = [
  {
    desde: "2025-01-01",
    valor: [
      { codigo: "habitat", nombre: "AFP Hábitat", aporte: "0.10", comisionFlujo: "0.0147", comisionSaldo: "0.0047", primaSeguro: "0.0174" },
      { codigo: "integra", nombre: "AFP Integra", aporte: "0.10", comisionFlujo: "0.0155", comisionSaldo: "0.0000", primaSeguro: "0.0174" },
      { codigo: "prima", nombre: "Prima AFP", aporte: "0.10", comisionFlujo: "0.0160", comisionSaldo: "0.0000", primaSeguro: "0.0174" },
      { codigo: "profuturo", nombre: "Profuturo AFP", aporte: "0.10", comisionFlujo: "0.0169", comisionSaldo: "0.0000", primaSeguro: "0.0174" },
    ],
  },
];

/**
 * Tope sobre el que se calcula la prima del seguro de la AFP.
 *
 * La SBS publica una remuneración máxima asegurable trimestral. Por encima de
 * ella la prima deja de crecer, y olvidarlo descuenta de más justo a los
 * sueldos altos, que son los que más se revisan.
 */
export const REMUNERACION_MAXIMA_ASEGURABLE: readonly Vigencia<string>[] = [
  { desde: "2025-01-01", valor: "12933.32" },
];

/**
 * Escala de la quinta categoría, en UIT.
 *
 * Cada tramo dice hasta cuántas UIT llega y con qué tasa. El último no tiene
 * tope. Se expresa en UIT y no en soles a propósito: así el cambio de enero es
 * un único valor y no cinco.
 */
export const TRAMOS_QUINTA: readonly { hastaUit: number | null; tasa: string }[] = [
  { hastaUit: 5, tasa: "0.08" },
  { hastaUit: 20, tasa: "0.14" },
  { hastaUit: 35, tasa: "0.17" },
  { hastaUit: 45, tasa: "0.20" },
  { hastaUit: null, tasa: "0.30" },
];

/** Deducción fija de la quinta categoría, en UIT. */
export const DEDUCCION_QUINTA_UIT = 7;

export type Parametros = {
  rmv: Dec;
  uit: Dec;
  tasaOnp: Dec;
  tasaEsSalud: Dec;
  tasaAsignacionFamiliar: Dec;
  tasaBonificacionGratificacion: Dec;
  tasaSenati: Dec;
  remuneracionMaximaAsegurable: Dec;
  afp: readonly TasasAfp[];
};

export class ParametroFaltante extends Error {
  constructor(readonly que: string, readonly fecha: string) {
    super(`no hay ${que} vigente al ${fecha}; cárguelo en los parámetros laborales`);
    this.name = "ParametroFaltante";
  }
}

/**
 * Los parámetros que regían en una fecha, con las excepciones de la empresa.
 *
 * `propios` es lo que la empresa cargó y manda sobre el valor de partida. Es el
 * mismo trato que reciben las cuentas de integración contable: el catálogo del
 * programa es el punto de partida y la tabla guarda lo que se cambió, así que
 * una empresa nueva y una de hace un año se comportan igual sin sembrar nada.
 *
 * Lo que no tiene valor **falla**, no se supone. Correr enero con la UIT del año
 * pasado retiene de menos todo el año, y el trabajador se entera en marzo del
 * siguiente con una deuda que no esperaba.
 */
export function parametrosEn(
  fecha: string,
  propios: Partial<Record<keyof Omit<Parametros, "afp">, string>> & {
    afp?: readonly TasasAfp[];
  } = {},
): Parametros {
  const dec = (v: string) => money.dec(v);
  const tomar = (clave: keyof Omit<Parametros, "afp">, serie: readonly Vigencia<string>[], que: string): Dec => {
    const propio = propios[clave];
    if (propio !== undefined) return dec(propio);
    const v = vigenteEn(serie, fecha);
    if (v === undefined) throw new ParametroFaltante(que, fecha);
    return dec(v);
  };

  const afp = propios.afp ?? vigenteEn(AFP, fecha);
  if (!afp) throw new ParametroFaltante("la tabla de tasas de AFP", fecha);

  return {
    rmv: tomar("rmv", RMV, "la remuneración mínima vital"),
    uit: tomar("uit", UIT, "la UIT"),
    tasaOnp: tomar("tasaOnp", TASA_ONP, "la tasa de ONP"),
    tasaEsSalud: tomar("tasaEsSalud", TASA_ESSALUD, "la tasa de EsSalud"),
    tasaAsignacionFamiliar: tomar(
      "tasaAsignacionFamiliar",
      TASA_ASIGNACION_FAMILIAR,
      "la tasa de asignación familiar",
    ),
    tasaBonificacionGratificacion: tomar(
      "tasaBonificacionGratificacion",
      TASA_BONIFICACION_GRATIFICACION,
      "la bonificación extraordinaria de gratificación",
    ),
    tasaSenati: tomar("tasaSenati", TASA_SENATI, "la tasa de SENATI"),
    remuneracionMaximaAsegurable: tomar(
      "remuneracionMaximaAsegurable",
      REMUNERACION_MAXIMA_ASEGURABLE,
      "la remuneración máxima asegurable",
    ),
    afp,
  };
}
