/**
 * Liquidación mensual de impuestos: el borrador del PDT 621.
 *
 * Cada mes el contador arma el mismo cuadro: cuánto IGV se cobró, cuánto se
 * pagó, cuál es la diferencia, y cuánto toca de pago a cuenta del impuesto a la
 * renta. Lo hace a mano con los registros de compras y ventas al lado, y de ahí
 * salen la mitad de las rectificatorias del año.
 *
 * Esto lo arma solo, y de las mismas fuentes que los libros electrónicos: si el
 * PLE dice una cifra, aquí dice la misma. No reemplaza al PDT —declarar sigue
 * siendo un acto de la empresa ante SUNAT— pero sí el papel donde se apuntaban
 * los números antes de teclearlos.
 *
 * Las casillas llevan su número del formulario a propósito: quien lo llena
 * busca por número, no por nombre.
 */
import { eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as e, type Db } from "@roulterp/db";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export type Casilla = {
  /** Número de casilla del PDT 621. Vacío en los subtotales calculados. */
  numero: string;
  concepto: string;
  importe: string;
  /** Sangría al presentarlo. */
  nivel: number;
  esTotal?: boolean;
};

export type LiquidacionMensual = {
  periodo: string;
  ventas: Casilla[];
  compras: Casilla[];
  igv: Casilla[];
  renta: Casilla[];
  /**
   * Lo retenido o percibido a terceros: dinero ajeno que hay que entregar.
   *
   * No es crédito ni gasto. Va aparte porque se declara en otro formulario y
   * confundirlo con el IGV del mes deja al agente debiendo lo que creía pagado.
   */
  agente: Casilla[];
  /** Lo que hay que pagar (positivo) o el saldo a favor que queda (negativo). */
  igvAPagar: string;
  saldoAFavorSiguiente: string;
  pagoACuentaRenta: string;
  avisos: string[];
};

export type OpcionesLiquidacion = {
  /** Saldo a favor del IGV que viene del mes anterior (casilla 145). */
  saldoAFavorAnterior?: string;
  /**
   * Coeficiente o porcentaje del pago a cuenta de renta.
   *
   * Por defecto 1.5 %, que es el porcentaje del régimen general para quien no
   * tiene coeficiente. Quien lo tenga lo pone aquí: es un dato de la empresa,
   * no algo que este módulo pueda deducir.
   */
  tasaRenta?: string;
  /** Retenciones y percepciones de meses anteriores todavía sin aplicar. */
  retencionesAnteriores?: string;
};

/**
 * Arma la liquidación de un periodo.
 *
 * Lee los comprobantes emitidos y las compras registradas, que son las mismas
 * filas que alimentan los formatos 14.1 y 8.1 del PLE. Un descuadre entre esto
 * y el PLE sería un error de este cálculo, no de los datos.
 */
