/**
 * Reportes de conjunto de importaciones. Pregunta 16 del cuestionario: «sí».
 *
 * La pantalla de detalle responde «¿cómo va este embarque?». Estos cuatro
 * responden preguntas que ninguna ficha contesta: qué tengo en el agua, a qué
 * agencia le pago de verdad, a qué proveedor del exterior le compro y qué
 * artículos traigo.
 *
 * Tres decisiones gobiernan los cuatro:
 *
 * **Todo en soles.** Cada embarque tiene su propio tipo de cambio y cada gasto
 * el suyo. Sumar dólares de enero con dólares de noviembre da un número que no
 * significa nada; el equivalente en soles al tipo de cambio de cada operación
 * es la única suma comparable, y es además la que cuadra con la contabilidad.
 *
 * **El FOB y el costo puesto en almacén no se mezclan.** Son las dos cifras que
 * un importador necesita separadas: el FOB es lo que cobra el exportador, el
 * costo puesto en almacén sale de la liquidación con flete, derechos y agencia
 * prorrateados. Presentarlas como una sola es el camino corto para creer que
 * importar sale más barato de lo que sale.
 *
 * **Lo que no está liquidado se dice, no se estima.** Un embarque en tránsito no
 * tiene costo final. Rellenarlo con el FOB daría un margen inventado; aquí sale
 * en blanco y la fila avisa de que aún no está.
 */
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { type Db } from "@roulterp/db";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export type Rango = { desde: string; hasta: string };

// ─── 1. Importaciones pendientes de llegar ────────────────────────────────

export type PendienteDeLlegar = {
  id: string;
  numero: string;
  proveedor: string;
  estado: string;
  fechaOrden: string;
  /** Lo pactado. Puede no haberse fijado todavía. */
  fechaLlegada: string | null;
  incoterm: string | null;
  puertoOrigen: string | null;
  /** FOB del embarque en su moneda y su equivalente en soles. */
  moneda: string;
  fob: string;
  fobSoles: string;
  /** Días desde la orden. Es la cifra que enseña cuál se quedó atrás. */
  diasEnCurso: number;
  /**
   * Días de retraso sobre la llegada pactada. Cero si no ha vencido, `null` si
   * nadie fijó fecha: no es lo mismo «llega a tiempo» que «no se sabe cuándo».
   */
  diasRetraso: number | null;
  /** Documentos que ya hacían falta y no están. */
  documentosVencidos: number;
};

/**
 * Lo que está en el agua o en aduana.
 *
 * Un embarque liquidado o anulado ya no es una pregunta abierta y no sale. El
 * orden es por retraso y no por fecha: la lista existe para decidir a quién se
 * llama hoy.
 */
export async function pendientesDeLlegar(db: Db, hoy = new Date()): Promise<PendienteDeLlegar[]> {
  const ref = hoy.toISOString().slice(0, 10);
  const filas = (await db.execute(sql`
    SELECT im.id::text, im.numero, t.razon_social AS proveedor, im.estado,
           im.fecha_orden::text, im.fecha_llegada::text, im.incoterm,
           im.puerto_origen, im.moneda, im.tipo_cambio::text AS tipo_cambio,
           coalesce((SELECT sum(ii.cantidad * ii.fob_unitario) FROM importacion_items ii
                      WHERE ii.importacion_id = im.id), 0)::text AS fob,
           (${ref}::date - im.fecha_orden)::int AS dias_en_curso,
           CASE WHEN im.fecha_llegada IS NULL THEN NULL
                ELSE greatest(0, (${ref}::date - im.fecha_llegada)::int) END AS dias_retraso
    FROM importaciones im
    JOIN terceros t ON t.id = im.proveedor_id
    WHERE im.estado NOT IN ('liquidada', 'anulada')
    ORDER BY dias_retraso DESC NULLS LAST, im.fecha_orden ASC`)) as unknown as {
    id: string; numero: string; proveedor: string; estado: string;
    fecha_orden: string; fecha_llegada: string | null; incoterm: string | null;
    puerto_origen: string | null; moneda: string; tipo_cambio: string; fob: string;
    dias_en_curso: number; dias_retraso: number | null;
  }[];

  // El expediente se cuenta en una sola consulta: pedirlo embarque a embarque
  // haría N+1 sobre una pantalla que se abre todas las mañanas.
  const faltas = (await db.execute(sql`
    SELECT im.id::text AS id,
           count(*) FILTER (
             WHERE d.recibido_en IS NULL AND NOT d.no_aplica
           )::int AS anotados_sin_llegar
    FROM importaciones im
    LEFT JOIN importacion_documentos d ON d.importacion_id = im.id
    WHERE im.estado NOT IN ('liquidada', 'anulada')
    GROUP BY im.id`)) as unknown as { id: string; anotados_sin_llegar: number }[];
  const porId = new Map(faltas.map((f) => [f.id, f.anotados_sin_llegar]));

  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    proveedor: f.proveedor,
    estado: f.estado,
    fechaOrden: f.fecha_orden,
    fechaLlegada: f.fecha_llegada,
    incoterm: f.incoterm,
    puertoOrigen: f.puerto_origen,
    moneda: f.moneda,
    fob: txt2(dec(f.fob)),
    fobSoles: txt2(money.mul(dec(f.fob), dec(f.tipo_cambio))),
    diasEnCurso: f.dias_en_curso,
    diasRetraso: f.dias_retraso,
    documentosVencidos: porId.get(f.id) ?? 0,
  }));
}

