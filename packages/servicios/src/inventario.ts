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
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { money, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";

const { movimientosInventario, saldosInventario, almacenes, productos, empresas } = s;

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

export class InventarioInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "InventarioInvalido";
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

/** Kardex de un producto en un almacén, para la pantalla y para el PLE 13.1. */
export async function kardexDe(
  db: Db,
  almacenId: string,
  productoId: string,
  rango?: { desde?: string; hasta?: string },
) {
  const condiciones = [
    eq(movimientosInventario.almacenId, almacenId),
    eq(movimientosInventario.productoId, productoId),
  ];
  if (rango?.desde) condiciones.push(sql`${movimientosInventario.fecha} >= ${rango.desde}`);
  if (rango?.hasta) condiciones.push(sql`${movimientosInventario.fecha} <= ${rango.hasta}`);

  return db
    .select()
    .from(movimientosInventario)
    .where(and(...condiciones))
    .orderBy(asc(movimientosInventario.fecha), asc(movimientosInventario.orden));
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
  empresaId: string,
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
    .select({ tipo: productos.tipo, activo: productos.activo, codigo: productos.codigo })
    .from(productos)
    .where(eq(productos.id, e.productoId))
    .limit(1);
  if (!prod) throw new InventarioInvalido("el producto no existe en esta empresa");
  if (!prod.activo) throw new InventarioInvalido(`el producto ${prod.codigo} está dado de baja`);
  if (prod.tipo !== "bien") {
    throw new InventarioInvalido(`${prod.codigo} es un servicio y no lleva kardex`);
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
