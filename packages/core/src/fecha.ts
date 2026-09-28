/**
 * Qué día es hoy, en Perú.
 *
 * Existe porque `new Date().toISOString().slice(0, 10)` **no** da la fecha de
 * hoy: da la fecha en UTC. En una máquina de Lima coinciden hasta las 19:00 y
 * a partir de ahí no, así que el error es invisible mientras se programa y
 * aparece el día del despliegue, cuando el servidor corre en UTC.
 *
 * Lo que rompe es concreto: una factura emitida a las 20:00 del 30 de setiembre
 * sale fechada el 1 de octubre. Eso la mete en el periodo tributario
 * equivocado y deja el correlativo fuera de orden cronológico, que es de las
 * pocas cosas que SUNAT rechaza sin discusión. Lo mismo con el resumen diario
 * de boletas, que agruparía por el día que no es.
 *
 * Perú es UTC−5 todo el año —no hay horario de verano— pero aun así se resuelve
 * con `Intl` y el nombre de la zona en vez de restar cinco horas a mano: una
 * resta fija es una bomba de relojería el día que la regla cambie, y el sistema
 * operativo ya sabe la respuesta correcta.
 *
 * El formato `sv-SE` no es capricho: es el único de la biblioteca estándar que
 * emite `AAAA-MM-DD` directamente, que es como viaja una fecha en este sistema.
 */

export const ZONA_HORARIA = "America/Lima";

const FORMATO = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** La fecha de hoy en Perú, como `AAAA-MM-DD`. */
export const hoyEnPeru = (momento: Date = new Date()): string => FORMATO.format(momento);

/** El periodo contable de hoy en Perú, como `AAAAMM`. */
export const periodoDeHoy = (momento: Date = new Date()): string =>
  hoyEnPeru(momento).slice(0, 4) + hoyEnPeru(momento).slice(5, 7);

const HORA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONA_HORARIA,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * La hora de ahora en Perú, como `HH:MM:SS`.
 *
 * La necesita el comprobante electrónico: el XML lleva hora de emisión y SUNAT
 * la contrasta con la fecha. Una hora en UTC junto a una fecha de Lima es
 * justamente la combinación que no cuadra.
 */
export const horaEnPeru = (momento: Date = new Date()): string => HORA.format(momento);

/**
 * La fecha de dentro de `dias` días, en Perú.
 *
 * Se calcula sobre la fecha local, no sobre el instante: sumar 86 400 000
 * milisegundos a `Date.now()` y formatear después da un día de menos o de más
 * según la hora a la que se pregunte, porque el corte de medianoche de Lima no
 * cae donde el reloj UTC cree.
 */
export function enDias(dias: number, desde: Date = new Date()): string {
  const [a, m, d] = hoyEnPeru(desde).split("-").map(Number) as [number, number, number];
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}