// ─── 2. Gasto por agencia de aduanas ──────────────────────────────────────

export type GastoPorAgencia = {
  proveedorId: string | null;
  proveedor: string;
  /** Cuántos embarques y cuántas pólizas le pasaron por las manos. */
  embarques: number;
  conceptos: number;
  /** Siempre en soles: cada gasto trae su propio tipo de cambio. */
  importe: string;
  /**
   * Lo que **no** engorda el costo: el IGV, el IPM y la percepción. Se separa
   * porque es crédito fiscal y no gasto, y sumarlo haría parecer que la agencia
   * cobra un 18 % más de lo que cobra.
   */
  importeRecuperable: string;
};

export async function gastoPorAgencia(db: Db, rango: Rango): Promise<GastoPorAgencia[]> {
  const filas = (await db.execute(sql`
    SELECT t.id::text AS proveedor_id,
           coalesce(t.razon_social, '(sin proveedor indicado)') AS proveedor,
           count(DISTINCT coalesce(g.importacion_id, g.poliza_id))::int AS embarques,
           count(*)::int AS conceptos,
           sum(g.importe * g.tipo_cambio) FILTER (WHERE g.afecta_costo)::text AS importe,
           coalesce(sum(g.importe * g.tipo_cambio) FILTER (WHERE NOT g.afecta_costo), 0)::text
             AS importe_recuperable
    FROM importacion_gastos g
    LEFT JOIN terceros t ON t.id = g.proveedor_id
    WHERE coalesce(g.fecha, g.creado_en::date) BETWEEN ${rango.desde}::date AND ${rango.hasta}::date
    GROUP BY t.id, t.razon_social
    ORDER BY sum(g.importe * g.tipo_cambio) DESC`)) as unknown as {
    proveedor_id: string | null; proveedor: string; embarques: number;
    conceptos: number; importe: string | null; importe_recuperable: string;
  }[];

  return filas.map((f) => ({
    proveedorId: f.proveedor_id,
    proveedor: f.proveedor,
    embarques: f.embarques,
    conceptos: f.conceptos,
    importe: txt2(dec(f.importe)),
    importeRecuperable: txt2(dec(f.importe_recuperable)),
  }));
}

// ─── 3. Compras por proveedor del exterior ────────────────────────────────

export type CompraExterior = {
  proveedorId: string;
  proveedor: string;
  pais: string;
  embarques: number;
  moneda: string;
  fob: string;
  fobSoles: string;
  /**
   * Costo puesto en almacén de los embarques **liquidados**, y cuántos son.
   * Sin ese contador la cifra engaña: doce embarques con dos liquidados daría
   * un costo que parece del año entero.
   */
  costoAlmacen: string;
  embarquesLiquidados: number;
};

