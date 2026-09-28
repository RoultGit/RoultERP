/**
 * Reportes de gestión: lo que se mira para decidir, no para declarar.
 *
 * Los libros y los formatos de SUNAT viven en `ple.ts` y `contabilidad.ts`.
 * Aquí está lo otro: qué se vende, cuánto se gana con ello, y cuánto tiempo
 * pasa la mercadería en el almacén antes de salir.
 *
 * Todos leen y ninguno escribe. Las cifras salen del kardex y de los
 * comprobantes emitidos, que son las dos fuentes que ya cuadran contra la
 * contabilidad: calcular el margen con una lista de precios daría un número
 * distinto al de la cuenta 69 y nadie sabría cuál creer.
 */
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { type Db } from "@roulterp/db";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

// ─── Ranking de ventas ────────────────────────────────────────────────────

export type LineaRanking = {
  id: string;
  codigo: string;
  nombre: string;
  cantidad: string;
  /** Valor de venta, sin IGV: es lo comparable entre facturas y boletas. */
  venta: string;
  costo: string;
  margen: string;
  /** Margen sobre la venta, en porcentaje con dos decimales. */
  margenPorcentaje: string;
  participacion: string;
  documentos: number;
};

/**
 * Qué se vendió más y con cuánto margen, por artículo o por cliente.
 *
 * El costo sale del costo unitario que la venta guardó al descargar el kardex,
 * no de una lista: es el mismo importe que fue al asiento como costo de ventas,
 * así que el margen de este reporte y el del estado de resultados coinciden.
 *
 * Una venta sin almacén —un servicio, una venta de mercadería ya despachada—
 * no tiene costo y aparece con margen igual a la venta. No es un error: es
 * exactamente lo que dice la contabilidad de esa operación.
 */
export async function rankingVentas(
  db: Db,
  rango: { desde: string; hasta: string },
  por: "articulo" | "cliente" = "articulo",
): Promise<{ lineas: LineaRanking[]; total: { venta: string; costo: string; margen: string } }> {
  const agrupaPorArticulo = por === "articulo";

  // Las notas de crédito restan y las de débito suman: se identifican por el
  // tipo de documento y su total ya viene con el signo que corresponde en el
  // catálogo, así que aquí se invierte el signo de las de crédito a mano.
  const signo = sql`CASE WHEN c.tipo_documento = '07' THEN -1 ELSE 1 END`;

  const filas = (await db.execute(sql`
    SELECT ${
      agrupaPorArticulo
        ? sql`coalesce(p.id::text, 'sin-producto') AS id,
              coalesce(p.codigo, 'SERV') AS codigo,
              coalesce(p.descripcion, i.descripcion) AS nombre`
        : sql`t.id::text AS id, t.numero_documento AS codigo, t.razon_social AS nombre`
    },
           sum(${signo} * i.cantidad)::text AS cantidad,
           sum(${signo} * i.valor_venta)::text AS venta,
           sum(${signo} * i.cantidad * coalesce(i.costo_unitario, 0))::text AS costo,
           count(DISTINCT c.id)::int AS documentos
    FROM comprobante_items i
    JOIN comprobantes c ON c.id = i.comprobante_id
    JOIN terceros t ON t.id = c.cliente_id
    LEFT JOIN productos p ON p.id = i.producto_id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03', '07', '08')
      AND c.fecha_emision BETWEEN ${rango.desde} AND ${rango.hasta}
    GROUP BY ${
      agrupaPorArticulo ? sql`p.id, p.codigo, p.descripcion, i.descripcion` : sql`t.id`
    }
    ORDER BY sum(${signo} * i.valor_venta) DESC`)) as unknown as {
    id: string;
    codigo: string;
    nombre: string;
    cantidad: string;
    venta: string;
    costo: string;
    documentos: number;
  }[];

  const ventaTotal = [...filas].reduce<Dec>((a, f) => money.add(a, dec(f.venta)), money.ZERO);
  const costoTotal = [...filas].reduce<Dec>((a, f) => money.add(a, dec(f.costo)), money.ZERO);

  const lineas = [...filas].map((f) => {
    const venta = dec(f.venta);
    const costo = dec(f.costo);
    const margen = money.sub(venta, costo);
    return {
      id: f.id,
      codigo: f.codigo,
      nombre: f.nombre,
      cantidad: money.toString(dec(f.cantidad), 2),
      venta: txt2(venta),
      costo: txt2(costo),
      margen: txt2(margen),
      margenPorcentaje: money.isZero(venta)
        ? "0.00"
        : money.toString(money.round(money.mul(money.div(margen, venta), money.dec("100")), 2), 2),
      participacion: money.isZero(ventaTotal)
        ? "0.00"
        : money.toString(
            money.round(money.mul(money.div(venta, ventaTotal), money.dec("100")), 2),
            2,
          ),
      documentos: f.documentos,
    };
  });

  return {
    lineas,
    total: {
      venta: txt2(ventaTotal),
      costo: txt2(costoTotal),
      margen: txt2(money.sub(ventaTotal, costoTotal)),
    },
  };
}

