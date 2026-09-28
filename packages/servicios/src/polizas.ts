/**
 * Póliza (DUA): la unidad con la que se nacionaliza un despacho.
 *
 * Un importador no liquida embarque por embarque. Liquida por **póliza**: una
 * DUA ampara varias órdenes de importación, y los gastos que llegan después
 * —el agenciamiento, el almacenaje, el flete interno, la percepción— son de la
 * póliza entera. Cargárselos a un embarque cualquiera, que es lo único que se
 * podía hacer antes, inventa el costo de todos los demás.
 *
 * El reparto es en dos pasos y los dos son exactos:
 *
 *  1. El gasto de póliza se reparte entre sus embarques por el peso que
 *     corresponda a su base —el FOB en soles, el peso, el volumen, la
 *     cantidad—, con resto mayor, de modo que la suma de las partes sea el
 *     gasto al céntimo.
 *  2. La parte de cada embarque se prorratea dentro de él con la maquinaria de
 *     siempre, que también es exacta.
 *
 * Como los dos pasos cuadran, el total repartido es el gasto. No hay deriva.
 *
 * El tipo de cambio de la póliza manda sobre el de cada embarque: lo fija la
 * DUA con la fecha de numeración, y es el que vale para la nacionalización.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { money, importaciones as dominio } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import {
  confirmarLiquidacion, type DatosGasto, type ResultadoConfirmacion,
} from "./importaciones.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  polizas, importaciones: tImportaciones, importacionItems, importacionGastos,
  terceros, almacenes,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class PolizaInvalida extends ErrorDeNegocio {
  constructor(motivo: string) {
    super(motivo, "PolizaInvalida");
  }
}

export type DatosPoliza = {
  numero: string;
  fecha: string;
  fechaNumeracion?: string;
  aduana?: string;
  regimen?: string;
  agenteId?: string;
  tipoCambio: string;
  observaciones?: string;
};

export async function crearPoliza(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPoliza,
): Promise<string> {
  if (!datos.numero.trim()) throw new PolizaInvalida("la póliza necesita su número de DUA");
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) {
    throw new PolizaInvalida("el tipo de cambio de la DUA debe ser positivo");
  }

  const [fila] = await db
    .insert(polizas)
    .values({
      empresaId,
      numero: datos.numero.trim(),
      fecha: datos.fecha,
      fechaNumeracion: datos.fechaNumeracion ?? null,
      aduana: datos.aduana ?? null,
      regimen: datos.regimen ?? null,
      agenteId: datos.agenteId ?? null,
      tipoCambio: datos.tipoCambio,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: polizas.id });
  return fila!.id;
}

async function exigirAbierta(db: Db, polizaId: string) {
  const [p] = await db.select().from(polizas).where(eq(polizas.id, polizaId)).limit(1);
  if (!p) throw new PolizaInvalida("la póliza no existe");
  if (p.estado !== "abierta") {
    throw new PolizaInvalida(`la póliza está ${p.estado} y ya no admite cambios`);
  }
  return p;
}

/**
 * Mete un embarque en la póliza.
 *
 * Sólo se agrupa lo que todavía no se liquidó: una importación ya liquidada
 * tiene su costo asentado, y volver a repartirle gastos sería contabilizar dos
 * veces la misma mercadería.
 */
export async function asociarImportacion(
  db: Db,
  polizaId: string,
  importacionId: string,
): Promise<void> {
  await exigirAbierta(db, polizaId);

  const [imp] = await db
    .select({ estado: tImportaciones.estado, polizaId: tImportaciones.polizaId })
    .from(tImportaciones)
    .where(eq(tImportaciones.id, importacionId))
    .limit(1);
  if (!imp) throw new PolizaInvalida("la importación no existe");
  if (imp.estado === "liquidada") {
    throw new PolizaInvalida("la importación ya fue liquidada y no se agrupa");
  }
  if (imp.estado === "anulada") throw new PolizaInvalida("la importación está anulada");
  if (imp.polizaId && imp.polizaId !== polizaId) {
    throw new PolizaInvalida("la importación ya pertenece a otra póliza");
  }

  await db
    .update(tImportaciones)
    .set({ polizaId })
    .where(eq(tImportaciones.id, importacionId));
}