export async function comprasPorProveedorExterior(
  db: Db,
  rango: Rango,
): Promise<CompraExterior[]> {
  const filas = (await db.execute(sql`
    SELECT t.id::text AS proveedor_id, t.razon_social AS proveedor, t.pais,
           count(DISTINCT im.id)::int AS embarques,
           min(im.moneda) AS moneda,
           coalesce(sum(ii.cantidad * ii.fob_unitario), 0)::text AS fob,
           coalesce(sum(ii.cantidad * ii.fob_unitario * im.tipo_cambio), 0)::text AS fob_soles,
           coalesce(sum(
             CASE WHEN l.estado = 'confirmada' THEN li.cantidad * li.costo_unitario END
           ), 0)::text AS costo_almacen,
           count(DISTINCT im.id) FILTER (WHERE l.estado = 'confirmada')::int AS liquidados
    FROM importaciones im
    JOIN terceros t ON t.id = im.proveedor_id
    LEFT JOIN importacion_items ii ON ii.importacion_id = im.id
    LEFT JOIN liquidacion_items li ON li.importacion_item_id = ii.id
    LEFT JOIN liquidaciones l ON l.id = li.liquidacion_id
    WHERE im.estado <> 'anulada'
      AND im.fecha_orden BETWEEN ${rango.desde}::date AND ${rango.hasta}::date
    GROUP BY t.id, t.razon_social, t.pais
    ORDER BY sum(ii.cantidad * ii.fob_unitario * im.tipo_cambio) DESC NULLS LAST`)) as unknown as {
    proveedor_id: string; proveedor: string; pais: string; embarques: number;
    moneda: string; fob: string; fob_soles: string; costo_almacen: string; liquidados: number;
  }[];

  return filas.map((f) => ({
    proveedorId: f.proveedor_id,
    proveedor: f.proveedor,
    pais: f.pais,
    embarques: f.embarques,
    moneda: f.moneda,
    fob: txt2(dec(f.fob)),
    fobSoles: txt2(dec(f.fob_soles)),
    costoAlmacen: txt2(dec(f.costo_almacen)),
    embarquesLiquidados: f.liquidados,
  }));
}

// ─── 4. Artículos más importados ──────────────────────────────────────────

export type ArticuloImportado = {
  productoId: string;
  codigo: string;
  nombre: string;
  unidad: string | null;
  cantidad: string;
  embarques: number;
  fobSoles: string;
  /** Costo puesto en almacén, sólo de lo liquidado. */
  costoAlmacen: string;
  cantidadLiquidada: string;
  /**
   * Cuánto encarece el viaje, en tanto por ciento sobre el FOB. Se calcula
   * **sólo con la parte liquidada** y vale `null` si no hay ninguna: es el
   * número que dice si conviene importar, y estimarlo lo volvería inútil.
   */
  sobrecosto: string | null;
};

export async function articulosMasImportados(
  db: Db,
  rango: Rango,
  limite = 50,
): Promise<ArticuloImportado[]> {
  const filas = (await db.execute(sql`
    SELECT p.id::text AS producto_id, p.codigo, p.descripcion AS nombre, u.codigo AS unidad,
           sum(ii.cantidad)::text AS cantidad,
           count(DISTINCT im.id)::int AS embarques,
           sum(ii.cantidad * ii.fob_unitario * im.tipo_cambio)::text AS fob_soles,
           coalesce(sum(
             CASE WHEN l.estado = 'confirmada' THEN li.cantidad * li.costo_unitario END
           ), 0)::text AS costo_almacen,
           coalesce(sum(CASE WHEN l.estado = 'confirmada' THEN li.cantidad END), 0)::text
             AS cantidad_liquidada,
           coalesce(sum(
             CASE WHEN l.estado = 'confirmada'
               THEN ii.cantidad * ii.fob_unitario * im.tipo_cambio END
           ), 0)::text AS fob_liquidado
    FROM importacion_items ii
    JOIN importaciones im ON im.id = ii.importacion_id
    JOIN productos p ON p.id = ii.producto_id
    LEFT JOIN unidades_medida u ON u.id = p.unidad_id
    LEFT JOIN liquidacion_items li ON li.importacion_item_id = ii.id
    LEFT JOIN liquidaciones l ON l.id = li.liquidacion_id
    WHERE im.estado <> 'anulada'
      AND im.fecha_orden BETWEEN ${rango.desde}::date AND ${rango.hasta}::date
    GROUP BY p.id, p.codigo, p.descripcion, u.codigo
    ORDER BY sum(ii.cantidad * ii.fob_unitario * im.tipo_cambio) DESC
    LIMIT ${limite}`)) as unknown as {
    producto_id: string; codigo: string; nombre: string; unidad: string | null;
    cantidad: string; embarques: number; fob_soles: string; costo_almacen: string;
    cantidad_liquidada: string; fob_liquidado: string;
  }[];

  return filas.map((f) => {
    const fobLiq = dec(f.fob_liquidado);
    const costo = dec(f.costo_almacen);
    return {
      productoId: f.producto_id,
      codigo: f.codigo,
      nombre: f.nombre,
      unidad: f.unidad,
      cantidad: txt2(dec(f.cantidad)),
      embarques: f.embarques,
      fobSoles: txt2(dec(f.fob_soles)),
      costoAlmacen: txt2(costo),
      cantidadLiquidada: txt2(dec(f.cantidad_liquidada)),
      sobrecosto: money.isZero(fobLiq)
        ? null
        : txt2(money.mul(money.div(money.sub(costo, fobLiq), fobLiq), money.dec("100"))),
    };
  });
}
