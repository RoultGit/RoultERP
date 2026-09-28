/**
 * Análisis contable: las tres consultas que un contador pide y que hasta ahora
 * había que armar a mano con el mayor delante.
 *
 * - **Cuenta corriente por anexo**: todo lo que se movió con un tercero, en
 *   todas las cuentas donde aparece. El estado de cuenta de CxC y CxP mira los
 *   documentos; esto mira el mayor, que es donde acaban también los anticipos,
 *   los préstamos y las diferencias de cambio.
 * - **Resultados por centro de costo**: en qué obra o en qué línea se ganó y en
 *   cuál se perdió. Un resultado global positivo puede tapar una obra que pierde.
 * - **Precios históricos del proveedor**: a cuánto compró la última vez, para no
 *   aceptar un alza sin darse cuenta.
 *
 * Todas leen. Ninguna escribe.
 */
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { type Db } from "@roulterp/db";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

// ─── Cuenta corriente por anexo ───────────────────────────────────────────

export type MovimientoAnexo = {
  fecha: string;
  asiento: string;
  cuenta: string;
  glosa: string;
  documento: string;
  debe: string;
  haber: string;
  saldo: string;
};

export type CuentaCorrienteAnexo = {
  tercero: { id: string; razonSocial: string; documento: string };
  cuentas: { cuenta: string; movimientos: MovimientoAnexo[]; saldo: string }[];
  saldoTotal: string;
};

/**
 * Todo lo que se movió con un tercero, cuenta por cuenta.
 *
 * Se separa por cuenta contable y no se suma todo junto: lo que se le debe a un
 * proveedor (42) y lo que él nos debe por un anticipo (16) no se compensan
 * solos, y presentarlos como un saldo único esconde las dos cifras que
 * importan. El total va aparte, para quien sí quiera la posición neta.
 *
 * Sólo entran los asientos contabilizados: un borrador no es un hecho.
 */
export async function cuentaCorrienteAnexo(
  db: Db,
  terceroId: string,
  rango?: { desde?: string; hasta?: string },
): Promise<CuentaCorrienteAnexo> {
  const [t] = (await db.execute(sql`
    SELECT id::text, razon_social, numero_documento
    FROM terceros WHERE id = ${terceroId}`)) as unknown as [
    { id: string; razon_social: string; numero_documento: string } | undefined,
  ];
  if (!t) throw new Error("el tercero no existe en esta empresa");

  const desde = rango?.desde ? sql`AND a.fecha >= ${rango.desde}` : sql``;
  const hasta = rango?.hasta ? sql`AND a.fecha <= ${rango.hasta}` : sql``;

  const filas = (await db.execute(sql`
    SELECT a.fecha, a.numero AS asiento, l.cuenta,
           coalesce(l.glosa, a.glosa) AS glosa,
           coalesce(l.documento_tipo, '') AS doc_tipo,
           coalesce(l.documento_serie, '') AS doc_serie,
           coalesce(l.documento_numero, '') AS doc_numero,
           l.debe_funcional::text AS debe, l.haber_funcional::text AS haber
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE l.anexo_id = ${terceroId}
      AND a.estado IN ('contabilizado', 'extornado')
      ${desde} ${hasta}
    ORDER BY l.cuenta, a.fecha, a.numero`)) as unknown as {
    fecha: string;
    asiento: string;
    cuenta: string;
    glosa: string;
    doc_tipo: string;
    doc_serie: string;
    doc_numero: string;
    debe: string;
    haber: string;
  }[];

  const porCuenta = new Map<string, MovimientoAnexo[]>();
  for (const f of [...filas]) {
    const lista = porCuenta.get(f.cuenta) ?? [];
    lista.push({
      fecha: f.fecha,
      asiento: f.asiento,
      cuenta: f.cuenta,
      glosa: f.glosa,
      documento: [f.doc_serie, f.doc_numero].filter(Boolean).join("-"),
      debe: txt2(dec(f.debe)),
      haber: txt2(dec(f.haber)),
      saldo: "0.00",
    });
    porCuenta.set(f.cuenta, lista);
  }

  let saldoTotal = money.ZERO;
  const cuentas = [...porCuenta]
    .map(([cuenta, movimientos]) => {
      let saldo = money.ZERO;
      for (const m of movimientos) {
        saldo = money.add(money.sub(saldo, dec(m.haber)), dec(m.debe));
        m.saldo = txt2(saldo);
      }
      saldoTotal = money.add(saldoTotal, saldo);
      return { cuenta, movimientos, saldo: txt2(saldo) };
    })
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  return {
    tercero: { id: t.id, razonSocial: t.razon_social, documento: t.numero_documento },
    cuentas,
    saldoTotal: txt2(saldoTotal),
  };
}

