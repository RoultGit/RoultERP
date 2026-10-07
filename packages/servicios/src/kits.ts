/**
 * Kits y conversión de unidades.
 *
 * Un artículo que se convierte en otros sin comprar ni vender nada. Starsoft lo
 * separa en dos opciones del menú —«manejo de kits» y «transferencia por
 * conversión de unidades»— pero es el mismo problema: se consume stock de unos
 * códigos y se produce stock de otro, y el valor total no puede cambiar en el
 * camino.
 *
 * Que el valor se conserve es la regla dura. Armar diez botiquines no crea
 * riqueza: la mercadería sigue valiendo lo mismo, sólo que ahora está en otra
 * fila del kardex. Por eso el costo del kit es exactamente la suma de lo que
 * costaron sus componentes según el kardex, y por eso —igual que en una
 * transferencia— **no se genera asiento**: la cuenta 20 no se mueve.
 *
 * Desarmar es lo contrario: el costo del kit se reparte entre los componentes
 * en proporción a lo que cada uno aporta, con resto mayor para que la suma
 * vuelva a cuadrar al céntimo.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { money, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { registrarMovimiento } from "./inventario.ts";
import { exigirPeriodoAbierto } from "./contabilidad.ts";
import { siguienteNumero } from "./correlativos.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  composiciones, notasAlmacen, notaAlmacenItems,
  productos, unidadesMedida, almacenes, planCuentas,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class ComposicionInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "ComposicionInvalida");
  }
}

export const TIPO_COMPOSICION = { KIT: "kit", CONVERSION: "conversion" } as const;

// ─── Mantenimiento de la receta ───────────────────────────────────────────

export type LineaComposicion = { componenteId: string; cantidad: string };

/**
 * Define de qué está hecho un producto.
 *
 * Reemplaza la receta entera: editar componente a componente dejaba recetas a
 * medio cambiar cuando alguien cerraba la pantalla antes de tiempo.
 */
export async function definirComposicion(
  db: Db,
  empresaId: string,
  usuarioId: string,
  productoId: string,
  tipo: string,
  lineas: LineaComposicion[],
): Promise<void> {
  const motivos: string[] = [];
  if (tipo !== "kit" && tipo !== "conversion") motivos.push("el tipo debe ser kit o conversion");
  if (lineas.length === 0) motivos.push("una composición necesita al menos un componente");
  if (tipo === "conversion" && lineas.length > 1) {
    motivos.push("una conversión de unidades sale de un solo producto de origen");
  }
  if (lineas.some((l) => l.componenteId === productoId)) {
    motivos.push("un producto no puede componerse de sí mismo");
  }
  if (motivos.length) throw new ComposicionInvalida(motivos);

  const [p] = await db
    .select({ tipo: productos.tipo })
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);
  if (!p) throw new ComposicionInvalida(["el producto no existe en esta empresa"]);
  if (p.tipo !== "bien") {
    throw new ComposicionInvalida(["sólo un bien tiene composición: un servicio no lleva kardex"]);
  }

  for (const [i, l] of lineas.entries()) {
    if (!money.gt(dec(l.cantidad), money.ZERO)) {
      throw new ComposicionInvalida([`componente ${i + 1}: la cantidad debe ser positiva`]);
    }
    const [c] = await db
      .select({ tipo: productos.tipo })
      .from(productos)
      .where(eq(productos.id, l.componenteId))
      .limit(1);
    if (!c) throw new ComposicionInvalida([`componente ${i + 1}: el producto no existe`]);
    if (c.tipo !== "bien") {
      throw new ComposicionInvalida([`componente ${i + 1}: un servicio no se puede armar ni consumir`]);
    }
  }

  await db.delete(composiciones).where(eq(composiciones.productoId, productoId));
  await db.insert(composiciones).values(
    lineas.map((l) => ({
      empresaId,
      productoId,
      tipo,
      componenteId: l.componenteId,
      cantidad: l.cantidad,
      creadoPor: usuarioId,
    })),
  );
}

