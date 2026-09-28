/**
 * Registro de compras y registro de ventas, para mirarlos e imprimirlos.
 *
 * Son los dos libros que el contador revisa todos los meses antes de declarar,
 * y los que un fiscalizador pide primero. Existen ya como archivo del PLE, pero
 * un archivo de texto de cuarenta campos separados por barras no se revisa: se
 * entrega. Esto es el mismo libro en forma de cuadro, con sus totales.
 *
 * Lo importante es que **salen de la misma consulta que el PLE**. Con dos
 * consultas parecidas, el día que una cambiara el contador tendría dos
 * registros del mismo mes y ninguna forma de saber cuál vale; y la cifra que
 * mira en pantalla es la que va a declarar.
 */
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { type Db } from "@roulterp/db";
import { filasRegistroCompras, filasRegistroVentas } from "./ple.ts";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export type RenglonRegistro = {
  fechaEmision: string;
  fechaVencimiento: string | null;
  tipoDocumento: string;
  serie: string;
  numero: string;
  /** Tipo y número de documento del tercero, como los pide SUNAT. */
  tipoDocTercero: string;
  numeroDocTercero: string;
  tercero: string;
  /** Base imponible de las operaciones gravadas. */
  gravadas: string;
  igv: string;
  exoneradas: string;
  inafectas: string;
  /** Sólo en ventas. */
  exportacion: string;
  isc: string;
  otrosCargos: string;
  total: string;
  moneda: string;
  tipoCambio: string;
  /** En soles, para poder sumar un mes con facturas en dólares. */
  totalSoles: string;
  estado: string;
  asiento: string | null;
  /** Sólo en compras: la constancia del depósito de detracción. */
  detraccion: string | null;
  /** Sólo en ventas: el comprobante que esta nota modifica. */
  modificaA: string | null;
};

export type Registro = {
  periodo: string;
  libro: "compras" | "ventas";
  renglones: RenglonRegistro[];
  totales: {
    gravadas: string;
    igv: string;
    exoneradas: string;
    inafectas: string;
    exportacion: string;
    isc: string;
    otrosCargos: string;
    total: string;
    totalSoles: string;
  };
  avisos: string[];
};

const CERO = {
  gravadas: money.ZERO, igv: money.ZERO, exoneradas: money.ZERO, inafectas: money.ZERO,
  exportacion: money.ZERO, isc: money.ZERO, otrosCargos: money.ZERO,
  total: money.ZERO, totalSoles: money.ZERO,
};

/**
 * Las notas de crédito restan.
 *
 * En la base cada documento guarda sus importes en positivo, que es como los
 * pide el CPE; el signo lo da el tipo de documento. Sumarlos todos en positivo
 * inflaría las ventas del mes justo por lo que se anuló.
 */
const signoDe = (tipoDocumento: string): Dec =>
  tipoDocumento === "07" ? money.dec("-1") : money.dec("1");

export async function registroDeCompras(db: Db, periodo: string): Promise<Registro> {
  const filas = await filasRegistroCompras(db, periodo);
  const totales = { ...CERO };
  const renglones: RenglonRegistro[] = [];
  let anuladas = 0;

  for (const f of filas) {
    // Una compra anulada se queda en el libro —SUNAT exige que figure— pero con
    // sus importes en cero: sumarla sería declarar un crédito que no existe.
    const anulada = f.estado === "anulada";
    if (anulada) anuladas++;
    const s = anulada ? money.ZERO : signoDe(f.tipo_documento);
    const tc = dec(f.tipo_cambio);

    const v = {
      gravadas: money.mul(dec(f.gravadas), s),
      igv: money.mul(dec(f.igv), s),
      exoneradas: money.mul(dec(f.exoneradas), s),
      inafectas: money.mul(dec(f.inafectas), s),
      exportacion: money.ZERO,
      isc: money.mul(dec(f.isc), s),
      otrosCargos: money.mul(dec(f.otros_cargos), s),
      total: money.mul(dec(f.total), s),
    };
    const totalSoles = money.round(money.mul(v.total, tc), 2);

    for (const k of Object.keys(totales) as (keyof typeof totales)[]) {
      totales[k] = money.add(totales[k], k === "totalSoles" ? totalSoles : v[k]);
    }

    renglones.push({
      fechaEmision: f.fecha_emision,
      fechaVencimiento: f.fecha_vencimiento,
      tipoDocumento: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      tipoDocTercero: f.tipo_doc_proveedor,
      numeroDocTercero: f.num_doc_proveedor,
      tercero: f.razon_social,
      gravadas: txt2(v.gravadas),
      igv: txt2(v.igv),
      exoneradas: txt2(v.exoneradas),
      inafectas: txt2(v.inafectas),
      exportacion: "0.00",
      isc: txt2(v.isc),
      otrosCargos: txt2(v.otrosCargos),
      total: txt2(v.total),
      moneda: f.moneda,
      tipoCambio: money.toString(tc, 3),
      totalSoles: txt2(totalSoles),
      estado: f.estado,
      asiento: f.asiento,
      detraccion: f.detraccion_constancia,
      modificaA: null,
    });
  }

  const avisos: string[] = [];
  if (anuladas > 0) {
    avisos.push(
      `${anuladas} ${anuladas === 1 ? "compra anulada figura" : "compras anuladas figuran"} ` +
        `en el libro con importe cero: SUNAT exige que aparezcan, pero no dan crédito fiscal.`,
    );
  }
  const enMoneda = renglones.filter((r) => r.moneda !== "PEN").length;
  if (enMoneda > 0) {
    avisos.push(
      `${enMoneda} ${enMoneda === 1 ? "documento está" : "documentos están"} en moneda ` +
        `extranjera: el total en soles usa el tipo de cambio de cada documento.`,
    );
  }

  return { periodo, libro: "compras", renglones, totales: aTexto(totales), avisos };
}

