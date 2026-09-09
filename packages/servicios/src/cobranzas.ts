/**
 * Cuentas por cobrar y cobranzas.
 *
 * Es la contraparte de `pagos.ts` y comparte casi toda su mecánica, pero con
 * dos diferencias que no son cosméticas:
 *
 * - **El signo de la diferencia de cambio se invierte.** Una cuenta por cobrar
 *   es un activo: que el dólar suba es una ganancia, no una pérdida. Es el
 *   error clásico al copiar el módulo de pagos, y por eso la naturaleza se pasa
 *   explícita en lugar de asumirse.
 *
 * - **El límite de crédito.** Antes de emitir a un cliente se comprueba cuánto
 *   se le debe ya. Un ERP que no lo hace descubre la sobreexposición cuando el
 *   cliente deja de pagar.
 *
 * El documento por cobrar nace al emitir el comprobante de venta; aquí sólo se
 * cobra, se canjea por letra y se consulta.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { money, contabilidad } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { asentar, type LineaAsientoEntrada } from "./contabilidad.ts";

const { comprobantes, terceros, letras, letraDocumentos, empresas } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class CobranzaInvalida extends Error {
  constructor(readonly motivos: readonly string[]) {
    super(motivos.join("; "));
    this.name = "CobranzaInvalida";
  }
}

/**
 * Documentos por cobrar abiertos.
 *
 * Se derivan de los comprobantes emitidos menos lo cobrado. No hay una tabla
 * `documentos_cxc` como en el lado de pagar: el comprobante ya tiene todo lo
 * que hace falta, y duplicarlo obligaría a mantener dos verdades sincronizadas.
 */
/**
 * Lo que queda por cobrar de un comprobante.
 *
 * Se descuenta lo cobrado **y lo canjeado por letra**: una factura canjeada
 * deja de estar pendiente aunque nadie haya pagado todavía, porque la deuda
 * ahora vive en la letra. Esta expresión es la única definición del saldo; el
 * resto de consultas la reutilizan para que no puedan discrepar.
 */
const SALDO = sql`(c.total
  - coalesce((SELECT sum(ca.importe) FROM cobranza_aplicaciones ca
              WHERE ca.comprobante_id = c.id), 0)
  - coalesce((SELECT sum(ld.importe) FROM letra_documentos ld
              WHERE ld.documento_id = c.id), 0))`;

export async function documentosPorCobrar(db: Db, clienteId?: string) {
  const filtro = clienteId ? sql`AND c.cliente_id = ${clienteId}` : sql``;
  const filas = (await db.execute(sql`
    SELECT c.id, c.cliente_id, t.razon_social AS cliente, t.numero_documento AS documento_cliente,
           c.tipo_documento, c.serie, c.numero, c.fecha_emision, c.fecha_vencimiento,
           c.moneda, c.tipo_cambio::text AS tipo_cambio, c.total::text AS total,
           ${SALDO}::text AS saldo
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03')
      AND ${SALDO} > 0
      ${filtro}
    ORDER BY c.fecha_vencimiento NULLS LAST, c.fecha_emision`)) as unknown as {
    id: string;
    cliente_id: string;
    cliente: string;
    documento_cliente: string;
    tipo_documento: string;
    serie: string;
    numero: string;
    fecha_emision: string;
    fecha_vencimiento: string | null;
    moneda: string;
    tipo_cambio: string;
    total: string;
    saldo: string;
  }[];
  // El driver devuelve un objeto Result; se copia a un array para que el tipo
  // declarado coincida con el prototipo real y comparar el resultado no
  // sorprenda a quien llame.
  return [...filas];
}

export type AplicacionCobranza = { comprobanteId: string; importe: string };

export type DatosCobranza = {
  numero: string;
  clienteId: string;
  fecha: string;
  moneda: string;
  tipoCambio: string;
  /** efectivo, transferencia, cheque, deposito */
  medioCobro: string;
  /** Cuenta contable donde entra el dinero: 1041 banco, 1011 caja… */
  cuentaDestino: string;
  aplicaciones: AplicacionCobranza[];
  referencia?: string;
};