export async function desasociarImportacion(
  db: Db,
  polizaId: string,
  importacionId: string,
): Promise<void> {
  await exigirAbierta(db, polizaId);
  await db
    .update(tImportaciones)
    .set({ polizaId: null })
    .where(and(eq(tImportaciones.id, importacionId), eq(tImportaciones.polizaId, polizaId)));
}

/** Gasto de la póliza: el que ampara a todos sus embarques. */
export async function agregarGastoPoliza(
  db: Db,
  empresaId: string,
  polizaId: string,
  datos: Omit<DatosGasto, "itemId">,
): Promise<string> {
  await exigirAbierta(db, polizaId);
  if (datos.baseProrrateo === "directo") {
    throw new PolizaInvalida(
      "un gasto directo se carga a un ítem concreto: regístrelo en su embarque, no en la póliza",
    );
  }
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) {
    throw new PolizaInvalida("el tipo de cambio del gasto debe ser positivo");
  }

  const [fila] = await db
    .insert(importacionGastos)
    .values({
      empresaId,
      importacionId: null,
      polizaId,
      concepto: datos.concepto,
      importe: datos.importe,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      baseProrrateo: datos.baseProrrateo,
      afectaCosto: datos.afectaCosto,
      proveedorId: datos.proveedorId ?? null,
      documento: datos.documento ?? null,
      fecha: datos.fecha ?? null,
    })
    .returning({ id: importacionGastos.id });
  return fila!.id;
}

export async function quitarGastoPoliza(db: Db, polizaId: string, gastoId: string): Promise<void> {
  await exigirAbierta(db, polizaId);
  await db
    .delete(importacionGastos)
    .where(and(eq(importacionGastos.id, gastoId), eq(importacionGastos.polizaId, polizaId)));
}

export const listarPolizas = (db: Db, estado?: string) =>
  db
    .select({
      id: polizas.id,
      numero: polizas.numero,
      fecha: polizas.fecha,
      aduana: polizas.aduana,
      regimen: polizas.regimen,
      agente: terceros.razonSocial,
      tipoCambio: polizas.tipoCambio,
      estado: polizas.estado,
      embarques: sql<number>`(
        SELECT count(*) FROM importaciones i WHERE i.poliza_id = ${polizas.id}
      )`,
    })
    .from(polizas)
    .leftJoin(terceros, eq(terceros.id, polizas.agenteId))
    .where(estado ? eq(polizas.estado, estado) : sql`true`)
    .orderBy(desc(polizas.fecha), desc(polizas.numero))
    .limit(300);

/** Embarques todavía sin póliza: los que se pueden agrupar en una. */
export const importacionesDisponibles = (db: Db) =>
  db
    .select({
      id: tImportaciones.id,
      numero: tImportaciones.numero,
      proveedor: terceros.razonSocial,
      fechaOrden: tImportaciones.fechaOrden,
      estado: tImportaciones.estado,
    })
    .from(tImportaciones)
    .innerJoin(terceros, eq(terceros.id, tImportaciones.proveedorId))
    .where(
      and(
        isNull(tImportaciones.polizaId),
        sql`${tImportaciones.estado} NOT IN ('liquidada', 'anulada')`,
      ),
    )
    .orderBy(desc(tImportaciones.fechaOrden))
    .limit(200);