// ─── Stock mensual ────────────────────────────────────────────────────────

export type LineaStockMensual = {
  productoId: string;
  codigo: string;
  descripcion: string;
  almacen: string;
  inicial: string;
  ingresos: string;
  salidas: string;
  final: string;
  valorFinal: string;
};

/**
 * Saldo inicial, movimientos y saldo final de cada producto en un mes.
 *
 * Es el resumen que un jefe de almacén mira el día 1: qué había, qué entró, qué
 * salió y qué queda. El detalle movimiento a movimiento ya está en el kardex;
 * esto es la vista de arriba.
 */
export async function stockMensual(
  db: Db,
  periodo: string,
  almacenId?: string,
): Promise<LineaStockMensual[]> {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(4, 6));
  const desde = `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-01`;
  const siguiente = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
  const filtro = almacenId ? sql`AND m.almacen_id = ${almacenId}` : sql``;

  const filas = (await db.execute(sql`
    SELECT m.producto_id::text AS producto_id, p.codigo, p.descripcion, a.nombre AS almacen,
           sum(CASE WHEN m.fecha < ${desde}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.cantidad ELSE -m.cantidad END
                    ELSE 0 END)::text AS inicial,
           sum(CASE WHEN m.fecha >= ${desde} AND m.fecha < ${siguiente} AND m.sentido = 'ingreso'
                    THEN m.cantidad ELSE 0 END)::text AS ingresos,
           sum(CASE WHEN m.fecha >= ${desde} AND m.fecha < ${siguiente} AND m.sentido = 'salida'
                    THEN m.cantidad ELSE 0 END)::text AS salidas,
           sum(CASE WHEN m.fecha < ${siguiente}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.cantidad ELSE -m.cantidad END
                    ELSE 0 END)::text AS final,
           sum(CASE WHEN m.fecha < ${siguiente}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.importe_total ELSE -m.importe_total END
                    ELSE 0 END)::text AS valor_final
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    JOIN almacenes a ON a.id = m.almacen_id
    WHERE m.fecha < ${siguiente} ${filtro}
    GROUP BY m.producto_id, p.codigo, p.descripcion, a.nombre
    HAVING sum(CASE WHEN m.fecha >= ${desde} AND m.fecha < ${siguiente} THEN 1 ELSE 0 END) > 0
        OR sum(CASE WHEN m.fecha < ${siguiente}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.cantidad ELSE -m.cantidad END
                    ELSE 0 END) <> 0
    ORDER BY p.codigo, a.nombre`)) as unknown as {
    producto_id: string;
    codigo: string;
    descripcion: string;
    almacen: string;
    inicial: string;
    ingresos: string;
    salidas: string;
    final: string;
    valor_final: string;
  }[];

  return [...filas].map((f) => ({
    productoId: f.producto_id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    almacen: f.almacen,
    inicial: money.toString(dec(f.inicial), 2),
    ingresos: money.toString(dec(f.ingresos), 2),
    salidas: money.toString(dec(f.salidas), 2),
    final: money.toString(dec(f.final), 2),
    valorFinal: txt2(dec(f.valor_final)),
  }));
}