export type CobranzaRegistrada = {
  cobranzaId: string;
  asientoId: string;
  importe: string;
  diferenciaCambio: string;
  documentosCancelados: number;
};

/**
 * Registra una cobranza y la aplica a los comprobantes indicados.
 *
 * El saldo de cada comprobante se calcula en el momento y con la fila
 * bloqueada, igual que en los pagos: dos cobranzas simultáneas sobre la misma
 * factura no pueden dejarla sobrecobrada.
 */
export async function registrarCobranza(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCobranza,
): Promise<CobranzaRegistrada> {
  const motivos: string[] = [];
  if (datos.aplicaciones.length === 0) motivos.push("indique a qué comprobantes se aplica la cobranza");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) motivos.push("la fecha de la cobranza es inválida");
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) motivos.push("el tipo de cambio debe ser positivo");
  if (motivos.length) throw new CobranzaInvalida(motivos);

  const [cliente] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, datos.clienteId))
    .limit(1);
  if (!cliente) throw new CobranzaInvalida(["el cliente no existe en esta empresa"]);

  const ids = datos.aplicaciones.map((a) => a.comprobanteId);
  const docs = await db
    .select()
    .from(comprobantes)
    .where(inArray(comprobantes.id, ids))
    .for("update");
  if (docs.length !== ids.length) {
    throw new CobranzaInvalida(["alguno de los comprobantes no existe en esta empresa"]);
  }

  const saldos = await saldosDe(db, ids);

  let importeTotal = money.ZERO;
  let historico = money.ZERO;
  let diferenciaTotal = money.ZERO;
  const detalle: { comprobanteId: string; importe: Dec; diferencia: Dec }[] = [];
  const tipoCambioCobro = dec(datos.tipoCambio);

  for (const a of datos.aplicaciones) {
    const doc = docs.find((d) => d.id === a.comprobanteId)!;
    const importe = dec(a.importe);
    const saldo = saldos.get(doc.id) ?? money.ZERO;

    if (!money.gt(importe, money.ZERO)) {
      throw new CobranzaInvalida([
        `el importe aplicado a ${doc.serie}-${doc.numero} debe ser positivo`,
      ]);
    }
    if (doc.clienteId !== datos.clienteId) {
      throw new CobranzaInvalida([`el comprobante ${doc.serie}-${doc.numero} es de otro cliente`]);
    }
    if (money.gt(importe, saldo)) {
      throw new CobranzaInvalida([
        `${doc.serie}-${doc.numero} tiene un saldo de ${txt2(saldo)} y se intenta cobrar ${txt2(importe)}`,
      ]);
    }

    // Una cuenta por cobrar es un **activo**: que el dólar suba es ganancia.
    // Copiar el signo del módulo de pagos aquí sería el error más silencioso
    // posible; por eso la naturaleza va explícita.
    const diferencia =
      doc.moneda === "PEN"
        ? money.ZERO
        : contabilidad.diferenciaCambio(
            importe,
            dec(doc.tipoCambio),
            tipoCambioCobro,
            "activo",
          ).importe;

    importeTotal = money.add(importeTotal, importe);
    historico = money.add(historico, money.round(money.mul(importe, dec(doc.tipoCambio)), 2));
    diferenciaTotal = money.add(diferenciaTotal, diferencia);
    detalle.push({ comprobanteId: doc.id, importe, diferencia });
  }

  const [cab] = await db
    .insert(s.cobranzas)
    .values({
      empresaId,
      numero: datos.numero,
      clienteId: datos.clienteId,
      fecha: datos.fecha,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      medioCobro: datos.medioCobro,
      importe: txt2(importeTotal),
      referencia: datos.referencia ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: s.cobranzas.id });
  const cobranzaId = cab!.id;

  for (const d of detalle) {
    await db.insert(s.cobranzaAplicaciones).values({
      empresaId,
      cobranzaId,
      comprobanteId: d.comprobanteId,
      importe: txt2(d.importe),
      diferenciaCambio: txt2(d.diferencia),
    });
  }

  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa: `Cobranza ${datos.numero} · ${cliente.razonSocial}`,
    moneda: datos.moneda,
    tipoCambio: datos.tipoCambio,
    origenModulo: "cobranzas",
    origenId: cobranzaId,
    lineas: lineasAsientoCobranza({
      importe: importeTotal,
      historico,
      diferencia: diferenciaTotal,
      tipoCambioCobro,
      cuentaDestino: datos.cuentaDestino,
      clienteId: datos.clienteId,
    }),
  });

  await db.update(s.cobranzas).set({ asientoId }).where(eq(s.cobranzas.id, cobranzaId));

  const nuevosSaldos = await saldosDe(db, ids);
  return {
    cobranzaId,
    asientoId,
    importe: txt2(importeTotal),
    diferenciaCambio: txt2(diferenciaTotal),
    documentosCancelados: ids.filter((id) => money.isZero(nuevosSaldos.get(id) ?? money.ZERO)).length,
  };
}