export async function liquidacionMensual(
  db: Db,
  periodo: string,
  opciones: OpcionesLiquidacion = {},
): Promise<LiquidacionMensual> {
  if (!/^\d{6}$/.test(periodo)) {
    throw new Error("el periodo debe tener el formato AAAAMM");
  }

  // ── Ventas ────────────────────────────────────────────────────────────
  //
  // Las notas de crédito restan y las de débito suman. El signo se aplica aquí
  // y no en la base porque en la base cada documento guarda su importe en
  // positivo, que es como lo pide el CPE.
  const signo = sql`CASE WHEN tipo_documento = '07' THEN -1 ELSE 1 END`;
  const [v] = (await db.execute(sql`
    SELECT coalesce(sum(${signo} * gravadas), 0)::text     AS gravadas,
           coalesce(sum(${signo} * exoneradas), 0)::text   AS exoneradas,
           coalesce(sum(${signo} * inafectas), 0)::text    AS inafectas,
           coalesce(sum(${signo} * exportacion), 0)::text  AS exportacion,
           coalesce(sum(${signo} * igv), 0)::text          AS igv,
           coalesce(sum(${signo} * isc), 0)::text          AS isc
    FROM comprobantes
    WHERE periodo = ${periodo}
      -- Mismo filtro que el registro de ventas del PLE, incluida la exclusión
      -- del borrador. Si los dos no usaran el mismo criterio, el contador
      -- tendría dos cifras para el mismo mes y ninguna forma de saber cuál vale.
      AND estado NOT IN ('anulado', 'rechazado', 'borrador')
      AND NOT es_apertura`)) as unknown as [
    {
      gravadas: string;
      exoneradas: string;
      inafectas: string;
      exportacion: string;
      igv: string;
      isc: string;
    },
  ];

  // ── Compras ───────────────────────────────────────────────────────────
  //
  // Sólo las de proveedores domiciliados dan crédito fiscal. Las del exterior
  // van al formato 8.2 y su IGV lo paga la aduana, no el proveedor.
  const [c] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN t.es_domiciliado THEN co.gravadas ELSE 0 END), 0)::text
             AS gravadas,
           coalesce(sum(CASE WHEN t.es_domiciliado THEN co.igv ELSE 0 END), 0)::text
             AS igv,
           coalesce(sum(CASE WHEN t.es_domiciliado THEN co.exoneradas + co.inafectas ELSE 0 END), 0)::text
             AS sin_credito,
           coalesce(sum(CASE WHEN NOT t.es_domiciliado THEN co.total ELSE 0 END), 0)::text
             AS no_domiciliados,
           coalesce(sum(co.detraccion_monto), 0)::text AS detracciones
    FROM compras co
    JOIN terceros t ON t.id = co.proveedor_id
    WHERE co.periodo = ${periodo}
      AND co.estado <> 'anulada'`)) as unknown as [
    {
      gravadas: string;
      igv: string;
      sin_credito: string;
      no_domiciliados: string;
      detracciones: string;
    },
  ];

  /*
   * Retenciones y percepciones **emitidas** por la empresa como agente.
   *
   * No son crédito: son dinero de terceros que la empresa retuvo y tiene que
   * entregarle a SUNAT, y se declaran aparte —PDT 626 para la retención, 633
   * para la percepción—. Confundirlas con el crédito fiscal del mes es el error
   * que deja a un agente de retención debiendo lo que creía haber pagado.
   *
   * Catálogo 01: "20" es comprobante de retención y "40" de percepción.
   */
  const [r] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN tipo_documento = '20' THEN importe_total ELSE 0 END), 0)::text
             AS retenciones,
           coalesce(sum(CASE WHEN tipo_documento = '40' THEN importe_total ELSE 0 END), 0)::text
             AS percepciones
    FROM comprobantes_retencion
    WHERE to_char(fecha_emision, 'YYYYMM') = ${periodo}
      AND estado NOT IN ('anulado', 'rechazado', 'borrador')`)) as unknown as [
    { retenciones: string; percepciones: string },
  ];

  const ventaGravada = dec(v?.gravadas);
  const igvVentas = dec(v?.igv);
  const compraGravada = dec(c?.gravadas);
  const igvCompras = dec(c?.igv);
  const saldoAnterior = dec(opciones.saldoAFavorAnterior);

  // El IGV del mes: lo cobrado menos lo pagado menos lo que sobró del mes
  // pasado. Si sale negativo no se paga nada y el sobrante viaja al mes
  // siguiente; declarar un importe negativo no existe.
  const diferencia = money.sub(money.sub(igvVentas, igvCompras), saldoAnterior);
  const igvAPagar = money.gt(diferencia, money.ZERO) ? diferencia : money.ZERO;
  const saldoSiguiente = money.gt(diferencia, money.ZERO) ? money.ZERO : money.neg(diferencia);

  // ── Renta ─────────────────────────────────────────────────────────────
  //
  // La base son los ingresos netos del mes: gravadas, exoneradas, inafectas y
  // exportación. El IGV no entra, que es el error clásico de quien lo calcula
  // sobre el total de la factura.
  const ingresosNetos = money.add(
    money.add(ventaGravada, dec(v?.exoneradas)),
    money.add(dec(v?.inafectas), dec(v?.exportacion)),
  );
  const tasa = opciones.tasaRenta ? dec(opciones.tasaRenta) : money.dec("1.5");
  const pagoACuenta = money.round(
    money.div(money.mul(ingresosNetos, tasa), money.dec("100")),
    2,
  );

  // Los borradores no se declaran, pero quien liquida tiene que saber que
  // están ahí: son ventas hechas que todavía no entraron a ningún libro.
  const [b] = (await db.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(igv), 0)::text AS igv
    FROM comprobantes
    WHERE periodo = ${periodo} AND estado = 'borrador'`)) as unknown as [
    { n: number; igv: string },
  ];

  const avisos: string[] = [];
  if ((b?.n ?? 0) > 0) {
    avisos.push(
      `Hay ${b!.n} ${b!.n === 1 ? "comprobante" : "comprobantes"} en borrador por ` +
        `${txt2(dec(b?.igv))} de IGV. No entran en esta liquidación ni en el registro de ventas: ` +
        "infórmelos a SUNAT antes de declarar o quedarán fuera del mes.",
    );
  }
  if (money.isZero(igvVentas) && money.isZero(igvCompras)) {
    avisos.push(
      `No hay comprobantes ni compras en el periodo ${periodo}. La declaración va en cero, pero se presenta igual.`,
    );
  }
  if (money.gt(dec(c?.no_domiciliados), money.ZERO)) {
    avisos.push(
      "Hay compras a no domiciliados: no dan crédito fiscal y pueden generar retención de renta de no domiciliados (formulario 1673).",
    );
  }
  if (money.gt(dec(c?.detracciones), money.ZERO)) {
    avisos.push(
      "Las detracciones del periodo deben estar depositadas antes de tomar el crédito fiscal de esas facturas.",
    );
  }
  if (!money.isZero(dec(r?.retenciones)) || !money.isZero(dec(r?.percepciones))) {
    avisos.push(
      "Lo retenido o percibido a terceros no es crédito de este formulario: se declara y se paga aparte.",
    );
  }
  if (opciones.saldoAFavorAnterior === undefined) {
    avisos.push(
      "No se indicó saldo a favor del mes anterior: si lo hubo, la casilla 145 va en blanco y el IGV sale más alto de lo que toca.",
    );
  }

  return {
    periodo,
    ventas: [
      { numero: "100", concepto: "Ventas netas gravadas", importe: txt2(ventaGravada), nivel: 1 },
      { numero: "105", concepto: "Ventas no gravadas (exoneradas)", importe: txt2(dec(v?.exoneradas)), nivel: 1 },
      { numero: "112", concepto: "Ventas inafectas", importe: txt2(dec(v?.inafectas)), nivel: 1 },
      { numero: "106", concepto: "Exportaciones facturadas", importe: txt2(dec(v?.exportacion)), nivel: 1 },
      { numero: "101", concepto: "IGV de las ventas (débito fiscal)", importe: txt2(igvVentas), nivel: 0, esTotal: true },
      ...(money.isZero(dec(v?.isc))
        ? []
        : [{ numero: "", concepto: "ISC", importe: txt2(dec(v?.isc)), nivel: 1 }]),
    ],
    compras: [
      { numero: "107", concepto: "Compras gravadas destinadas a ventas gravadas", importe: txt2(compraGravada), nivel: 1 },
      { numero: "", concepto: "Compras sin derecho a crédito fiscal", importe: txt2(dec(c?.sin_credito)), nivel: 1 },
      ...(money.isZero(dec(c?.no_domiciliados))
        ? []
        : [
            {
              numero: "",
              concepto: "Compras a no domiciliados (formato 8.2)",
              importe: txt2(dec(c?.no_domiciliados)),
              nivel: 1,
            },
          ]),
      { numero: "108", concepto: "IGV de las compras (crédito fiscal)", importe: txt2(igvCompras), nivel: 0, esTotal: true },
    ],
    igv: [
      { numero: "101", concepto: "Débito fiscal", importe: txt2(igvVentas), nivel: 1 },
      { numero: "108", concepto: "Crédito fiscal", importe: txt2(money.neg(igvCompras)), nivel: 1 },
      { numero: "145", concepto: "Saldo a favor del mes anterior", importe: txt2(money.neg(saldoAnterior)), nivel: 1 },
      { numero: "140", concepto: "IGV a pagar", importe: txt2(igvAPagar), nivel: 0, esTotal: true },
      ...(money.isZero(saldoSiguiente)
        ? []
        : [
            {
              numero: "",
              concepto: "Saldo a favor para el mes siguiente",
              importe: txt2(saldoSiguiente),
              nivel: 0,
              esTotal: true,
            },
          ]),
    ],
    renta: [
      { numero: "301", concepto: "Ingresos netos del mes", importe: txt2(ingresosNetos), nivel: 1 },
      { numero: "", concepto: `Tasa o coeficiente aplicado (${money.toString(tasa, 2)} %)`, importe: money.toString(tasa, 2), nivel: 1 },
      { numero: "315", concepto: "Pago a cuenta del impuesto a la renta", importe: txt2(pagoACuenta), nivel: 0, esTotal: true },
    ],
    agente: [
      ...(money.isZero(dec(r?.retenciones))
        ? []
        : [
            {
              numero: "",
              concepto: "Retenciones de IGV efectuadas (se declaran en el PDT 626)",
              importe: txt2(dec(r?.retenciones)),
              nivel: 1,
            },
          ]),
      ...(money.isZero(dec(r?.percepciones))
        ? []
        : [
            {
              numero: "",
              concepto: "Percepciones de IGV efectuadas (se declaran en el PDT 633)",
              importe: txt2(dec(r?.percepciones)),
              nivel: 1,
            },
          ]),
    ],
    igvAPagar: txt2(igvAPagar),
    saldoAFavorSiguiente: txt2(saldoSiguiente),
    pagoACuentaRenta: txt2(pagoACuenta),
    avisos,
  };
}

/**
 * La liquidación en un archivo, para llevarla al PDT.
 *
 * Sale en CSV con punto y coma —el separador que espera un Excel en español— y
 * con la casilla en la primera columna, que es por donde se busca al declarar.
 *
 * Lo que **no** hace: escribir el archivo binario que el PDT importa. Su
 * estructura la publica SUNAT por versión del programa, cambia con cada una, y
 * generarla de memoria sería inventar un formato que el cliente descubriría
 * rebotado el día 12. Mientras no se tenga la estructura de la versión que usa
 * la empresa, esto es el papel donde estaban los números, y en orden.
 */
export async function exportarLiquidacion(
  db: Db,
  empresaId: string,
  periodo: string,
  opciones: OpcionesLiquidacion = {},
): Promise<{ nombre: string; contenido: string; filas: number }> {
  const l = await liquidacionMensual(db, periodo, opciones);

  const [empresa] = await db
    .select({ ruc: e.empresas.ruc })
    .from(e.empresas)
    .where(eq(e.empresas.id, empresaId))
    .limit(1);
  if (!empresa) throw new Error("la empresa no existe");

  const secciones: [string, Casilla[]][] = [
    ["VENTAS", l.ventas],
    ["COMPRAS", l.compras],
    ["IGV", l.igv],
    ["RENTA", l.renta],
    ["AGENTE", l.agente],
  ];

  // El punto y coma es el separador; una glosa que lo lleve partiría la fila.
  const limpio = (v: string) => v.replace(/[;\r\n]+/g, " ").trim();

  const filas = [
    ["SECCION", "CASILLA", "CONCEPTO", "IMPORTE"],
    ...secciones.flatMap(([seccion, casillas]) =>
      casillas.map((c) => [seccion, c.numero, limpio(c.concepto), c.importe]),
    ),
  ];

  return {
    nombre: `PDT621-${empresa.ruc}-${periodo}.csv`,
    contenido: filas.map((f) => f.join(";")).join("\r\n") + "\r\n",
    // La cabecera no es un dato.
    filas: filas.length - 1,
  };
}