export async function cargarComposicion(db: Db, productoId: string) {
  const [producto] = await db
    .select({
      id: productos.id,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      unidad: unidadesMedida.codigo,
    })
    .from(productos)
    .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
    .where(eq(productos.id, productoId))
    .limit(1);
  if (!producto) throw new ComposicionInvalida(["el producto no existe en esta empresa"]);

  const componentes = await db
    .select({
      id: composiciones.id,
      tipo: composiciones.tipo,
      componenteId: composiciones.componenteId,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      unidad: unidadesMedida.codigo,
      cantidad: composiciones.cantidad,
    })
    .from(composiciones)
    .innerJoin(productos, eq(productos.id, composiciones.componenteId))
    .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
    .where(eq(composiciones.productoId, productoId))
    .orderBy(asc(productos.codigo));

  return { producto, tipo: componentes[0]?.tipo ?? null, componentes };
}

/** Productos que tienen receta, para elegir qué armar o convertir. */
export const listarComposiciones = (db: Db, tipo?: string) =>
  db
    .select({
      productoId: composiciones.productoId,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      unidad: unidadesMedida.codigo,
      tipo: composiciones.tipo,
      componentes: sql<number>`count(*)`,
    })
    .from(composiciones)
    .innerJoin(productos, eq(productos.id, composiciones.productoId))
    .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
    .where(tipo ? eq(composiciones.tipo, tipo) : sql`true`)
    .groupBy(
      composiciones.productoId,
      productos.codigo,
      productos.descripcion,
      unidadesMedida.codigo,
      composiciones.tipo,
    )
    .orderBy(asc(productos.codigo));

// ─── Armado y desarmado ───────────────────────────────────────────────────

export type ResultadoComposicion = {
  notaId: string;
  numero: string;
  /** Costo total movido. El mismo de un lado y del otro, por definición. */
  importe: string;
  costoUnitario: string;
  movimientos: string[];
};

/**
 * Comprueba que todo lo que se mueve vive en la misma cuenta de existencias.
 *
 * Si el kit fuera mercadería (20) y un componente suministro (25), armar sí
 * cambiaría de cuenta y haría falta un asiento. Mientras no sea el caso, no
 * asentar es correcto; cuando lo sea, hay que enterarse aquí y no descubrirlo
 * en un balance descuadrado.
 */
async function exigirMismaCuenta(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const filas = await db
    .select({
      id: productos.id,
      codigo: productos.codigo,
      cuenta: planCuentas.cuenta,
    })
    .from(productos)
    .leftJoin(planCuentas, eq(planCuentas.id, productos.cuentaExistenciaId))
    .where(inArray(productos.id, ids));

  const cuentas = new Set(filas.map((f) => f.cuenta ?? "(por defecto)"));
  if (cuentas.size > 1) {
    throw new ComposicionInvalida([
      `los productos no comparten cuenta de existencias (${[...cuentas].join(", ")}): ` +
        "armar cambiaría de cuenta y haría falta un asiento que este proceso no genera",
    ]);
  }
}

async function crearNota(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { tipo: string; fecha: string; almacenId: string; glosa: string; operacion: string },
): Promise<{ id: string; numero: string }> {
  const prefijo = datos.tipo === "armado" ? "KA" : datos.tipo === "desarmado" ? "KD" : "CV";
  const numero = await siguienteNumero(
    db, notasAlmacen, notasAlmacen.numero, prefijo, datos.fecha.slice(0, 4),
  );
  const [cab] = await db
    .insert(notasAlmacen)
    .values({
      empresaId,
      tipo: datos.tipo,
      numero,
      fecha: datos.fecha,
      almacenId: datos.almacenId,
      tipoOperacion: datos.operacion,
      glosa: datos.glosa,
      creadoPor: usuarioId,
    })
    .returning({ id: notasAlmacen.id });
  return { id: cab!.id, numero };
}

export type DatosArmado = {
  productoId: string;
  cantidad: string;
  fecha: string;
  almacenId: string;
  glosa?: string;
};