export async function registroDeVentas(db: Db, periodo: string): Promise<Registro> {
  const filas = await filasRegistroVentas(db, periodo);
  const totales = { ...CERO };
  const renglones: RenglonRegistro[] = [];
  let anulados = 0;

  for (const f of filas) {
    const anulado = f.estado === "anulado" || f.estado === "rechazado";
    if (anulado) anulados++;
    const s = anulado ? money.ZERO : signoDe(f.tipo_documento);
    const tc = dec(f.tipo_cambio);

    const v = {
      gravadas: money.mul(dec(f.gravadas), s),
      igv: money.mul(dec(f.igv), s),
      exoneradas: money.mul(dec(f.exoneradas), s),
      inafectas: money.mul(dec(f.inafectas), s),
      exportacion: money.mul(dec(f.exportacion), s),
      isc: money.mul(dec(f.isc), s),
      otrosCargos: money.mul(dec(f.otros_cargos), s),
      total: money.mul(dec(f.total), s),
    };
    const totalSoles = money.round(money.mul(v.total, tc), 2);

    for (const k of Object.keys(totales) as (keyof typeof totales)[]) {
      totales[k] = money.add(totales[k], k === "totalSoles" ? totalSoles : v[k]);
    }

    renglones.push({
      fechaEmision: f.fecha_emision,
      fechaVencimiento: f.fecha_vencimiento,
      tipoDocumento: f.tipo_documento,
      serie: f.serie,
      numero: f.numero,
      tipoDocTercero: f.tipo_doc_cliente,
      numeroDocTercero: f.num_doc_cliente,
      tercero: f.razon_social,
      gravadas: txt2(v.gravadas),
      igv: txt2(v.igv),
      exoneradas: txt2(v.exoneradas),
      inafectas: txt2(v.inafectas),
      exportacion: txt2(v.exportacion),
      isc: txt2(v.isc),
      otrosCargos: txt2(v.otrosCargos),
      total: txt2(v.total),
      moneda: f.moneda,
      tipoCambio: money.toString(tc, 3),
      totalSoles: txt2(totalSoles),
      estado: f.estado,
      asiento: f.asiento,
      detraccion: null,
      modificaA:
        f.serie_original && f.numero_original
          ? `${f.serie_original}-${f.numero_original}`
          : null,
    });
  }

  const avisos: string[] = [];
  if (anulados > 0) {
    avisos.push(
      `${anulados} ${anulados === 1 ? "comprobante anulado figura" : "comprobantes anulados figuran"} ` +
        `con importe cero: el correlativo no puede saltarse, pero no son venta.`,
    );
  }
  const enMoneda = renglones.filter((r) => r.moneda !== "PEN").length;
  if (enMoneda > 0) {
    avisos.push(
      `${enMoneda} ${enMoneda === 1 ? "comprobante está" : "comprobantes están"} en moneda ` +
        `extranjera: el total en soles usa el tipo de cambio de cada uno.`,
    );
  }

  /*
   * Los borradores no entran, y hay que decirlo.
   *
   * Un comprobante que todavía no se emitió no es una venta declarada, así que
   * el registro lo deja fuera igual que el PLE. Pero callarlo deja al contador
   * mirando un libro vacío mientras la pantalla de ventas le enseña treinta
   * documentos del mismo mes, sin ninguna explicación de la diferencia.
   */
  const [b] = (await db.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(total), 0)::text AS total
    FROM comprobantes WHERE periodo = ${periodo} AND estado = 'borrador'`)) as unknown as [
    { n: number; total: string },
  ];
  if (b.n > 0) {
    avisos.push(
      `${b.n} ${b.n === 1 ? "comprobante está en borrador" : "comprobantes están en borrador"} ` +
        `por ${txt2(dec(b.total))}: no entran al registro hasta que se emitan, igual que en el PLE.`,
    );
  }

  return { periodo, libro: "ventas", renglones, totales: aTexto(totales), avisos };
}

const aTexto = (t: typeof CERO): Registro["totales"] => ({
  gravadas: txt2(t.gravadas),
  igv: txt2(t.igv),
  exoneradas: txt2(t.exoneradas),
  inafectas: txt2(t.inafectas),
  exportacion: txt2(t.exportacion),
  isc: txt2(t.isc),
  otrosCargos: txt2(t.otrosCargos),
  total: txt2(t.total),
  totalSoles: txt2(t.totalSoles),
});
