/**
 * Movimientos de inventario y kardex valorizado.
 *
 * El problema que resuelve este archivo no es calcular el kardex —eso lo hace
 * `core/inventario`, sin base de datos y con pruebas— sino mantenerlo correcto
 * cuando el mundo real interfiere:
 *
 * 1. **Concurrencia.** Dos usuarios que despachan el mismo producto a la vez
 *    leerían el mismo saldo y calcularían el mismo costo de salida. Se
 *    serializa bloqueando la fila de saldo con `SELECT … FOR UPDATE`; el
 *    segundo espera y ve el saldo que dejó el primero.
 *
 * 2. **Registros atrasados.** La factura de compra del lunes se captura el
 *    jueves, después de haber vendido. El kardex es una secuencia, así que
 *    insertar un movimiento en medio invalida el costo de todos los
 *    posteriores. Cuando eso pasa se reproduce la historia completa del
 *    producto en ese almacén y se corrigen los costos aguas abajo, que es
 *    exactamente lo que hace un contador a mano y lo que Starsoft llama
 *    «recalcular kardex».
 */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { money, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { movimientosInventario, saldosInventario, almacenes, productos, empresas, lotes } = s;

type Dec = money.Dec;

export type EntradaMovimiento = {
  almacenId: string;
  productoId: string;
  /** AAAA-MM-DD */
  fecha: string;
  sentido: "ingreso" | "salida";
  tipoOperacion: string;
  cantidad: Dec;
  /** Obligatorio al ingresar; se ignora al salir. */
  costoUnitario?: Dec;
  /**
   * Importe exacto del ingreso, cuando quien llama lo conoce con más precisión
   * que `cantidad × costoUnitario`. Lo usa la liquidación de importación, donde
   * el costo unitario suele no ser representable en seis decimales.
   */
  importeTotal?: Dec;
  lote?: string;
  serie?: string;
  origenModulo?: string;
  origenId?: string;
};

export type MovimientoRegistrado = {
  id: string;
  costoUnitario: string;
  importeTotal: string;
  saldoCantidad: string;
  saldoValor: string;
  recalculado: boolean;
};

export class InventarioInvalido extends ErrorDeNegocio {
  constructor(motivo: string) {
    super(motivo, "InventarioInvalido");
  }
}

const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt = (v: Dec, d = 6): string => money.toString(v, d);

/** Método de valorización y política de stock negativo, por empresa. */
async function politica(db: Db, empresaId: string): Promise<kardex.OpcionesKardex> {
  const [emp] = await db
    .select({ metodo: empresas.metodoValorizacion })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  const metodo = emp?.metodo === "peps" ? "peps" : "promedio";
  // El stock negativo se rechaza salvo que la empresa lo pida: casi siempre es
  // un error de captura, y valoriza una salida a un costo que nadie pagó.
  return { metodo, permitirNegativo: false };
}

/**
 * Registra un movimiento y devuelve su costo ya calculado.
 *
 * Debe llamarse dentro de una transacción con el contexto de empresa fijado
 * (`enEmpresa`), porque el bloqueo de la fila de saldo sólo sirve mientras la
 * transacción siga abierta.
 */
export async function registrarMovimiento(
  db: Db,
  empresaId: string,
  entrada: EntradaMovimiento,
): Promise<MovimientoRegistrado> {
  if (!money.gt(entrada.cantidad, money.ZERO)) {
    throw new InventarioInvalido("la cantidad debe ser mayor que cero");
  }
  if (entrada.sentido === "ingreso" && entrada.costoUnitario === undefined) {
    throw new InventarioInvalido("un ingreso necesita costo unitario");
  }
  await exigirProductoAlmacen(db, entrada);

  const opts = await politica(db, empresaId);
  const saldo = await bloquearSaldo(db, empresaId, entrada.almacenId, entrada.productoId);

  // ¿Llega después de todo lo registrado, o se está intercalando en el pasado?
  const [ultimo] = await db
    .select({ fecha: movimientosInventario.fecha, orden: movimientosInventario.orden })
    .from(movimientosInventario)
    .where(
      and(
        eq(movimientosInventario.almacenId, entrada.almacenId),
        eq(movimientosInventario.productoId, entrada.productoId),
      ),
    )
    .orderBy(sql`fecha DESC, orden DESC`)
    .limit(1);

  const esPosterior = !ultimo || entrada.fecha >= ultimo.fecha;
  const orden = (ultimo?.orden ?? 0) + 1;

  if (esPosterior) {
    // Camino rápido: el movimiento va al final, así que basta con aplicarlo
    // sobre el saldo que ya está calculado.
    const estado = estadoDesde(saldo, opts);
    const mov = aMovimientoDominio(entrada, "nuevo");
    const { estado: siguiente, linea } = kardex.aplicar(estado, mov, opts);

    const [fila] = await db
      .insert(movimientosInventario)
      .values(valoresFila(empresaId, entrada, orden, linea))
      .returning({ id: movimientosInventario.id });

    await guardarSaldo(db, empresaId, entrada, siguiente, fila!.id);

    return {
      id: fila!.id,
      costoUnitario: txt(costoDe(linea)),
      importeTotal: txt(importeDe(linea)),
      saldoCantidad: txt(siguiente.cantidad),
      saldoValor: txt(siguiente.valor),
      recalculado: false,
    };
  }

  // Camino lento: se inserta y se reproduce la historia entera.
  //
  // El importe del ingreso se calcula ya aquí, no se deja en cero a la espera
  // del recálculo: para un ingreso, lo que costó la compra es un hecho, y el
  // recálculo lo respeta en vez de recomputarlo. Sólo las salidas cambian de
  // costo, porque el suyo sí depende del método y de lo que haya antes.
  const importeIngreso =
    entrada.sentido === "ingreso"
      ? txt(
          entrada.importeTotal ??
            money.round(money.mul(entrada.cantidad, entrada.costoUnitario ?? money.ZERO), 6),
        )
      : "0";

  const [fila] = await db
    .insert(movimientosInventario)
    .values({
      empresaId,
      almacenId: entrada.almacenId,
      productoId: entrada.productoId,
      fecha: entrada.fecha,
      orden,
      sentido: entrada.sentido,
      tipoOperacion: entrada.tipoOperacion,
      cantidad: txt(entrada.cantidad),
      costoUnitario: txt(entrada.costoUnitario ?? money.ZERO),
      importeTotal: importeIngreso,
      lote: entrada.lote ?? null,
      serie: entrada.serie ?? null,
      origenModulo: entrada.origenModulo ?? null,
      origenId: entrada.origenId ?? null,
    })
    .returning({ id: movimientosInventario.id });

  const resultado = await recalcular(db, empresaId, entrada.almacenId, entrada.productoId);
  const propio = resultado.porMovimiento.get(fila!.id);

  return {
    id: fila!.id,
    costoUnitario: propio?.costoUnitario ?? "0",
    importeTotal: propio?.importeTotal ?? "0",
    saldoCantidad: txt(resultado.estado.cantidad),
    saldoValor: txt(resultado.estado.valor),
    recalculado: true,
  };
}

/**
 * Reproduce toda la historia de un producto en un almacén y reescribe los
 * costos de cada movimiento.
 *
 * Es la operación que devuelve la coherencia después de un registro atrasado, y
 * también la que se corre antes de cerrar un mes para comprobar que el saldo
 * almacenado coincide con el que sale de los movimientos.
 *
 * ponytail: reproduce en memoria y actualiza fila por fila. Techo: con
 * historias de más de unas decenas de miles de movimientos conviene moverlo a
 * la cola de trabajos y acotar el recálculo al periodo abierto.
 */
export async function recalcular(
  db: Db,
  empresaId: string,
  almacenId: string,
  productoId: string,
): Promise<{
  estado: kardex.EstadoKardex;
  lineas: kardex.LineaKardex[];
  porMovimiento: Map<string, { costoUnitario: string; importeTotal: string }>;
}> {
  const opts = await politica(db, empresaId);

  const filas = await db
    .select()
    .from(movimientosInventario)
    .where(
      and(
        eq(movimientosInventario.almacenId, almacenId),
        eq(movimientosInventario.productoId, productoId),
      ),
    )
    .orderBy(asc(movimientosInventario.fecha), asc(movimientosInventario.orden));

  const movimientos: kardex.Movimiento[] = filas.map((f) => ({
    id: f.id,
    fecha: new Date(`${f.fecha}T00:00:00Z`),
    sentido: f.sentido as "ingreso" | "salida",
    tipoOperacion: f.tipoOperacion as kardex.TipoOperacion,
    cantidad: dec(f.cantidad),
    ...(f.sentido === "ingreso"
      ? { costoUnitario: dec(f.costoUnitario), importeTotal: dec(f.importeTotal) }
      : {}),
  }));

  // Al reproducir se permite el negativo transitorio: una salida que quedó
  // antes de su ingreso mientras se corrige el orden no debe abortar el
  // recálculo entero, que es justo lo que viene a arreglarlo.
  const { lineas, estado } = kardex.construir(movimientos, { ...opts, permitirNegativo: true });

  const porMovimiento = new Map<string, { costoUnitario: string; importeTotal: string }>();
  for (const linea of lineas) {
    const costo = txt(costoDe(linea));
    const importe = txt(importeDe(linea));
    porMovimiento.set(linea.movimiento.id, { costoUnitario: costo, importeTotal: importe });

    await db
      .update(movimientosInventario)
      .set({
        costoUnitario: costo,
        importeTotal: importe,
        consumos: linea.consumos.length
          ? linea.consumos.map((c) => ({
              cantidad: txt(c.cantidad),
              costoUnitario: txt(c.costoUnitario),
              importe: txt(c.importe),
            }))
          : null,
      })
      .where(eq(movimientosInventario.id, linea.movimiento.id));
  }

  await db
    .insert(saldosInventario)
    .values({
      empresaId,
      almacenId,
      productoId,
      cantidad: txt(estado.cantidad),
      valor: txt(estado.valor),
      capas: serializarCapas(estado.capas),
    })
    .onConflictDoUpdate({
      target: [saldosInventario.empresaId, saldosInventario.almacenId, saldosInventario.productoId],
      set: {
        cantidad: txt(estado.cantidad),
        valor: txt(estado.valor),
        capas: serializarCapas(estado.capas),
      },
    });

  return { estado, lineas, porMovimiento };
}

/** Una línea del kardex, con el documento que la causó. */
export type LineaKardexDe = {
  id: string;
  fecha: string;
  orden: number;
  sentido: string;
  tipoOperacion: string;
  cantidad: string;
  costoUnitario: string;
  importeTotal: string;
  consumos: unknown;
  lote: string | null;
  serie: string | null;
  origenModulo: string | null;
  origenId: string | null;
  /** Código del catálogo 1 de SUNAT, cuando el origen es un comprobante. */
  refTipo: string | null;
  /** Serie y número, o el número de la nota o de la liquidación. */
  refDocumento: string | null;
  /** A quién se le compró o vendió. */
  tercero: string | null;
};

/**
 * Kardex de un producto en un almacén, para la pantalla y para el PLE 13.1.
 *
 * Trae además la **referencia**: el documento que causó cada movimiento y el
 * tercero. Sin ella, una salida es una cantidad y una fecha, y cuando el saldo
 * no cuadra con el conteo físico no hay por dónde empezar a buscar; con ella se
 * va a la factura y se pregunta. Es la columna que Starsoft imprime y la que el
 * almacenero usa de verdad.
 *
 * El origen se resuelve por módulo. Los movimientos de kits apuntan a su nota
 * de almacén, igual que las notas manuales, así que comparten el mismo enlace.
 */
export async function kardexDe(
  db: Db,
  almacenId: string,
  productoId: string,
  rango?: { desde?: string; hasta?: string },
): Promise<LineaKardexDe[]> {
  const desde = rango?.desde ? sql` AND m.fecha >= ${rango.desde}` : sql``;
  const hasta = rango?.hasta ? sql` AND m.fecha <= ${rango.hasta}` : sql``;

  const filas = await db.execute(sql`
    SELECT m.id, m.fecha::text AS fecha, m.orden, m.sentido,
           m.tipo_operacion  AS "tipoOperacion",
           m.cantidad::text  AS cantidad,
           m.costo_unitario::text AS "costoUnitario",
           m.importe_total::text  AS "importeTotal",
           m.consumos, m.lote, m.serie,
           m.origen_modulo AS "origenModulo",
           m.origen_id     AS "origenId",
           coalesce(cp.tipo_documento, cv.tipo_documento) AS "refTipo",
           coalesce(
             cp.serie || '-' || cp.numero,
             cv.serie || '-' || cv.numero,
             na.tipo || ' ' || na.numero,
             li.numero
           ) AS "refDocumento",
           coalesce(tp.razon_social, tc.razon_social, tn.razon_social, ti.razon_social) AS tercero
    FROM movimientos_inventario m
    LEFT JOIN compras cp      ON m.origen_modulo = 'compras'       AND cp.id = m.origen_id
    LEFT JOIN terceros tp     ON tp.id = cp.proveedor_id
    LEFT JOIN comprobantes cv ON m.origen_modulo = 'ventas'        AND cv.id = m.origen_id
    LEFT JOIN terceros tc     ON tc.id = cv.cliente_id
    LEFT JOIN notas_almacen na ON m.origen_modulo IN ('notas_almacen', 'kits')
                              AND na.id = m.origen_id
    LEFT JOIN terceros tn     ON tn.id = na.tercero_id
    LEFT JOIN liquidaciones li ON m.origen_modulo = 'importaciones' AND li.id = m.origen_id
    LEFT JOIN importaciones im ON im.id = li.importacion_id
    LEFT JOIN terceros ti     ON ti.id = im.proveedor_id
    WHERE m.almacen_id = ${almacenId} AND m.producto_id = ${productoId}${desde}${hasta}
    ORDER BY m.fecha, m.orden`);

  return filas as unknown as LineaKardexDe[];
}

/** Existencias valorizadas de un almacén. Cuadra contra la cuenta 20. */
export async function existencias(db: Db, almacenId?: string) {
  const cond = almacenId ? eq(saldosInventario.almacenId, almacenId) : undefined;
  return db
    .select({
      productoId: saldosInventario.productoId,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      almacenId: saldosInventario.almacenId,
      almacen: almacenes.nombre,
      cantidad: saldosInventario.cantidad,
      valor: saldosInventario.valor,
    })
    .from(saldosInventario)
    .innerJoin(productos, eq(productos.id, saldosInventario.productoId))
    .innerJoin(almacenes, eq(almacenes.id, saldosInventario.almacenId))
    .where(cond ? and(cond, gt(saldosInventario.cantidad, "0")) : gt(saldosInventario.cantidad, "0"))
    .orderBy(asc(productos.codigo));
}

// ─── Auxiliares ───────────────────────────────────────────────────────────

/**
 * Bloquea la fila de saldo, creándola si no existe.
 *
 * El bloqueo es lo que serializa a dos usuarios que despachan el mismo producto
 * a la vez. Sin él, ambos leerían el mismo saldo, calcularían el mismo costo
 * promedio y dejarían el inventario descuadrado.
 */
async function bloquearSaldo(
  db: Db,
  empresaId: string,
  almacenId: string,
  productoId: string,
): Promise<{ cantidad: string; valor: string; capas: unknown } | undefined> {
  await db
    .insert(saldosInventario)
    .values({ empresaId, almacenId, productoId })
    .onConflictDoNothing({
      target: [saldosInventario.empresaId, saldosInventario.almacenId, saldosInventario.productoId],
    });

  const filas = await db.execute(sql`
    SELECT cantidad, valor, capas FROM saldos_inventario
    WHERE almacen_id = ${almacenId} AND producto_id = ${productoId}
    FOR UPDATE`);
  return filas[0] as { cantidad: string; valor: string; capas: unknown } | undefined;
}

function estadoDesde(
  saldo: { cantidad: string; valor: string; capas: unknown } | undefined,
  opts: kardex.OpcionesKardex,
): kardex.EstadoKardex {
  if (!saldo) return kardex.estadoInicial();
  const capas =
    opts.metodo === "peps" && Array.isArray(saldo.capas)
      ? (saldo.capas as { movimientoId: string; fecha: string; cantidad: string; costoUnitario: string }[])
          .map((c) => ({
            movimientoId: c.movimientoId,
            fecha: new Date(c.fecha),
            cantidad: dec(c.cantidad),
            costoUnitario: dec(c.costoUnitario),
          }))
      : [];
  return { cantidad: dec(saldo.cantidad), valor: dec(saldo.valor), capas };
}

const serializarCapas = (capas: readonly kardex.Capa[]) =>
  capas.length
    ? capas.map((c) => ({
        movimientoId: c.movimientoId,
        fecha: c.fecha.toISOString(),
        cantidad: txt(c.cantidad),
        costoUnitario: txt(c.costoUnitario),
      }))
    : null;

const aMovimientoDominio = (e: EntradaMovimiento, id: string): kardex.Movimiento => ({
  id,
  fecha: new Date(`${e.fecha}T00:00:00Z`),
  sentido: e.sentido,
  tipoOperacion: e.tipoOperacion as kardex.TipoOperacion,
  cantidad: e.cantidad,
  ...(e.costoUnitario !== undefined ? { costoUnitario: e.costoUnitario } : {}),
  ...(e.importeTotal !== undefined ? { importeTotal: e.importeTotal } : {}),
});

const costoDe = (l: kardex.LineaKardex): Dec =>
  l.entrada?.costoUnitario ?? l.salida?.costoUnitario ?? money.ZERO;
const importeDe = (l: kardex.LineaKardex): Dec =>
  l.entrada?.importe ?? l.salida?.importe ?? money.ZERO;

function valoresFila(
  empresaId: string,
  e: EntradaMovimiento,
  orden: number,
  linea: kardex.LineaKardex,
) {
  return {
    empresaId,
    almacenId: e.almacenId,
    productoId: e.productoId,
    fecha: e.fecha,
    orden,
    sentido: e.sentido,
    tipoOperacion: e.tipoOperacion,
    cantidad: txt(e.cantidad),
    costoUnitario: txt(costoDe(linea)),
    importeTotal: txt(importeDe(linea)),
    consumos: linea.consumos.length
      ? linea.consumos.map((c) => ({
          cantidad: txt(c.cantidad),
          costoUnitario: txt(c.costoUnitario),
          importe: txt(c.importe),
        }))
      : null,
    lote: e.lote ?? null,
    serie: e.serie ?? null,
    origenModulo: e.origenModulo ?? null,
    origenId: e.origenId ?? null,
  };
}

async function guardarSaldo(
  db: Db,
  _empresaId: string,
  e: EntradaMovimiento,
  estado: kardex.EstadoKardex,
  movimientoId: string,
): Promise<void> {
  await db
    .update(saldosInventario)
    .set({
      cantidad: txt(estado.cantidad),
      valor: txt(estado.valor),
      capas: serializarCapas(estado.capas),
      actualizadoEnMovimiento: movimientoId,
    })
    .where(
      and(
        eq(saldosInventario.almacenId, e.almacenId),
        eq(saldosInventario.productoId, e.productoId),
      ),
    );
}

/**
 * Comprueba que el producto y el almacén existen y son utilizables.
 *
 * RLS ya garantiza que pertenecen a la empresa —si fueran de otra, estas
 * consultas no devolverían nada—, así que aquí sólo queda validar las reglas
 * de negocio: que el producto no sea un servicio y que ninguno esté dado de
 * baja.
 */
async function exigirProductoAlmacen(db: Db, e: EntradaMovimiento): Promise<void> {
  const [prod] = await db
    .select({
      tipo: productos.tipo,
      activo: productos.activo,
      codigo: productos.codigo,
      controlLote: productos.controlLote,
      controlSerie: productos.controlSerie,
    })
    .from(productos)
    .where(eq(productos.id, e.productoId))
    .limit(1);
  if (!prod) throw new InventarioInvalido("el producto no existe en esta empresa");
  if (!prod.activo) throw new InventarioInvalido(`el producto ${prod.codigo} está dado de baja`);
  if (prod.tipo !== "bien") {
    throw new InventarioInvalido(`${prod.codigo} es un servicio y no lleva kardex`);
  }

  /*
   * Trazabilidad por lote y por serie.
   *
   * Las columnas existían desde el principio y nadie las obligaba: un producto
   * marcado «controla lote» se movía sin lote y la trazabilidad quedaba en una
   * intención. Se comprueba aquí, que es por donde pasan todos los módulos —
   * compras, ventas, notas, kits, importaciones—, y no en cada uno de ellos.
   */
  if (prod.controlLote && !e.lote?.trim()) {
    throw new InventarioInvalido(`${prod.codigo} se controla por lote: indique el lote`);
  }
  if (prod.controlSerie) {
    if (!e.serie?.trim()) {
      throw new InventarioInvalido(`${prod.codigo} se controla por serie: indique la serie`);
    }
    // Una serie identifica una unidad concreta. Dos unidades con la misma serie
    // no son dos unidades: son un error de captura.
    if (!money.eq(e.cantidad, money.dec("1"))) {
      throw new InventarioInvalido(
        `${prod.codigo} se controla por serie: cada movimiento es de una unidad`,
      );
    }
    const enStock = await serieEnStock(db, e.productoId, e.serie.trim());
    if (e.sentido === "ingreso" && enStock) {
      throw new InventarioInvalido(
        `la serie ${e.serie.trim()} de ${prod.codigo} ya está en el almacén`,
      );
    }
    if (e.sentido === "salida" && !enStock) {
      throw new InventarioInvalido(
        `la serie ${e.serie.trim()} de ${prod.codigo} no está en ningún almacén`,
      );
    }
  }
  if (prod.controlLote && e.sentido === "salida") {
    const disponible = await saldoDeLote(db, e.almacenId, e.productoId, e.lote!.trim());
    if (money.gt(e.cantidad, disponible)) {
      throw new InventarioInvalido(
        `el lote ${e.lote!.trim()} de ${prod.codigo} sólo tiene ${txt(disponible)} disponibles`,
      );
    }
  }

  const [alm] = await db
    .select({ activo: almacenes.activo, nombre: almacenes.nombre })
    .from(almacenes)
    .where(eq(almacenes.id, e.almacenId))
    .limit(1);
  if (!alm) throw new InventarioInvalido("el almacén no existe en esta empresa");
  if (!alm.activo) throw new InventarioInvalido(`el almacén ${alm.nombre} está inactivo`);
}

export { kardex };

// ─── Trazabilidad por lote y por serie ────────────────────────────────────

/**
 * Saldo de un lote en un almacén.
 *
 * Se deriva de los movimientos y no se guarda: un saldo almacenado en dos
 * sitios acaba siendo dos saldos distintos, y aquí el kardex ya es la verdad.
 */
export async function saldoDeLote(
  db: Db,
  almacenId: string,
  productoId: string,
  lote: string,
): Promise<Dec> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN sentido = 'ingreso' THEN cantidad ELSE -cantidad END), 0)::text
             AS saldo
    FROM movimientos_inventario
    WHERE almacen_id = ${almacenId} AND producto_id = ${productoId} AND lote = ${lote}`)) as unknown as [
    { saldo: string },
  ];
  return money.dec(fila?.saldo ?? "0");
}

/** ¿Esa serie está ahora mismo en algún almacén? */
export async function serieEnStock(
  db: Db,
  productoId: string,
  serie: string,
): Promise<boolean> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(CASE WHEN sentido = 'ingreso' THEN 1 ELSE -1 END), 0)::text AS saldo
    FROM movimientos_inventario
    WHERE producto_id = ${productoId} AND serie = ${serie}`)) as unknown as [{ saldo: string }];
  return Number(fila?.saldo ?? "0") > 0;
}