export async function cargarPoliza(db: Db, polizaId: string) {
  const [cabecera] = await db
    .select({
      id: polizas.id,
      numero: polizas.numero,
      fecha: polizas.fecha,
      fechaNumeracion: polizas.fechaNumeracion,
      aduana: polizas.aduana,
      regimen: polizas.regimen,
      agenteId: polizas.agenteId,
      agente: terceros.razonSocial,
      tipoCambio: polizas.tipoCambio,
      estado: polizas.estado,
      observaciones: polizas.observaciones,
    })
    .from(polizas)
    .leftJoin(terceros, eq(terceros.id, polizas.agenteId))
    .where(eq(polizas.id, polizaId))
    .limit(1);
  if (!cabecera) throw new PolizaInvalida("la póliza no existe");

  const embarques = await db
    .select({
      id: tImportaciones.id,
      numero: tImportaciones.numero,
      proveedorId: tImportaciones.proveedorId,
      proveedor: terceros.razonSocial,
      almacen: almacenes.nombre,
      almacenId: tImportaciones.almacenId,
      moneda: tImportaciones.moneda,
      tipoCambio: tImportaciones.tipoCambio,
      estado: tImportaciones.estado,
      fechaOrden: tImportaciones.fechaOrden,
    })
    .from(tImportaciones)
    .innerJoin(terceros, eq(terceros.id, tImportaciones.proveedorId))
    .leftJoin(almacenes, eq(almacenes.id, tImportaciones.almacenId))
    .where(eq(tImportaciones.polizaId, polizaId))
    .orderBy(asc(tImportaciones.numero));

  const gastos = await db
    .select()
    .from(importacionGastos)
    .where(eq(importacionGastos.polizaId, polizaId))
    .orderBy(asc(importacionGastos.creadoEn));

  return { cabecera, embarques, gastos };
}

// ─── Reparto de los gastos de la póliza entre sus embarques ───────────────

export type ParteDeGasto = {
  gastoId: string;
  concepto: string;
  /** Ya en soles: la parte que le toca a este embarque. */
  importe: Dec;
  base: dominio.BaseProrrateo;
  afectaCosto: boolean;
  proveedorId: string | null;
};

type PesoEmbarque = { importacionId: string; fob: Dec; peso: Dec; volumen: Dec; cantidad: Dec };

/**
 * Lo que pesa cada embarque dentro de la póliza, por cada base de prorrateo.
 *
 * El FOB se valoriza con el tipo de cambio de la DUA, no con el de cada
 * embarque: es lo que hace comparables dos facturas del exterior emitidas en
 * semanas distintas.
 */
async function pesosDeEmbarques(
  db: Db,
  polizaId: string,
  tipoCambioDua: Dec,
): Promise<PesoEmbarque[]> {
  const filas = await db
    .select({
      importacionId: importacionItems.importacionId,
      fobMoneda: sql<string>`sum(${importacionItems.cantidad} * ${importacionItems.fobUnitario})`,
      peso: sql<string>`coalesce(sum(${importacionItems.peso}), 0)`,
      volumen: sql<string>`coalesce(sum(${importacionItems.volumen}), 0)`,
      cantidad: sql<string>`sum(${importacionItems.cantidad})`,
    })
    .from(importacionItems)
    .innerJoin(tImportaciones, eq(tImportaciones.id, importacionItems.importacionId))
    .where(eq(tImportaciones.polizaId, polizaId))
    .groupBy(importacionItems.importacionId);

  return filas.map((f) => ({
    importacionId: f.importacionId,
    fob: money.round(money.mul(dec(f.fobMoneda), tipoCambioDua), 2),
    peso: dec(f.peso),
    volumen: dec(f.volumen),
    cantidad: dec(f.cantidad),
  }));
}

/**
 * Reparte los gastos de la póliza entre sus embarques.
 *
 * Devuelve, por embarque, la lista de partes que le tocan. Cada parte ya viene
 * en soles, porque convertir una vez arriba y prorratear abajo es lo que
 * garantiza que la suma vuelva a dar el gasto.
 */