/**
 * Asiento de la cobranza.
 *
 * Entra el dinero al banco por lo que se cobra hoy y se abona la cuenta del
 * cliente por lo que la deuda vale **en la cuenta**, al tipo con el que se
 * facturó. La diferencia es real y va a la 776 o a la 676.
 */
function lineasAsientoCobranza(p: {
  importe: Dec;
  historico: Dec;
  diferencia: Dec;
  tipoCambioCobro: Dec;
  cuentaDestino: string;
  clienteId: string;
}): LineaAsientoEntrada[] {
  const lineas: LineaAsientoEntrada[] = [
    {
      cuenta: p.cuentaDestino,
      glosa: "Ingreso de fondos",
      debe: txt2(p.importe),
      debeFuncional: txt2(money.round(money.mul(p.importe, p.tipoCambioCobro), 2)),
    },
    {
      cuenta: "1212",
      glosa: "Cancelación del cliente",
      haber: txt2(p.importe),
      haberFuncional: txt2(p.historico),
      anexoId: p.clienteId,
    },
  ];

  if (!money.isZero(p.diferencia)) {
    lineas.push(
      money.gt(p.diferencia, money.ZERO)
        ? { cuenta: "776", glosa: "Diferencia de cambio", haberFuncional: txt2(p.diferencia) }
        : {
            cuenta: "676",
            glosa: "Diferencia de cambio",
            debeFuncional: txt2(money.neg(p.diferencia)),
          },
    );
  }

  return lineas;
}

/**
 * Saldo pendiente de cada comprobante, con la misma definición que la lista.
 *
 * Se resuelve con tres consultas sencillas y la resta en JavaScript en lugar de
 * una sola con subconsultas correlacionadas: `inArray` de drizzle parametriza
 * la lista correctamente, mientras que interpolar un arreglo dentro de una
 * plantilla `sql` no lo hace, y el resultado silencioso sería un saldo que
 * ignora lo ya cobrado.
 */
async function saldosDe(db: Db, ids: string[]): Promise<Map<string, Dec>> {
  if (ids.length === 0) return new Map();

  const totales = await db
    .select({ id: comprobantes.id, total: comprobantes.total })
    .from(comprobantes)
    .where(inArray(comprobantes.id, ids));

  const cobrado = await db
    .select({
      comprobanteId: s.cobranzaAplicaciones.comprobanteId,
      importe: sql<string>`sum(${s.cobranzaAplicaciones.importe})::text`,
    })
    .from(s.cobranzaAplicaciones)
    .where(inArray(s.cobranzaAplicaciones.comprobanteId, ids))
    .groupBy(s.cobranzaAplicaciones.comprobanteId);

  const canjeado = await db
    .select({
      documentoId: letraDocumentos.documentoId,
      importe: sql<string>`sum(${letraDocumentos.importe})::text`,
    })
    .from(letraDocumentos)
    .where(inArray(letraDocumentos.documentoId, ids))
    .groupBy(letraDocumentos.documentoId);

  const porCobrado = new Map(cobrado.map((c) => [c.comprobanteId, dec(c.importe)]));
  const porCanjeado = new Map(canjeado.map((c) => [c.documentoId, dec(c.importe)]));

  return new Map(
    totales.map((t) => [
      t.id,
      money.sub(
        dec(t.total),
        money.add(porCobrado.get(t.id) ?? money.ZERO, porCanjeado.get(t.id) ?? money.ZERO),
      ),
    ]),
  );
}