/**
 * Arma un kit: consume los componentes y produce el producto.
 *
 * El costo del kit es la suma exacta de lo que costaron sus componentes según
 * el kardex. Ni se estima ni se toma de una lista de precios: si se inventara,
 * el inventario valdría de pronto más o menos sin que nadie haya comprado ni
 * vendido nada.
 */
export async function armar(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosArmado,
): Promise<ResultadoComposicion> {
  const cantidad = dec(datos.cantidad);
  if (!money.gt(cantidad, money.ZERO)) {
    throw new ComposicionInvalida(["la cantidad a armar debe ser positiva"]);
  }
  await exigirPeriodoAbierto(db, datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7));

  const { producto, tipo, componentes } = await cargarComposicion(db, datos.productoId);
  if (componentes.length === 0) {
    throw new ComposicionInvalida([`${producto.codigo} no tiene composición definida`]);
  }
  const [almacen] = await db
    .select({ id: almacenes.id })
    .from(almacenes)
    .where(eq(almacenes.id, datos.almacenId))
    .limit(1);
  if (!almacen) throw new ComposicionInvalida(["el almacén no existe en esta empresa"]);

  await exigirMismaCuenta(db, [datos.productoId, ...componentes.map((c) => c.componenteId)]);

  const esConversion = tipo === "conversion";
  const nota = await crearNota(db, empresaId, usuarioId, {
    tipo: esConversion ? "conversion" : "armado",
    fecha: datos.fecha,
    almacenId: datos.almacenId,
    glosa:
      datos.glosa?.trim() ||
      `${esConversion ? "Conversión" : "Armado"} de ${txt2(cantidad)} ${producto.codigo}`,
    operacion: kardex.TIPO_OPERACION.AJUSTE_SALIDA,
  });

  const movimientos: string[] = [];
  let costoTotal = money.ZERO;

  for (const [i, c] of componentes.entries()) {
    const necesaria = money.round(money.mul(cantidad, dec(c.cantidad)), 6);
    const mov = await registrarMovimiento(db, empresaId, {
      almacenId: datos.almacenId,
      productoId: c.componenteId,
      fecha: datos.fecha,
      sentido: "salida",
      tipoOperacion: kardex.TIPO_OPERACION.AJUSTE_SALIDA,
      cantidad: necesaria,
      origenModulo: "kits",
      origenId: nota.id,
    });
    movimientos.push(mov.id);
    costoTotal = money.add(costoTotal, dec(mov.importeTotal));

    await db.insert(notaAlmacenItems).values({
      empresaId,
      notaId: nota.id,
      linea: i + 1,
      productoId: c.componenteId,
      cantidad: money.toString(necesaria, 6),
      costoUnitario: mov.costoUnitario,
      importeLinea: mov.importeTotal,
    });
  }

  // El producto entra por el costo exacto de lo consumido.
  const entrada = await registrarMovimiento(db, empresaId, {
    almacenId: datos.almacenId,
    productoId: datos.productoId,
    fecha: datos.fecha,
    sentido: "ingreso",
    tipoOperacion: kardex.TIPO_OPERACION.AJUSTE_ENTRADA,
    cantidad,
    costoUnitario: money.round(money.div(costoTotal, cantidad), 6),
    importeTotal: costoTotal,
    origenModulo: "kits",
    origenId: nota.id,
  });
  movimientos.push(entrada.id);

  await db.insert(notaAlmacenItems).values({
    empresaId,
    notaId: nota.id,
    linea: componentes.length + 1,
    productoId: datos.productoId,
    cantidad: money.toString(cantidad, 6),
    costoUnitario: entrada.costoUnitario,
    importeLinea: entrada.importeTotal,
  });

  await db
    .update(notasAlmacen)
    .set({ importe: txt2(costoTotal) })
    .where(eq(notasAlmacen.id, nota.id));

  return {
    notaId: nota.id,
    numero: nota.numero,
    importe: txt2(costoTotal),
    costoUnitario: entrada.costoUnitario,
    movimientos,
  };
}