// ─── Resultados por centro de costo ───────────────────────────────────────

export type ResultadoCentro = {
  centroId: string | null;
  codigo: string;
  nombre: string;
  ingresos: string;
  costos: string;
  gastos: string;
  resultado: string;
  /** Margen sobre ingresos, en porcentaje. */
  margen: string;
};

/**
 * Ingresos, costos y gastos de cada centro de costo en un periodo.
 *
 * Un resultado global positivo puede estar tapando una obra que pierde, y esa
 * obra sigue consumiendo caja todos los meses. Esto la saca a la luz.
 *
 * Lo que no lleva centro de costo aparece con su propia fila en vez de
 * repartirse: repartir gasto indirecto por una fórmula inventada da números que
 * parecen precisos y no lo son. Quien quiera repartirlos, que lo decida él.
 */
export async function resultadosPorCentro(
  db: Db,
  periodo: string,
  hasta?: string,
): Promise<ResultadoCentro[]> {
  const rango = hasta
    ? sql`a.periodo BETWEEN ${periodo} AND ${hasta}`
    : sql`a.periodo = ${periodo}`;

  const filas = (await db.execute(sql`
    SELECT c.id::text AS centro_id, coalesce(c.codigo, '') AS codigo,
           coalesce(c.nombre, 'Sin centro de costo') AS nombre,
           coalesce(sum(CASE WHEN left(l.cuenta, 1) = '7'
                             THEN l.haber_funcional - l.debe_funcional ELSE 0 END), 0)::text
             AS ingresos,
           coalesce(sum(CASE WHEN left(l.cuenta, 2) = '69'
                             THEN l.debe_funcional - l.haber_funcional ELSE 0 END), 0)::text
             AS costos,
           coalesce(sum(CASE WHEN left(l.cuenta, 1) = '6' AND left(l.cuenta, 2) <> '69'
                             THEN l.debe_funcional - l.haber_funcional ELSE 0 END), 0)::text
             AS gastos
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    LEFT JOIN centros_costo c ON c.id = l.centro_costo_id
    WHERE ${rango}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) IN ('6', '7')
      -- La 79 es la contrapartida del asiento de destino, no un ingreso.
      AND left(l.cuenta, 2) <> '79'
    GROUP BY c.id, c.codigo, c.nombre
    ORDER BY c.codigo NULLS LAST`)) as unknown as {
    centro_id: string | null;
    codigo: string;
    nombre: string;
    ingresos: string;
    costos: string;
    gastos: string;
  }[];

  return [...filas].map((f) => {
    const ingresos = dec(f.ingresos);
    const costos = dec(f.costos);
    const gastos = dec(f.gastos);
    const resultado = money.sub(ingresos, money.add(costos, gastos));
    return {
      centroId: f.centro_id,
      codigo: f.codigo,
      nombre: f.nombre,
      ingresos: txt2(ingresos),
      costos: txt2(costos),
      gastos: txt2(gastos),
      resultado: txt2(resultado),
      margen: money.isZero(ingresos)
        ? "0.00"
        : money.toString(
            money.round(money.mul(money.div(resultado, ingresos), money.dec("100")), 2),
            2,
          ),
    };
  });
}

// ─── Precios históricos del proveedor ─────────────────────────────────────

export type PrecioHistorico = {
  fecha: string;
  /** compra o importacion. */
  origen: "compra" | "importacion";
  documento: string;
  proveedorId: string;
  proveedor: string;
  moneda: string;
  cantidad: string;
  valorUnitario: string;
  /** En soles, para comparar compras hechas en monedas distintas. */
  valorUnitarioSoles: string;
  /**
   * Costo unitario puesto en almacén, en soles.
   *
   * En una importación no es el precio: al FOB se le suman el flete, el seguro,
   * los derechos y la agencia. Comparar el FOB de un embarque con el precio de
   * una compra local es comparar dos cosas distintas, y es justo el error que
   * lleva a creer que importar sale más barato de lo que sale.
   *
   * Nulo mientras el embarque no esté liquidado: todavía no se sabe.
   */
  costoUnitarioSoles: string | null;
  /** Variación contra la compra anterior del mismo producto, en porcentaje. */
  variacion: string | null;
};

