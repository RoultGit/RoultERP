/**
 * Planillas de cobranza.
 *
 * La hoja con la que un cobrador sale a la calle, o con la que se entregan
 * letras al banco. Reúne documentos, se imprime, se firma al entregarla y se
 * liquida al volver.
 *
 * No mueve dinero ni contabilidad: eso lo sigue haciendo la cobranza, con su
 * asiento y su ingreso a caja. Lo que la planilla aporta es **saber en manos de
 * quién está cada documento**, que es justo lo que falta cuando una factura
 * lleva tres semanas «en gestión» y nadie sabe quién la tiene.
 *
 * Dos decisiones que sostienen el módulo:
 *
 * - **Una planilla no toma lo que ya está en otra.** Se ofrece el saldo libre,
 *   igual que en la orden de pago. Dos cobradores con la misma factura es la
 *   forma de cobrarla dos veces, o de que nadie la cobre porque cada uno cree
 *   que la tiene el otro.
 * - **Lo cobrado se mide contra el documento, no se apunta a mano.** La
 *   liquidación compara el importe entregado con el saldo vivo de cada
 *   documento. Si alguien cobró por otra vía, también cuenta: lo que interesa
 *   es si la deuda se pagó, no por qué camino.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { siguienteNumero } from "./correlativos.ts";
import { SALDO_POR_COBRAR } from "./cobranzas.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  planillasCobranza, planillaCobranzaDocumentos, letras, usuarios,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

/**
 * Una lista de valores para un `IN (...)`.
 *
 * Interpolar un array de JavaScript en una plantilla de Drizzle no produce un
 * array de Postgres sino una tupla, y la consulta falla con «malformed array
 * literal» en tiempo de ejecución: el compilador no lo ve.
 */
const enLista = (valores: readonly string[]) =>
  sql.join(valores.map((v) => sql`${v}`), sql`, `);

export class PlanillaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "PlanillaInvalida");
  }
}

export const ESTADO_PLANILLA = {
  ABIERTA: "abierta",
  CERRADA: "cerrada",
  ANULADA: "anulada",
} as const;

/** Estados de letra en los que sigue siendo cobrable. */
const LETRA_VIVA = ["girada", "aceptada", "en_cartera", "descontada", "protestada"];

export type DatosPlanilla = {
  fecha: string;
  /** cobrador o banco. */
  tipo?: string;
  responsable: string;
  observaciones?: string;
  /** Sin importe se entrega el saldo libre del documento. */
  documentos: { comprobanteId?: string; letraId?: string; importe?: string }[];
};

/**
 * Lo que un documento puede entregar: su saldo menos lo que ya está en otra
 * planilla abierta.
 */
async function comprometido(
  db: Db,
  comprobanteIds: string[],
  letraIds: string[],
): Promise<Map<string, Dec>> {
  const mapa = new Map<string, Dec>();
  if (comprobanteIds.length === 0 && letraIds.length === 0) return mapa;

  const filas = (await db.execute(sql`
    SELECT d.comprobante_id, d.letra_id, sum(d.importe)::text AS importe
    FROM planilla_cobranza_documentos d
    JOIN planillas_cobranza p ON p.id = d.planilla_id
    WHERE p.estado = ${ESTADO_PLANILLA.ABIERTA} AND (${sql.join(
      [
        ...(comprobanteIds.length ? [sql`d.comprobante_id IN (${enLista(comprobanteIds)})`] : []),
        ...(letraIds.length ? [sql`d.letra_id IN (${enLista(letraIds)})`] : []),
      ],
      sql` OR `,
    )})
    GROUP BY d.comprobante_id, d.letra_id`)) as unknown as {
    comprobante_id: string | null;
    letra_id: string | null;
    importe: string;
  }[];

  for (const f of filas) {
    const clave = f.comprobante_id ?? f.letra_id!;
    mapa.set(clave, money.add(mapa.get(clave) ?? money.ZERO, dec(f.importe)));
  }
  return mapa;
}