/**
 * Desarma un kit: lo consume y devuelve sus componentes al almacén.
 *
 * El costo del kit se reparte entre los componentes en proporción a lo que cada
 * uno pesa en la receta, valorado al costo actual de cada uno. Con resto mayor,
 * para que la suma de las partes sea exactamente el costo del kit: repartir por
 * proporciones redondeadas perdería céntimos en cada desarme, y en un año de
 * operación eso ya no es despreciable.
 */
export async function desarmar(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosArmado,
): Promise<ResultadoComposicion> {
  const cantidad = dec(datos.cantidad);
  if (!money.gt(cantidad, money.ZERO)) {
    throw new ComposicionInvalida(["la cantidad a desarmar debe ser positiva"]);
  }
  await exigirPeriodoAbierto(db, datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7));

  const { producto, tipo, componentes } = await cargarComposicion(db, datos.productoId);
  if (componentes.length === 0) {
    throw new ComposicionInvalida([`${producto.codigo} no tiene composición definida`]);
  }
  await exigirMismaCuenta(db, [datos.productoId, ...componentes.map((c) => c.componenteId)]);

  const nota = await crearNota(db, empresaId, usuarioId, {
    tipo: tipo === "conversion" ? "conversion" : "desarmado",
    fecha: datos.fecha,
    almacenId: datos.almacenId,
    glosa: datos.glosa?.trim() || `Desarmado de ${txt2(cantidad)} ${producto.codigo}`,
    operacion: kardex.TIPO_OPERACION.AJUSTE_SALIDA,
  });

  const salida = await registrarMovimiento(db, empresaId, {
    almacenId: datos.almacenId,
    productoId: datos.productoId,
    fecha: datos.fecha,
    sentido: "salida",
    tipoOperacion: kardex.TIPO_OPERACION.AJUSTE_SALIDA,
    cantidad,
    origenModulo: "kits",
    origenId: nota.id,
  });
  const costoTotal = dec(salida.importeTotal);
  const movimientos: string[] = [salida.id];

  await db.insert(notaAlmacenItems).values({
    empresaId,
    notaId: nota.id,
    linea: 1,
    productoId: datos.productoId,
    cantidad: money.toString(cantidad, 6),
    costoUnitario: salida.costoUnitario,
    importeLinea: salida.importeTotal,
  });

  // Peso de cada componente en la receta, para repartir el costo del kit.
  const cantidades = componentes.map((c) => money.round(money.mul(cantidad, dec(c.cantidad)), 6));
  const partes = money.distribute(costoTotal, cantidades, 2);

  for (const [i, c] of componentes.entries()) {
    const devuelta = cantidades[i]!;
    const parte = partes[i]!;
    const mov = await registrarMovimiento(db, empresaId, {
      almacenId: datos.almacenId,
      productoId: c.componenteId,
      fecha: datos.fecha,
      sentido: "ingreso",
      tipoOperacion: kardex.TIPO_OPERACION.AJUSTE_ENTRADA,
      cantidad: devuelta,
      costoUnitario: money.isZero(devuelta) ? money.ZERO : money.round(money.div(parte, devuelta), 6),
      importeTotal: parte,
      origenModulo: "kits",
      origenId: nota.id,
    });
    movimientos.push(mov.id);

    await db.insert(notaAlmacenItems).values({
      empresaId,
      notaId: nota.id,
      linea: i + 2,
      productoId: c.componenteId,
      cantidad: money.toString(devuelta, 6),
      costoUnitario: mov.costoUnitario,
      importeLinea: mov.importeTotal,
    });
  }

  await db
    .update(notasAlmacen)
    .set({ importe: txt2(costoTotal) })
    .where(eq(notasAlmacen.id, nota.id));

  return {
    notaId: nota.id,
    numero: nota.numero,
    importe: txt2(costoTotal),
    costoUnitario: salida.costoUnitario,
    movimientos,
  };
}