export async function repartirGastosPoliza(
  db: Db,
  polizaId: string,
): Promise<Map<string, ParteDeGasto[]>> {
  const { cabecera, embarques, gastos } = await cargarPoliza(db, polizaId);
  const reparto = new Map<string, ParteDeGasto[]>(embarques.map((e) => [e.id, []]));
  if (embarques.length === 0 || gastos.length === 0) return reparto;

  const tcDua = dec(cabecera.tipoCambio);
  const pesos = await pesosDeEmbarques(db, polizaId, tcDua);
  // El orden manda: `distribute` devuelve las partes en el orden de los pesos.
  const orden = embarques.map((e) => pesos.find((p) => p.importacionId === e.id));

  for (const g of gastos) {
    const enSoles = money.round(money.mul(dec(g.importe), dec(g.tipoCambio)), 2);
    const base = g.baseProrrateo as Exclude<dominio.BaseProrrateo, "directo">;

    const w = orden.map((p) => {
      if (!p) return money.ZERO;
      switch (base) {
        case "fob":
          return p.fob;
        case "peso":
          return p.peso;
        case "volumen":
          return p.volumen;
        case "cantidad":
          return p.cantidad;
      }
    });

    // Un gasto que se prorratea por peso y ningún embarque lo declara se
    // repartiría en partes iguales sin decir nada. Mejor detenerse: lo que
    // saldría es un costo inventado.
    if (base !== "fob" && w.every((x) => money.isZero(x))) {
      throw new PolizaInvalida(
        `el gasto «${g.concepto}» se prorratea por ${base} y ningún embarque de la póliza lo declara`,
      );
    }

    const partes = money.distribute(enSoles, w, 2);
    embarques.forEach((e, i) => {
      const importe = partes[i]!;
      if (money.isZero(importe)) return;
      reparto.get(e.id)!.push({
        gastoId: g.id,
        concepto: g.concepto,
        importe,
        base: g.baseProrrateo as dominio.BaseProrrateo,
        afectaCosto: g.afectaCosto,
        proveedorId: g.proveedorId,
      });
    });
  }

  return reparto;
}

/**
 * Baja los gastos de la póliza a cada embarque como gastos propios.
 *
 * Se guardan de verdad, no se calculan al vuelo, por la misma razón que la
 * liquidación guarda su resultado: el embarque ya liquidado tiene que seguir
 * explicando sus números aunque alguien toque la póliza después.
 *
 * Quedan en soles y con base «fob» dentro del embarque: el reparto entre
 * embarques ya ocurrió con la base que tocaba, y dentro de uno solo el criterio
 * vuelve a ser el valor, que es el que reparte un flete entre artículos.
 */
async function bajarGastosAlEmbarque(
  db: Db,
  empresaId: string,
  importacionId: string,
  partes: readonly ParteDeGasto[],
  numeroPoliza: string,
): Promise<void> {
  if (partes.length === 0) return;
  await db.insert(importacionGastos).values(
    partes.map((p) => ({
      empresaId,
      importacionId,
      polizaId: null,
      concepto: `${p.concepto} (DUA ${numeroPoliza})`,
      importe: txt2(p.importe),
      moneda: "PEN",
      tipoCambio: "1",
      baseProrrateo: p.base === "directo" ? "fob" : p.base,
      afectaCosto: p.afectaCosto,
      proveedorId: p.proveedorId,
      documento: `DUA ${numeroPoliza}`,
    })),
  );
}

export type VistaPreviaPoliza = {
  cabecera: Awaited<ReturnType<typeof cargarPoliza>>["cabecera"];
  gastoTotal: string;
  embarques: {
    id: string;
    numero: string;
    proveedor: string;
    estado: string;
    /** Parte de los gastos de la póliza que le toca, en soles. */
    gastosPoliza: string;
    partes: { concepto: string; importe: string; base: string; afectaCosto: boolean }[];
  }[];
  /** Cuadra si lo repartido es exactamente lo gastado. */
  cuadra: boolean;
};

/**
 * Muestra el reparto sin escribir nada.
 *
 * Es lo que el usuario mira antes de liquidar: cuánto de la DUA le toca a cada
 * embarque y por qué.
 */
export async function previsualizarPoliza(db: Db, polizaId: string): Promise<VistaPreviaPoliza> {
  const { cabecera, embarques, gastos } = await cargarPoliza(db, polizaId);
  const reparto = await repartirGastosPoliza(db, polizaId);

  const gastoTotal = gastos.reduce<Dec>(
    (a, g) => money.add(a, money.round(money.mul(dec(g.importe), dec(g.tipoCambio)), 2)),
    money.ZERO,
  );

  const detalle = embarques.map((e) => {
    const partes = reparto.get(e.id) ?? [];
    return {
      id: e.id,
      numero: e.numero,
      proveedor: e.proveedor,
      estado: e.estado,
      gastosPoliza: txt2(partes.reduce<Dec>((a, p) => money.add(a, p.importe), money.ZERO)),
      partes: partes.map((p) => ({
        concepto: p.concepto,
        importe: txt2(p.importe),
        base: p.base,
        afectaCosto: p.afectaCosto,
      })),
    };
  });

  const repartido = detalle.reduce<Dec>((a, d) => money.add(a, dec(d.gastosPoliza)), money.ZERO);

  return {
    cabecera,
    gastoTotal: txt2(gastoTotal),
    embarques: detalle,
    cuadra: repartido === gastoTotal,
  };
}