/**
 * Existencias abiertas por lote, con su vencimiento.
 *
 * Es el reporte que justifica todo el control: qué hay, dónde, y cuánto le
 * queda antes de caducar.
 */
export async function existenciasPorLote(
  db: Db,
  filtro?: { almacenId?: string; productoId?: string; venceAntesDe?: string },
) {
  const cond = [sql`m.lote IS NOT NULL`];
  if (filtro?.almacenId) cond.push(sql`m.almacen_id = ${filtro.almacenId}`);
  if (filtro?.productoId) cond.push(sql`m.producto_id = ${filtro.productoId}`);
  const donde = cond.reduce((a, c) => sql`${a} AND ${c}`);
  const vence = filtro?.venceAntesDe
    ? sql`AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento <= ${filtro.venceAntesDe}`
    : sql``;

  const filas = (await db.execute(sql`
    SELECT p.codigo, p.descripcion, a.nombre AS almacen, m.almacen_id, m.producto_id,
           m.lote, l.fecha_vencimiento, l.fecha_fabricacion,
           sum(CASE WHEN m.sentido = 'ingreso' THEN m.cantidad ELSE -m.cantidad END)::text
             AS cantidad,
           sum(CASE WHEN m.sentido = 'ingreso' THEN m.importe_total ELSE -m.importe_total END)::text
             AS valor
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    JOIN almacenes a ON a.id = m.almacen_id
    LEFT JOIN lotes l ON l.producto_id = m.producto_id AND l.codigo = m.lote
    WHERE ${donde}
    GROUP BY p.codigo, p.descripcion, a.nombre, m.almacen_id, m.producto_id, m.lote,
             l.fecha_vencimiento, l.fecha_fabricacion
    HAVING sum(CASE WHEN m.sentido = 'ingreso' THEN m.cantidad ELSE -m.cantidad END) > 0
    ${vence}
    ORDER BY l.fecha_vencimiento NULLS LAST, p.codigo, m.lote`)) as unknown as {
    codigo: string;
    descripcion: string;
    almacen: string;
    almacen_id: string;
    producto_id: string;
    lote: string;
    fecha_vencimiento: string | null;
    fecha_fabricacion: string | null;
    cantidad: string;
    valor: string;
  }[];
  return [...filas];
}

