/**
 * Notas de almacén.
 *
 * Los movimientos que no vienen de comprar ni de vender: un ingreso por
 * donación o por saldo inicial, una salida por consumo o por merma, una
 * transferencia entre almacenes y el ajuste de un inventario físico.
 *
 * Cada tipo se contabiliza distinto, y esa es la parte que no puede quedar a
 * criterio de quien captura:
 *
 * - **Ingreso**: la mercadería entra al costo que se indique y se abona la
 *   contrapartida que corresponda al motivo.
 * - **Salida**: el costo lo pone el kardex, no el usuario. Quien saca
 *   mercadería no decide cuánto valía.
 * - **Transferencia**: no genera asiento. La mercadería no cambia de cuenta,
 *   sólo de sitio; contabilizarla inventaría un movimiento que no existió.
 * - **Ajuste**: el sobrante es un ingreso y el faltante un gasto, y ambos
 *   llevan la contrapartida que el contador decida.
 *
 * Todas respetan el cierre de periodo, incluida la transferencia: no genera
 * asiento, pero mueve el kardex, y el kardex alimenta el inventario valorizado
 * de un mes que quizá ya se declaró a SUNAT.
 */
import { desc, eq, sql } from "drizzle-orm";
import { money, inventario as kardex } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { registrarMovimiento } from "./inventario.ts";
import { asentar, exigirPeriodoAbierto, type LineaAsientoEntrada } from "./contabilidad.ts";
import { cuentasDe, type Cuentas } from "./parametros.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const { notasAlmacen, notaAlmacenItems, almacenes, productos, terceros } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class NotaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "NotaInvalida");
  }
}

export const TIPO_NOTA = {
  INGRESO: "ingreso",
  SALIDA: "salida",
  TRANSFERENCIA: "transferencia",
  AJUSTE: "ajuste",
} as const;

export type LineaNota = {
  productoId: string;
  cantidad: string;
  /** Obligatorio al ingresar; al salir lo determina el kardex. */
  costoUnitario?: string;
  lote?: string;
  serie?: string;
};

export type DatosNotaAlmacen = {
  tipo: string;
  fecha: string;
  almacenId: string;
  /** Sólo en transferencias. */
  almacenDestinoId?: string;
  /** Catálogo 12 de SUNAT. Si se omite, el que corresponde al tipo. */
  tipoOperacion?: string;
  glosa: string;
  /** Cuenta de la contrapartida. No se usa en transferencias. */
  cuentaContrapartida?: string;
  centroCostoId?: string;
  terceroId?: string;
  referencia?: string;
  /** Si el ajuste es un sobrante (entra) o un faltante (sale). */
  sentidoAjuste?: "ingreso" | "salida";
  lineas: LineaNota[];
};

export type NotaRegistrada = {
  notaId: string;
  numero: string;
  importe: string;
  asientoId: string | null;
  movimientos: string[];
};

/** Operación del catálogo 12 que corresponde a cada nota. */
function operacionDe(datos: DatosNotaAlmacen, entra: boolean): string {
  if (datos.tipoOperacion) return datos.tipoOperacion;
  switch (datos.tipo) {
    case TIPO_NOTA.TRANSFERENCIA:
      return entra
        ? kardex.TIPO_OPERACION.TRANSFERENCIA_ENTRADA
        : kardex.TIPO_OPERACION.TRANSFERENCIA_SALIDA;
    case TIPO_NOTA.AJUSTE:
      return entra ? kardex.TIPO_OPERACION.AJUSTE_ENTRADA : kardex.TIPO_OPERACION.AJUSTE_SALIDA;
    case TIPO_NOTA.SALIDA:
      return kardex.TIPO_OPERACION.CONSUMO;
    default:
      return kardex.TIPO_OPERACION.AJUSTE_ENTRADA;
  }
}