// ─── Rotación ─────────────────────────────────────────────────────────────

export type LineaRotacion = {
  productoId: string;
  codigo: string;
  descripcion: string;
  /** Costo de lo que salió en el periodo. */
  consumo: string;
  /** Media entre el saldo inicial y el final, valorizada. */
  stockPromedio: string;
  /** Consumo entre stock promedio: cuántas veces se renovó el almacén. */
  vueltas: string;
  /** Días que tarda en venderse lo que hay. Cuanto más alto, peor. */
  diasEnAlmacen: string;
  /** Sin salidas en el periodo: candidato a promoción o a baja. */
  sinMovimiento: boolean;
};

/**
 * Rotación del inventario.
 *
 * Contesta la pregunta que más plata mueve en un importador: cuánto tiempo
 * duerme la mercadería antes de venderse. Un artículo con cero vueltas y stock
 * es capital inmovilizado, y normalmente nadie lo nota porque en el balance
 * figura como activo.
 *
 * Se calcula sobre **costos**, no sobre precios de venta: la rotación mide
 * cuántas veces se renovó lo invertido, y mezclar costo con precio infla el
 * resultado por el margen.
 */
export async function rotacionInventario(
  db: Db,
  rango: { desde: string; hasta: string },
  almacenId?: string,
): Promise<LineaRotacion[]> {
  const filtro = almacenId ? sql`AND m.almacen_id = ${almacenId}` : sql``;
  const dias = Math.max(
    Math.round(
      (Date.parse(`${rango.hasta}T00:00:00Z`) - Date.parse(`${rango.desde}T00:00:00Z`)) / 86400000,
    ) + 1,
    1,
  );

  const filas = (await db.execute(sql`
    SELECT m.producto_id::text AS producto_id, p.codigo, p.descripcion,
           sum(CASE WHEN m.fecha BETWEEN ${rango.desde} AND ${rango.hasta} AND m.sentido = 'salida'
                    THEN m.importe_total ELSE 0 END)::text AS consumo,
           sum(CASE WHEN m.fecha < ${rango.desde}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.importe_total ELSE -m.importe_total END
                    ELSE 0 END)::text AS valor_inicial,
           sum(CASE WHEN m.fecha <= ${rango.hasta}
                    THEN CASE WHEN m.sentido = 'ingreso' THEN m.importe_total ELSE -m.importe_total END
                    ELSE 0 END)::text AS valor_final
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    WHERE m.fecha <= ${rango.hasta} ${filtro}
    GROUP BY m.producto_id, p.codigo, p.descripcion
    ORDER BY p.codigo`)) as unknown as {
    producto_id: string;
    codigo: string;
    descripcion: string;
    consumo: string;
    valor_inicial: string;
    valor_final: string;
  }[];

  const dosDec = money.dec("2");
  const cien = money.dec(String(dias));

  return [...filas]
    .map((f) => {
      const consumo = dec(f.consumo);
      const promedio = money.round(
        money.div(money.add(dec(f.valor_inicial), dec(f.valor_final)), dosDec),
        2,
      );
      // Sin stock promedio no hay rotación que calcular: dividir daría infinito
      // y lo honesto es decir que no aplica.
      const hayStock = money.gt(promedio, money.ZERO);
      const vueltas = hayStock ? money.round(money.div(consumo, promedio), 2) : money.ZERO;
      const diasEnAlmacen =
        hayStock && money.gt(consumo, money.ZERO)
          ? money.round(money.div(money.mul(promedio, cien), consumo), 1)
          : money.ZERO;

      return {
        productoId: f.producto_id,
        codigo: f.codigo,
        descripcion: f.descripcion,
        consumo: txt2(consumo),
        stockPromedio: txt2(promedio),
        vueltas: money.toString(vueltas, 2),
        diasEnAlmacen: money.toString(diasEnAlmacen, 1),
        sinMovimiento: money.isZero(consumo) && hayStock,
      };
    })
    // Lo que no tiene ni consumo ni stock no informa de nada.
    .filter((l) => !money.isZero(dec(l.consumo)) || !money.isZero(dec(l.stockPromedio)));
}