export async function crearPlanilla(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPlanilla,
): Promise<{ id: string; numero: string; importe: string }> {
  if (datos.documentos.length === 0) {
    throw new PlanillaInvalida(["una planilla necesita al menos un documento"]);
  }
  if (!datos.responsable.trim()) {
    throw new PlanillaInvalida(["hay que decir a quién se le entrega la planilla"]);
  }

  const motivos: string[] = [];
  for (const d of datos.documentos) {
    if (!d.comprobanteId === !d.letraId) {
      motivos.push("cada renglón es una factura o una letra, no las dos ni ninguna");
    }
  }
  if (motivos.length) throw new PlanillaInvalida(motivos);

  const comprobanteIds = datos.documentos.map((d) => d.comprobanteId).filter((x): x is string => !!x);
  const letraIds = datos.documentos.map((d) => d.letraId).filter((x): x is string => !!x);

  const facturas =
    comprobanteIds.length === 0
      ? []
      : ((await db.execute(sql`
          SELECT c.id, c.serie, c.numero, c.moneda, c.cliente_id,
                 ${SALDO_POR_COBRAR}::text AS saldo
          FROM comprobantes c
          WHERE c.id IN (${enLista(comprobanteIds)})
            AND c.estado NOT IN ('anulado', 'rechazado')`)) as unknown as {
          id: string;
          serie: string;
          numero: string;
          moneda: string;
          cliente_id: string;
          saldo: string;
        }[]);

  const enCartera =
    letraIds.length === 0
      ? []
      : await db
          .select({
            id: letras.id,
            numero: letras.numero,
            moneda: letras.moneda,
            saldo: letras.saldo,
            estado: letras.estado,
            clienteId: letras.terceroId,
          })
          .from(letras)
          .where(and(eq(letras.cartera, "cobrar"), inArray(letras.id, letraIds)));

  const porId = new Map<string, { etiqueta: string; moneda: string; saldo: Dec }>();
  for (const f of facturas) {
    porId.set(f.id, { etiqueta: `${f.serie}-${f.numero}`, moneda: f.moneda, saldo: dec(f.saldo) });
  }
  for (const l of enCartera) {
    if (!LETRA_VIVA.includes(l.estado)) {
      motivos.push(`la letra ${l.numero} está ${l.estado} y no se puede entregar a cobrar`);
      continue;
    }
    porId.set(l.id, { etiqueta: `letra ${l.numero}`, moneda: l.moneda, saldo: dec(l.saldo) });
  }

  const ya = await comprometido(db, comprobanteIds, letraIds);

  const lineas: { comprobanteId: string | null; letraId: string | null; importe: Dec }[] = [];
  let moneda: string | null = null;
  let total = money.ZERO;

  for (const pedido of datos.documentos) {
    const clave = pedido.comprobanteId ?? pedido.letraId!;
    const doc = porId.get(clave);
    if (!doc) {
      motivos.push("uno de los documentos no existe, está anulado o no tiene saldo");
      continue;
    }
    if (moneda === null) moneda = doc.moneda;
    else if (moneda !== doc.moneda) {
      motivos.push("una planilla no mezcla monedas: arme una por cada una");
      continue;
    }

    const libre = money.sub(doc.saldo, ya.get(clave) ?? money.ZERO);
    const importe = pedido.importe ? dec(pedido.importe) : libre;

    if (!money.gt(importe, money.ZERO)) {
      motivos.push(`${doc.etiqueta} no tiene saldo libre que entregar`);
      continue;
    }
    if (money.gt(importe, libre)) {
      motivos.push(
        `de ${doc.etiqueta} sólo quedan ${txt2(libre)} sin entregar` +
          (money.isZero(ya.get(clave) ?? money.ZERO) ? "" : " (el resto está en otra planilla)"),
      );
      continue;
    }

    lineas.push({
      comprobanteId: pedido.comprobanteId ?? null,
      letraId: pedido.letraId ?? null,
      importe,
    });
    total = money.add(total, importe);
  }

  if (motivos.length) throw new PlanillaInvalida(motivos);

  const numero = await siguienteNumero(
    db, planillasCobranza, planillasCobranza.numero, "PC", datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(planillasCobranza)
    .values({
      empresaId,
      numero,
      fecha: datos.fecha,
      tipo: datos.tipo ?? "cobrador",
      responsable: datos.responsable.trim(),
      moneda: moneda ?? "PEN",
      importe: txt2(total),
      observaciones: datos.observaciones ?? null,
      entregadaPor: usuarioId,
      creadoPor: usuarioId,
    })
    .returning({ id: planillasCobranza.id });

  await db.insert(planillaCobranzaDocumentos).values(
    lineas.map((l) => ({
      empresaId,
      planillaId: cab!.id,
      comprobanteId: l.comprobanteId,
      letraId: l.letraId,
      importe: txt2(l.importe),
    })),
  );

  return { id: cab!.id, numero, importe: txt2(total) };
}

export type RenglonPlanilla = {
  documento: string;
  cliente: string;
  vencimiento: string | null;
  entregado: string;
  /** Saldo vivo del documento ahora mismo. */
  saldo: string;
  /** Lo entregado menos lo que sigue debiéndose, nunca negativo. */
  cobrado: string;
};

export type PlanillaLiquidada = {
  id: string;
  numero: string;
  fecha: string;
  tipo: string;
  responsable: string;
  moneda: string;
  estado: string;
  observaciones: string | null;
  entregadaPor: string | null;
  renglones: RenglonPlanilla[];
  entregado: string;
  cobrado: string;
  pendiente: string;
};

/**
 * La planilla con lo que se cobró de ella.
 *
 * Lo cobrado no se apunta: se deduce del saldo vivo de cada documento. Si el
 * cliente pagó por transferencia en vez de al cobrador, la deuda igual se
 * extinguió y la planilla lo refleja; lo contrario sería llevar dos verdades y
 * discutir cuál vale.
 */
export async function liquidarPlanilla(db: Db, planillaId: string): Promise<PlanillaLiquidada> {
  const [cab] = await db
    .select({
      id: planillasCobranza.id,
      numero: planillasCobranza.numero,
      fecha: planillasCobranza.fecha,
      tipo: planillasCobranza.tipo,
      responsable: planillasCobranza.responsable,
      moneda: planillasCobranza.moneda,
      estado: planillasCobranza.estado,
      observaciones: planillasCobranza.observaciones,
      entregadaPor: usuarios.nombre,
    })
    .from(planillasCobranza)
    .leftJoin(usuarios, eq(usuarios.id, planillasCobranza.entregadaPor))
    .where(eq(planillasCobranza.id, planillaId))
    .limit(1);
  if (!cab) throw new PlanillaInvalida(["la planilla no existe en esta empresa"]);

  const filas = (await db.execute(sql`
    SELECT coalesce(cf.serie || '-' || cf.numero, 'Letra ' || l.numero) AS documento,
           coalesce(tc.razon_social, tl.razon_social) AS cliente,
           coalesce(cf.fecha_vencimiento::text, l.fecha_vencimiento::text) AS vencimiento,
           d.importe::text AS entregado,
           coalesce(
             (SELECT ${SALDO_POR_COBRAR} FROM comprobantes c WHERE c.id = d.comprobante_id),
             l.saldo
           )::text AS saldo
    FROM planilla_cobranza_documentos d
    LEFT JOIN comprobantes cf ON cf.id = d.comprobante_id
    LEFT JOIN terceros tc     ON tc.id = cf.cliente_id
    LEFT JOIN letras l        ON l.id = d.letra_id
    LEFT JOIN terceros tl     ON tl.id = l.tercero_id
    WHERE d.planilla_id = ${planillaId}
    ORDER BY vencimiento NULLS LAST, documento`)) as unknown as {
    documento: string;
    cliente: string;
    vencimiento: string | null;
    entregado: string;
    saldo: string;
  }[];

  let entregado = money.ZERO;
  let cobrado = money.ZERO;

  const renglones: RenglonPlanilla[] = [...filas].map((f) => {
    const e = dec(f.entregado);
    const saldo = dec(f.saldo);
    // Nunca negativo: si el documento creció por una nota de débito posterior,
    // eso no es una cobranza en negativo, es otra deuda.
    const c = money.gt(e, saldo) ? money.sub(e, saldo) : money.ZERO;
    entregado = money.add(entregado, e);
    cobrado = money.add(cobrado, c);
    return {
      documento: f.documento,
      cliente: f.cliente,
      vencimiento: f.vencimiento,
      entregado: txt2(e),
      saldo: txt2(saldo),
      cobrado: txt2(c),
    };
  });

  return {
    ...cab,
    renglones,
    entregado: txt2(entregado),
    cobrado: txt2(cobrado),
    pendiente: txt2(money.sub(entregado, cobrado)),
  };
}

/**
 * Cierra la planilla.
 *
 * Cerrar no cobra nada: libera. Mientras está abierta, sus documentos están
 * comprometidos y no se pueden entregar a otro cobrador; cerrada, lo que quedó
 * sin cobrar vuelve a estar disponible para la siguiente salida.
 */
export async function cerrarPlanilla(
  db: Db,
  planillaId: string,
  usuarioId: string,
): Promise<{ cobrado: string; pendiente: string }> {
  const liquidada = await liquidarPlanilla(db, planillaId);
  if (liquidada.estado !== ESTADO_PLANILLA.ABIERTA) {
    throw new PlanillaInvalida([`la planilla ya está ${liquidada.estado}`]);
  }

  await db
    .update(planillasCobranza)
    .set({
      estado: ESTADO_PLANILLA.CERRADA,
      cerradaPor: usuarioId,
      cerradaEn: new Date(),
    })
    .where(eq(planillasCobranza.id, planillaId));

  return { cobrado: liquidada.cobrado, pendiente: liquidada.pendiente };
}

export async function anularPlanilla(db: Db, planillaId: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new PlanillaInvalida(["anular una planilla exige un motivo"]);
  const [cab] = await db
    .select({ estado: planillasCobranza.estado, observaciones: planillasCobranza.observaciones })
    .from(planillasCobranza)
    .where(eq(planillasCobranza.id, planillaId))
    .limit(1);
  if (!cab) throw new PlanillaInvalida(["la planilla no existe en esta empresa"]);
  if (cab.estado === ESTADO_PLANILLA.ANULADA) throw new PlanillaInvalida(["ya está anulada"]);

  await db
    .update(planillasCobranza)
    .set({
      estado: ESTADO_PLANILLA.ANULADA,
      observaciones: [cab.observaciones, `Anulada: ${motivo.trim()}`].filter(Boolean).join(" · "),
    })
    .where(eq(planillasCobranza.id, planillaId));
}

export async function listarPlanillas(db: Db, estado?: string) {
  return db
    .select({
      id: planillasCobranza.id,
      numero: planillasCobranza.numero,
      fecha: planillasCobranza.fecha,
      tipo: planillasCobranza.tipo,
      responsable: planillasCobranza.responsable,
      moneda: planillasCobranza.moneda,
      importe: planillasCobranza.importe,
      estado: planillasCobranza.estado,
      documentos: sql<number>`count(${planillaCobranzaDocumentos.id})`,
    })
    .from(planillasCobranza)
    .leftJoin(
      planillaCobranzaDocumentos,
      eq(planillaCobranzaDocumentos.planillaId, planillasCobranza.id),
    )
    .where(estado ? eq(planillasCobranza.estado, estado) : sql`true`)
    .groupBy(
      planillasCobranza.id,
      planillasCobranza.numero,
      planillasCobranza.fecha,
      planillasCobranza.tipo,
      planillasCobranza.responsable,
      planillasCobranza.moneda,
      planillasCobranza.importe,
      planillasCobranza.estado,
    )
    .orderBy(desc(planillasCobranza.fecha), desc(planillasCobranza.numero));
}

/**
 * Lo que se puede entregar hoy: facturas y letras con saldo libre.
 *
 * Sale ordenado por vencimiento, que es como se arma una ruta de cobranza: lo
 * más vencido primero.
 */
export async function cobrablesLibres(db: Db, clienteId?: string) {
  const filtro = clienteId ? sql`AND c.cliente_id = ${clienteId}` : sql``;
  const filtroLetra = clienteId ? sql`AND l.tercero_id = ${clienteId}` : sql``;

  const filas = (await db.execute(sql`
    WITH entregado AS (
      SELECT d.comprobante_id, d.letra_id, sum(d.importe) AS importe
      FROM planilla_cobranza_documentos d
      JOIN planillas_cobranza p ON p.id = d.planilla_id
      WHERE p.estado = ${ESTADO_PLANILLA.ABIERTA}
      GROUP BY d.comprobante_id, d.letra_id
    )
    SELECT c.id, 'comprobante' AS clase,
           c.serie || '-' || c.numero AS documento,
           t.razon_social AS cliente, c.cliente_id AS tercero_id,
           c.fecha_vencimiento::text AS vencimiento, c.moneda,
           (${SALDO_POR_COBRAR} - coalesce(e.importe, 0))::text AS libre
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    LEFT JOIN entregado e ON e.comprobante_id = c.id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03')
      AND ${SALDO_POR_COBRAR} - coalesce(e.importe, 0) > 0
      ${filtro}

    UNION ALL

    SELECT l.id, 'letra' AS clase,
           'Letra ' || l.numero AS documento,
           t.razon_social AS cliente, l.tercero_id,
           l.fecha_vencimiento::text AS vencimiento, l.moneda,
           (l.saldo - coalesce(e.importe, 0))::text AS libre
    FROM letras l
    JOIN terceros t ON t.id = l.tercero_id
    LEFT JOIN entregado e ON e.letra_id = l.id
    WHERE l.cartera = 'cobrar'
      AND l.estado IN (${enLista(LETRA_VIVA)})
      AND l.saldo - coalesce(e.importe, 0) > 0
      ${filtroLetra}

    ORDER BY vencimiento NULLS LAST, documento`)) as unknown as {
    id: string;
    clase: "comprobante" | "letra";
    documento: string;
    cliente: string;
    tercero_id: string;
    vencimiento: string | null;
    moneda: string;
    libre: string;
  }[];
  return [...filas];
}

/** Las planillas abiertas de un documento, para explicar por qué no está libre. */
export async function planillasDe(db: Db, documentoId: string) {
  return db
    .select({
      numero: planillasCobranza.numero,
      responsable: planillasCobranza.responsable,
      estado: planillasCobranza.estado,
      importe: planillaCobranzaDocumentos.importe,
    })
    .from(planillaCobranzaDocumentos)
    .innerJoin(
      planillasCobranza,
      eq(planillasCobranza.id, planillaCobranzaDocumentos.planillaId),
    )
    .where(
      sql`${planillaCobranzaDocumentos.comprobanteId} = ${documentoId}
          OR ${planillaCobranzaDocumentos.letraId} = ${documentoId}`,
    )
    .orderBy(asc(planillasCobranza.fecha));
}