/**
 * A cuánto se compró este producto cada vez, aquí y en el exterior.
 *
 * Es lo que evita aceptar un alza del 12 % porque nadie recordaba el precio de
 * la vez anterior. Los importes se llevan a soles con el tipo de cambio de la
 * operación: comparar 100 dólares contra 350 soles a ojo no dice nada.
 *
 * Mira las compras **y las importaciones**. Dejar fuera los embarques sería
 * dejar fuera casi todo el abastecimiento de un importador: la serie de precios
 * saldría con dos entradas y parecería que el producto casi no se compra.
 *
 * De la importación se traen dos cifras distintas y hay que no confundirlas: el
 * FOB unitario, que es lo que cobra el exportador, y el costo unitario puesto
 * en almacén, que sale de la liquidación con el flete, los derechos y la
 * agencia ya prorrateados.
 */
export async function preciosHistoricos(
  db: Db,
  productoId: string,
  limite = 30,
): Promise<PrecioHistorico[]> {
  const filas = (await db.execute(sql`
    SELECT co.fecha_emision::text AS fecha, 'compra' AS origen,
           co.serie || '-' || co.numero AS documento,
           co.moneda, co.tipo_cambio::text AS tipo_cambio,
           t.id::text AS proveedor_id, t.razon_social AS proveedor,
           i.cantidad::text AS cantidad, i.valor_unitario::text AS valor_unitario,
           NULL::text AS costo_unitario
    FROM compra_items i
    JOIN compras co ON co.id = i.compra_id
    JOIN terceros t ON t.id = co.proveedor_id
    WHERE i.producto_id = ${productoId}
      AND co.estado <> 'anulada'

    UNION ALL

    SELECT coalesce(im.fecha_nacionalizacion, im.fecha_llegada, im.fecha_orden)::text AS fecha,
           'importacion' AS origen,
           im.numero AS documento,
           im.moneda, im.tipo_cambio::text AS tipo_cambio,
           t.id::text AS proveedor_id, t.razon_social AS proveedor,
           ii.cantidad::text AS cantidad, ii.fob_unitario::text AS valor_unitario,
           -- El costo puesto en almacén sólo existe si el embarque se liquidó.
           (SELECT li.costo_unitario::text FROM liquidacion_items li
             JOIN liquidaciones l ON l.id = li.liquidacion_id
            WHERE li.importacion_item_id = ii.id AND l.estado = 'confirmada'
            LIMIT 1) AS costo_unitario
    FROM importacion_items ii
    JOIN importaciones im ON im.id = ii.importacion_id
    JOIN terceros t ON t.id = im.proveedor_id
    WHERE ii.producto_id = ${productoId}
      AND im.estado <> 'anulada'

    ORDER BY fecha DESC, documento DESC
    LIMIT ${limite}`)) as unknown as {
    fecha: string;
    origen: "compra" | "importacion";
    documento: string;
    moneda: string;
    tipo_cambio: string;
    proveedor_id: string;
    proveedor: string;
    cantidad: string;
    valor_unitario: string;
    costo_unitario: string | null;
  }[];

  // Van de la más reciente a la más antigua; la variación se mide contra la
  // compra inmediatamente anterior, que es la que está una fila más abajo.
  const lista = [...filas];
  return lista.map((f, i) => {
    const enSoles = money.round(money.mul(dec(f.valor_unitario), dec(f.tipo_cambio)), 6);
    const anterior = lista[i + 1];
    const previo = anterior
      ? money.round(money.mul(dec(anterior.valor_unitario), dec(anterior.tipo_cambio)), 6)
      : null;

    return {
      fecha: f.fecha,
      origen: f.origen,
      documento: f.documento,
      proveedorId: f.proveedor_id,
      proveedor: f.proveedor,
      moneda: f.moneda,
      cantidad: money.toString(dec(f.cantidad), 2),
      valorUnitario: money.toString(dec(f.valor_unitario), 4),
      valorUnitarioSoles: money.toString(enSoles, 4),
      costoUnitarioSoles:
        f.costo_unitario === null ? null : money.toString(dec(f.costo_unitario), 4),
      variacion:
        previo === null || money.isZero(previo)
          ? null
          : money.toString(
              money.round(
                money.mul(money.div(money.sub(enSoles, previo), previo), money.dec("100")),
                2,
              ),
              2,
            ),
    };
  });
}