export type ResultadoLiquidacionPoliza = {
  polizaId: string;
  liquidaciones: (ResultadoConfirmacion & { importacionId: string; numero: string })[];
  costoTotal: string;
};

/**
 * Liquida la póliza entera.
 *
 * Baja los gastos de la DUA a cada embarque y liquida uno por uno con la
 * maquinaria de siempre: cada embarque conserva su asiento, su ingreso al
 * almacén y su cuenta por pagar, porque cada uno tiene su proveedor y su
 * mercadería. Lo que la póliza aporta es el reparto correcto de lo que es común.
 *
 * Todo ocurre en la transacción de quien llama. Media póliza liquidada es peor
 * que ninguna: los embarques que quedaran fuera arrastrarían un costo que no
 * incluye su parte de la DUA, y nadie se enteraría hasta vender.
 */
export async function liquidarPoliza(
  db: Db,
  empresaId: string,
  usuarioId: string,
  polizaId: string,
  datos: { fecha: string; periodo: string; prefijoNumero?: string },
): Promise<ResultadoLiquidacionPoliza> {
  const { cabecera, embarques } = await cargarPoliza(db, polizaId);
  if (cabecera.estado !== "abierta") {
    throw new PolizaInvalida(`la póliza está ${cabecera.estado}`);
  }
  if (embarques.length === 0) {
    throw new PolizaInvalida("la póliza no tiene embarques que liquidar");
  }
  const pendientes = embarques.filter((e) => e.estado !== "liquidada" && e.estado !== "anulada");
  if (pendientes.length === 0) {
    throw new PolizaInvalida("todos los embarques de la póliza ya están liquidados");
  }
  const sinAlmacen = pendientes.find((e) => !e.almacenId);
  if (sinAlmacen) {
    throw new PolizaInvalida(
      `el embarque ${sinAlmacen.numero} no tiene almacén de ingreso: indíquelo antes de liquidar`,
    );
  }

  const reparto = await repartirGastosPoliza(db, polizaId);
  const prefijo = datos.prefijoNumero ?? `LIQ-${cabecera.numero}`;

  const resultados: (ResultadoConfirmacion & { importacionId: string; numero: string })[] = [];
  let costoTotal = money.ZERO;

  for (const [i, e] of pendientes.entries()) {
    await bajarGastosAlEmbarque(db, empresaId, e.id, reparto.get(e.id) ?? [], cabecera.numero);

    // El tipo de cambio de la DUA manda sobre el del embarque: es el que fija
    // la aduana para la fecha de numeración.
    await db
      .update(tImportaciones)
      .set({ tipoCambio: cabecera.tipoCambio, duaNumero: cabecera.numero, duaFecha: cabecera.fecha })
      .where(eq(tImportaciones.id, e.id));

    const r = await confirmarLiquidacion(db, empresaId, usuarioId, e.id, {
      numero: `${prefijo}-${String(i + 1).padStart(2, "0")}`,
      fecha: datos.fecha,
      periodo: datos.periodo,
    });
    resultados.push({ ...r, importacionId: e.id, numero: e.numero });
    costoTotal = money.add(costoTotal, dec(r.costoTotal));
  }

  await db.update(polizas).set({ estado: "liquidada" }).where(eq(polizas.id, polizaId));

  return { polizaId, liquidaciones: resultados, costoTotal: txt2(costoTotal) };
}

export async function anularPoliza(db: Db, polizaId: string): Promise<void> {
  const p = await exigirAbierta(db, polizaId);
  await db.update(tImportaciones).set({ polizaId: null }).where(eq(tImportaciones.polizaId, p.id));
  await db.update(polizas).set({ estado: "anulada" }).where(eq(polizas.id, p.id));
}