/** Series en stock, para saber qué unidad concreta está dónde. */
export async function seriesEnStock(
  db: Db,
  filtro?: { almacenId?: string; productoId?: string },
) {
  const cond = [sql`m.serie IS NOT NULL`];
  if (filtro?.almacenId) cond.push(sql`m.almacen_id = ${filtro.almacenId}`);
  if (filtro?.productoId) cond.push(sql`m.producto_id = ${filtro.productoId}`);
  const donde = cond.reduce((a, c) => sql`${a} AND ${c}`);

  const filas = (await db.execute(sql`
    SELECT p.codigo, p.descripcion, a.nombre AS almacen, m.serie, m.lote,
           max(m.fecha) AS ultima_fecha
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    JOIN almacenes a ON a.id = m.almacen_id
    WHERE ${donde}
    GROUP BY p.codigo, p.descripcion, a.nombre, m.serie, m.lote
    HAVING sum(CASE WHEN m.sentido = 'ingreso' THEN 1 ELSE -1 END) > 0
    ORDER BY p.codigo, m.serie`)) as unknown as {
    codigo: string;
    descripcion: string;
    almacen: string;
    serie: string;
    lote: string | null;
    ultima_fecha: string;
  }[];
  return [...filas];
}

export type DatosLote = {
  productoId: string;
  codigo: string;
  fechaFabricacion?: string;
  fechaVencimiento?: string;
  observaciones?: string;
};