// ─── Límite de crédito ────────────────────────────────────────────────────

export type EstadoCredito = {
  limite: Dec;
  usado: Dec;
  disponible: Dec;
  /** true si el cliente no tiene límite configurado: se le vende sin tope. */
  sinLimite: boolean;
  vencido: Dec;
};

/**
 * Exposición actual con un cliente.
 *
 * `usado` es lo que se le debe hoy; `vencido`, la parte que ya pasó de fecha.
 * Un cliente con saldo dentro del límite pero todo vencido es más riesgoso que
 * uno al tope y al día, y por eso se devuelven ambas cifras.
 */
export async function estadoCredito(db: Db, clienteId: string): Promise<EstadoCredito> {
  const [cliente] = await db
    .select({ limite: terceros.limiteCredito })
    .from(terceros)
    .where(eq(terceros.id, clienteId))
    .limit(1);

  const documentos = await documentosPorCobrar(db, clienteId);
  const [hoyFila] = (await db.execute(sql`SELECT current_date::text AS hoy`)) as unknown as [
    { hoy: string },
  ];
  const hoy = hoyFila?.hoy ?? new Date().toISOString().slice(0, 10);

  const usado = documentos.reduce((a, d) => money.add(a, dec(d.saldo)), money.ZERO);
  const vencido = documentos
    .filter((d) => d.fecha_vencimiento !== null && d.fecha_vencimiento < hoy)
    .reduce((a, d) => money.add(a, dec(d.saldo)), money.ZERO);

  const limite = dec(cliente?.limite);
  return {
    limite,
    usado,
    disponible: money.sub(limite, usado),
    sinLimite: money.isZero(limite),
    vencido,
  };
}

/**
 * Comprueba si una venta cabe en el límite del cliente.
 *
 * Devuelve el motivo en vez de lanzar: quien vende necesita poder decidir si
 * autoriza igual, y eso es una decisión comercial que el sistema informa pero
 * no toma.
 */
export async function cabeEnElLimite(
  db: Db,
  clienteId: string,
  importe: Dec,
): Promise<{ cabe: boolean; motivo?: string; estado: EstadoCredito }> {
  const estado = await estadoCredito(db, clienteId);
  if (estado.sinLimite) return { cabe: true, estado };

  if (money.gt(importe, estado.disponible)) {
    return {
      cabe: false,
      motivo: `El cliente tiene un límite de ${txt2(estado.limite)}, ya usa ${txt2(estado.usado)} y le quedan ${txt2(estado.disponible)}.`,
      estado,
    };
  }
  return { cabe: true, estado };
}

// ─── Consultas ────────────────────────────────────────────────────────────

export const listarCobranzas = (db: Db) =>
  db
    .select({
      id: s.cobranzas.id,
      numero: s.cobranzas.numero,
      cliente: terceros.razonSocial,
      fecha: s.cobranzas.fecha,
      moneda: s.cobranzas.moneda,
      medioCobro: s.cobranzas.medioCobro,
      importe: s.cobranzas.importe,
      referencia: s.cobranzas.referencia,
    })
    .from(s.cobranzas)
    .innerJoin(terceros, eq(terceros.id, s.cobranzas.clienteId))
    .orderBy(desc(s.cobranzas.fecha))
    .limit(300);

/** Resumen por cliente, para la pantalla de cartera. */
export async function carteraPorCliente(db: Db) {
  const filas = (await db.execute(sql`
    SELECT t.id, t.razon_social, t.numero_documento, t.limite_credito::text AS limite,
           count(*)::int AS documentos,
           sum(${SALDO})::text AS saldo,
           sum(CASE WHEN c.fecha_vencimiento < current_date THEN ${SALDO} ELSE 0 END)::text AS vencido
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03')
      AND ${SALDO} > 0
    GROUP BY t.id
    ORDER BY sum(${SALDO}) DESC`)) as unknown as {
    id: string;
    razon_social: string;
    numero_documento: string;
    limite: string;
    documentos: number;
    saldo: string;
    vencido: string;
  }[];
  return [...filas];
}