async function siguienteNumero(db: Db, tipo: string): Promise<string> {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(max(numero::bigint), 0) + 1 AS siguiente
    FROM notas_almacen
    WHERE tipo = ${tipo} AND numero ~ '^[0-9]+$'`)) as unknown as [{ siguiente: string }];
  return String(fila!.siguiente).padStart(8, "0");
}

/**
 * Registra una nota de almacén.
 *
 * Es una sola función para los cuatro tipos porque son el mismo documento con
 * distinto signo y distinta contrapartida; separarlas en cuatro obligaría a
 * repetir la validación, el kardex y el asiento cuatro veces.
 */
export async function registrarNota(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosNotaAlmacen,
): Promise<NotaRegistrada> {
  const motivos: string[] = [];
  if (!Object.values(TIPO_NOTA).includes(datos.tipo as never)) {
    motivos.push(`tipo de nota desconocido: ${datos.tipo}`);
  }
  if (datos.lineas.length === 0) motivos.push("la nota necesita al menos un artículo");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) motivos.push("la fecha es inválida");
  if (!datos.glosa.trim()) motivos.push("indique el motivo de la nota");

  const esTransferencia = datos.tipo === TIPO_NOTA.TRANSFERENCIA;
  if (esTransferencia) {
    if (!datos.almacenDestinoId) motivos.push("una transferencia necesita almacén de destino");
    else if (datos.almacenDestinoId === datos.almacenId) {
      motivos.push("el almacén de destino tiene que ser distinto del de origen");
    }
  } else if (!datos.cuentaContrapartida) {
    motivos.push("indique la cuenta contra la que se registra el movimiento");
  }

  // El sentido decide si la mercadería entra o sale, y de eso depende todo lo
  // demás: quién pone el costo y de qué lado va el asiento.
  const entra =
    datos.tipo === TIPO_NOTA.INGRESO ||
    (datos.tipo === TIPO_NOTA.AJUSTE && (datos.sentidoAjuste ?? "ingreso") === "ingreso");

  if (entra && !esTransferencia) {
    for (const [i, l] of datos.lineas.entries()) {
      if (!l.costoUnitario || !money.gt(dec(l.costoUnitario), money.ZERO)) {
        motivos.push(`línea ${i + 1}: un ingreso necesita costo unitario`);
      }
    }
  }
  for (const [i, l] of datos.lineas.entries()) {
    if (!money.gt(dec(l.cantidad), money.ZERO)) {
      motivos.push(`línea ${i + 1}: la cantidad debe ser mayor que cero`);
    }
  }
  if (motivos.length > 0) throw new NotaInvalida(motivos);

  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  await exigirPeriodoAbierto(db, periodo);

  const [almacen] = await db
    .select()
    .from(almacenes)
    .where(eq(almacenes.id, datos.almacenId))
    .limit(1);
  if (!almacen) throw new NotaInvalida(["el almacén no existe en esta empresa"]);
  if (esTransferencia) {
    const [destino] = await db
      .select()
      .from(almacenes)
      .where(eq(almacenes.id, datos.almacenDestinoId!))
      .limit(1);
    if (!destino) throw new NotaInvalida(["el almacén de destino no existe en esta empresa"]);
  }

  const numero = await siguienteNumero(db, datos.tipo);
  const [cab] = await db
    .insert(notasAlmacen)
    .values({
      empresaId,
      tipo: datos.tipo,
      numero,
      fecha: datos.fecha,
      almacenId: datos.almacenId,
      almacenDestinoId: datos.almacenDestinoId ?? null,
      tipoOperacion: operacionDe(datos, entra),
      glosa: datos.glosa.trim(),
      cuentaContrapartida: esTransferencia ? null : (datos.cuentaContrapartida ?? null),
      centroCostoId: datos.centroCostoId ?? null,
      terceroId: datos.terceroId ?? null,
      referencia: datos.referencia ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: notasAlmacen.id });
  const notaId = cab!.id;

  const movimientos: string[] = [];
  let importeTotal = money.ZERO;
  const detalle: { linea: number; importe: Dec; costoUnitario: Dec }[] = [];

  for (const [i, l] of datos.lineas.entries()) {
    const cantidad = dec(l.cantidad);

    if (esTransferencia) {
      // Sale del origen al costo que diga el kardex, y entra al destino por ese
      // mismo importe: una transferencia no puede cambiar el valor del stock.
      const salida = await registrarMovimiento(db, empresaId, {
        almacenId: datos.almacenId,
        productoId: l.productoId,
        fecha: datos.fecha,
        sentido: "salida",
        tipoOperacion: kardex.TIPO_OPERACION.TRANSFERENCIA_SALIDA,
        cantidad,
        origenModulo: "notas_almacen",
        origenId: notaId,
        ...(l.lote ? { lote: l.lote } : {}),
        ...(l.serie ? { serie: l.serie } : {}),
      });
      const entrada = await registrarMovimiento(db, empresaId, {
        almacenId: datos.almacenDestinoId!,
        productoId: l.productoId,
        fecha: datos.fecha,
        sentido: "ingreso",
        tipoOperacion: kardex.TIPO_OPERACION.TRANSFERENCIA_ENTRADA,
        cantidad,
        costoUnitario: dec(salida.costoUnitario),
        importeTotal: dec(salida.importeTotal),
        origenModulo: "notas_almacen",
        origenId: notaId,
        ...(l.lote ? { lote: l.lote } : {}),
        ...(l.serie ? { serie: l.serie } : {}),
      });
      movimientos.push(salida.id, entrada.id);
      importeTotal = money.add(importeTotal, dec(salida.importeTotal));
      detalle.push({
        linea: i + 1,
        importe: dec(salida.importeTotal),
        costoUnitario: dec(salida.costoUnitario),
      });
      continue;
    }

    const mov = await registrarMovimiento(db, empresaId, {
      almacenId: datos.almacenId,
      productoId: l.productoId,
      fecha: datos.fecha,
      sentido: entra ? "ingreso" : "salida",
      tipoOperacion: operacionDe(datos, entra),
      cantidad,
      ...(entra ? { costoUnitario: dec(l.costoUnitario!) } : {}),
      origenModulo: "notas_almacen",
      origenId: notaId,
      ...(l.lote ? { lote: l.lote } : {}),
      ...(l.serie ? { serie: l.serie } : {}),
    });
    movimientos.push(mov.id);
    importeTotal = money.add(importeTotal, dec(mov.importeTotal));
    detalle.push({
      linea: i + 1,
      importe: dec(mov.importeTotal),
      costoUnitario: dec(mov.costoUnitario),
    });
  }

  await db.insert(notaAlmacenItems).values(
    datos.lineas.map((l, i) => ({
      empresaId,
      notaId,
      linea: i + 1,
      productoId: l.productoId,
      cantidad: l.cantidad,
      costoUnitario: txt2(detalle[i]!.costoUnitario),
      importeLinea: txt2(detalle[i]!.importe),
      lote: l.lote ?? null,
      serie: l.serie ?? null,
    })),
  );

  /*
   * Una transferencia no se contabiliza.
   *
   * La mercadería sigue en la misma cuenta del plan; sólo cambió de sitio.
   * Generar un asiento que carga y abona la 20 por el mismo importe ensucia el
   * mayor sin informar de nada.
   */
  let asientoId: string | null = null;
  if (!esTransferencia && !money.isZero(importeTotal)) {
    asientoId = await asentar(db, empresaId, usuarioId, {
      periodo,
      fecha: datos.fecha,
      subdiario: "08",
      glosa: `${etiqueta(datos.tipo)} ${numero} · ${datos.glosa.trim()}`,
      moneda: "PEN",
      tipoCambio: "1",
      origenModulo: "notas_almacen",
      origenId: notaId,
      lineas: lineasAsiento(await cuentasDe(db), {
        entra,
        importe: importeTotal,
        cuentaContrapartida: datos.cuentaContrapartida!,
        ...(datos.centroCostoId ? { centroCostoId: datos.centroCostoId } : {}),
        ...(datos.terceroId ? { terceroId: datos.terceroId } : {}),
      }),
    });
  }

  await db
    .update(notasAlmacen)
    .set({ asientoId, importe: txt2(importeTotal) })
    .where(eq(notasAlmacen.id, notaId));

  return { notaId, numero, importe: txt2(importeTotal), asientoId, movimientos };
}

const etiqueta = (tipo: string): string =>
  ({
    ingreso: "Nota de ingreso",
    salida: "Nota de salida",
    transferencia: "Transferencia",
    ajuste: "Nota de ajuste",
  })[tipo] ?? "Nota de almacén";

/**
 * Asiento de la nota.
 *
 * Entrando, la mercadería se carga a la 20 y se abona la contrapartida; saliendo
 * es al revés. La cuenta 20111 no la elige el usuario: la mercadería siempre
 * vive ahí, y dejarla a criterio de quien captura es cómo se desordena un plan.
 */
function lineasAsiento(cuentas: Cuentas, p: {
  entra: boolean;
  importe: Dec;
  cuentaContrapartida: string;
  centroCostoId?: string;
  terceroId?: string;
}): LineaAsientoEntrada[] {
  const existencias: LineaAsientoEntrada = {
    cuenta: cuentas.get("existencias"),
    glosa: p.entra ? "Ingreso al almacén" : "Salida del almacén",
    ...(p.entra ? { debe: txt2(p.importe) } : { haber: txt2(p.importe) }),
  };
  const contrapartida: LineaAsientoEntrada = {
    cuenta: p.cuentaContrapartida,
    glosa: p.entra ? "Contrapartida del ingreso" : "Contrapartida de la salida",
    ...(p.entra ? { haber: txt2(p.importe) } : { debe: txt2(p.importe) }),
    ...(p.centroCostoId ? { centroCostoId: p.centroCostoId } : {}),
    ...(p.terceroId ? { anexoId: p.terceroId } : {}),
  };
  return [existencias, contrapartida];
}

export const listarNotas = (db: Db, tipo?: string) =>
  db
    .select({
      id: notasAlmacen.id,
      tipo: notasAlmacen.tipo,
      numero: notasAlmacen.numero,
      fecha: notasAlmacen.fecha,
      glosa: notasAlmacen.glosa,
      importe: notasAlmacen.importe,
      tipoOperacion: notasAlmacen.tipoOperacion,
      estado: notasAlmacen.estado,
      almacen: almacenes.nombre,
      asientoId: notasAlmacen.asientoId,
    })
    .from(notasAlmacen)
    .leftJoin(almacenes, eq(almacenes.id, notasAlmacen.almacenId))
    .where(tipo ? eq(notasAlmacen.tipo, tipo) : undefined)
    .orderBy(desc(notasAlmacen.fecha), desc(notasAlmacen.numero))
    .limit(200);

export async function cargarNota(db: Db, id: string) {
  const [cabecera] = await db.select().from(notasAlmacen).where(eq(notasAlmacen.id, id)).limit(1);
  if (!cabecera) throw new NotaInvalida(["la nota no existe"]);
  const items = await db
    .select({
      linea: notaAlmacenItems.linea,
      cantidad: notaAlmacenItems.cantidad,
      costoUnitario: notaAlmacenItems.costoUnitario,
      importeLinea: notaAlmacenItems.importeLinea,
      lote: notaAlmacenItems.lote,
      serie: notaAlmacenItems.serie,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
    })
    .from(notaAlmacenItems)
    .leftJoin(productos, eq(productos.id, notaAlmacenItems.productoId))
    .where(eq(notaAlmacenItems.notaId, id))
    .orderBy(notaAlmacenItems.linea);
  const [tercero] = cabecera.terceroId
    ? await db.select().from(terceros).where(eq(terceros.id, cabecera.terceroId)).limit(1)
    : [];
  return { cabecera, items, tercero };
}