/** Alta o actualización de un lote: sólo las fechas, que el kardex no sabe. */
export async function guardarLote(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosLote,
): Promise<string> {
  if (!datos.codigo.trim()) throw new InventarioInvalido("el lote necesita un código");
  if (
    datos.fechaFabricacion &&
    datos.fechaVencimiento &&
    datos.fechaVencimiento < datos.fechaFabricacion
  ) {
    throw new InventarioInvalido("el vencimiento no puede ser anterior a la fabricación");
  }

  const [fila] = await db
    .insert(lotes)
    .values({
      empresaId,
      productoId: datos.productoId,
      codigo: datos.codigo.trim(),
      fechaFabricacion: datos.fechaFabricacion ?? null,
      fechaVencimiento: datos.fechaVencimiento ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .onConflictDoUpdate({
      target: [lotes.productoId, lotes.codigo],
      set: {
        fechaFabricacion: datos.fechaFabricacion ?? null,
        fechaVencimiento: datos.fechaVencimiento ?? null,
        observaciones: datos.observaciones ?? null,
      },
    })
    .returning({ id: lotes.id });
  return fila!.id;
}

export const listarLotes = (db: Db, productoId?: string) =>
  db
    .select({
      id: lotes.id,
      productoId: lotes.productoId,
      codigo: lotes.codigo,
      producto: productos.codigo,
      descripcion: productos.descripcion,
      fechaFabricacion: lotes.fechaFabricacion,
      fechaVencimiento: lotes.fechaVencimiento,
      observaciones: lotes.observaciones,
    })
    .from(lotes)
    .innerJoin(productos, eq(productos.id, lotes.productoId))
    .where(productoId ? eq(lotes.productoId, productoId) : sql`true`)
    .orderBy(sql`${lotes.fechaVencimiento} NULLS LAST`, productos.codigo, lotes.codigo);
