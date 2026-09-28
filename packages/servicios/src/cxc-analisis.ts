/**
 * Cuentas por cobrar: estado de cuenta y proyección de cobranzas.
 *
 * La antigüedad de saldos dice cuánto debe cada cliente hoy. Estas dos
 * consultas contestan las otras dos preguntas que se hacen todos los días:
 * **por qué** debe eso —el estado de cuenta, que es lo que se le manda cuando
 * reclama— y **cuándo** va a entrar —la proyección, que es lo que decide si
 * alcanza para pagar la planilla del viernes.
 *
 * Ninguna de las dos escribe nada. Son lecturas, y por eso pueden mirar tanto
 * las facturas como las letras sin preocuparse por transacciones.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { SALDO_POR_COBRAR } from "./cobranzas.ts";

const { comprobantes, cobranzas, cobranzaAplicaciones, letras, terceros } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export type MovimientoCuentaCliente = {
  fecha: string;
  tipo: "comprobante" | "cobranza";
  referencia: string;
  glosa: string;
  cargo: string;
  abono: string;
  saldo: string;
};

/**
 * Estado de cuenta de un cliente: facturas y boletas emitidas, cobranzas
 * aplicadas, y el saldo corriendo.
 *
 * Las notas de crédito entran como abono y las de débito como cargo, porque eso
 * es lo que son para la cuenta del cliente; verlas como «comprobantes» sueltos
 * dejaba el saldo sin explicar.
 *
 * Una serie por moneda: mezclar soles con dólares da una cifra que no significa
 * nada.
 */
export async function estadoCuentaCliente(
  db: Db,
  clienteId: string,
  rango?: { desde?: string; hasta?: string },
): Promise<{ moneda: string; movimientos: MovimientoCuentaCliente[]; saldoFinal: string }[]> {
  const cond = [
    eq(comprobantes.clienteId, clienteId),
    sql`${comprobantes.estado} NOT IN ('anulado', 'rechazado')`,
  ];
  if (rango?.desde) cond.push(sql`${comprobantes.fechaEmision} >= ${rango.desde}`);
  if (rango?.hasta) cond.push(sql`${comprobantes.fechaEmision} <= ${rango.hasta}`);

  const docs = await db
    .select({
      id: comprobantes.id,
      fecha: comprobantes.fechaEmision,
      tipoDocumento: comprobantes.tipoDocumento,
      serie: comprobantes.serie,
      numero: comprobantes.numero,
      moneda: comprobantes.moneda,
      total: comprobantes.total,
    })
    .from(comprobantes)
    .where(and(...cond))
    .orderBy(asc(comprobantes.fechaEmision));

  const aplicaciones = docs.length
    ? await db
        .select({
          comprobanteId: cobranzaAplicaciones.comprobanteId,
          importe: cobranzaAplicaciones.importe,
          fecha: cobranzas.fecha,
          numero: cobranzas.numero,
          medioCobro: cobranzas.medioCobro,
          estado: cobranzas.estado,
        })
        .from(cobranzaAplicaciones)
        .innerJoin(cobranzas, eq(cobranzas.id, cobranzaAplicaciones.cobranzaId))
        .where(inArray(cobranzaAplicaciones.comprobanteId, docs.map((d) => d.id)))
    : [];

  const porMoneda = new Map<string, MovimientoCuentaCliente[]>();
  const monedaDe = new Map(docs.map((d) => [d.id, d.moneda]));

  const NOMBRE: Record<string, string> = {
    "01": "Factura",
    "03": "Boleta",
    "07": "Nota de crédito",
    "08": "Nota de débito",
  };

  for (const d of docs) {
    const lista = porMoneda.get(d.moneda) ?? [];
    // La nota de crédito descuenta: es un abono, no un cargo negativo.
    const esCredito = d.tipoDocumento === "07";
    lista.push({
      fecha: d.fecha,
      tipo: "comprobante",
      referencia: `${d.serie}-${d.numero}`,
      glosa: NOMBRE[d.tipoDocumento] ?? "Comprobante",
      cargo: esCredito ? "0.00" : txt2(dec(d.total)),
      abono: esCredito ? txt2(dec(d.total)) : "0.00",
      saldo: "0.00",
    });
    porMoneda.set(d.moneda, lista);
  }

  for (const a of aplicaciones) {
    if (a.estado === "anulada") continue;
    const moneda = monedaDe.get(a.comprobanteId);
    if (!moneda) continue;
    const lista = porMoneda.get(moneda) ?? [];
    lista.push({
      fecha: a.fecha,
      tipo: "cobranza",
      referencia: a.numero,
      glosa: `Cobranza por ${a.medioCobro}`,
      cargo: "0.00",
      abono: txt2(dec(a.importe)),
      saldo: "0.00",
    });
    porMoneda.set(moneda, lista);
  }

  return [...porMoneda]
    .map(([moneda, movimientos]) => {
      // El comprobante va antes que su cobranza cuando caen el mismo día: un
      // abono antes del cargo deja el saldo en negativo un renglón, y quien lo
      // lee cree que el cliente pagó de más.
      movimientos.sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          (a.tipo === b.tipo ? 0 : a.tipo === "comprobante" ? -1 : 1),
      );
      let saldo = money.ZERO;
      for (const m of movimientos) {
        saldo = money.add(money.sub(saldo, dec(m.abono)), dec(m.cargo));
        m.saldo = txt2(saldo);
      }
      return { moneda, movimientos, saldoFinal: txt2(saldo) };
    })
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}

// ─── Proyección de cobranzas ──────────────────────────────────────────────

export type TramoProyeccion = {
  /** Etiqueta del tramo: «vencido», «esta semana», «2026-10»… */
  etiqueta: string;
  desde: string | null;
  hasta: string | null;
  /** Ya en soles, para poder sumarlo: cada documento con su tipo de cambio. */
  importe: string;
  documentos: number;
};

export type ProyeccionCobranzas = {
  tramos: TramoProyeccion[];
  detalle: {
    clienteId: string;
    cliente: string;
    tipo: "comprobante" | "letra";
    referencia: string;
    fechaVencimiento: string | null;
    moneda: string;
    saldo: string;
    saldoSoles: string;
    tramo: string;
    diasParaVencer: number | null;
  }[];
  totalSoles: string;
};

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Qué se espera cobrar y cuándo.
 *
 * Mira las facturas con saldo y las letras en cartera, que son las dos formas en
 * que un cliente puede deber: dejar las letras fuera daría una proyección
 * optimista justo en la empresa que más las usa.
 *
 * Los importes se llevan a soles con el tipo de cambio del documento. No es el
 * de la fecha de cobro —que nadie conoce— pero es el único que existe, y una
 * proyección con dos monedas mezcladas sin convertir no se puede sumar.
 *
 * Lo vencido va en su propio tramo y al principio: es lo que hay que perseguir
 * hoy, no lo que va a entrar.
 */
export async function proyeccionCobranzas(
  db: Db,
  hoy: string,
  opciones?: { semanas?: number },
): Promise<ProyeccionCobranzas> {
  const semanas = opciones?.semanas ?? 4;

  const facturas = (await db.execute(sql`
    SELECT c.id, c.cliente_id, t.razon_social AS cliente,
           c.serie, c.numero, c.fecha_vencimiento, c.moneda,
           c.tipo_cambio::text AS tipo_cambio,
           ${SALDO_POR_COBRAR}::text AS saldo
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03')
    ORDER BY c.fecha_vencimiento NULLS LAST`)) as unknown as {
    id: string;
    cliente_id: string;
    cliente: string;
    serie: string;
    numero: string;
    fecha_vencimiento: string | null;
    moneda: string;
    tipo_cambio: string;
    saldo: string;
  }[];

  const enCartera = await db
    .select({
      id: letras.id,
      clienteId: letras.terceroId,
      cliente: terceros.razonSocial,
      numero: letras.numero,
      fechaVencimiento: letras.fechaVencimiento,
      moneda: letras.moneda,
      saldo: letras.saldo,
    })
    .from(letras)
    .innerJoin(terceros, eq(terceros.id, letras.terceroId))
    .where(
      and(
        eq(letras.cartera, "cobrar"),
        sql`${letras.estado} IN ('girada', 'aceptada', 'en_cartera', 'descontada', 'protestada')`,
        sql`${letras.saldo} > 0`,
      ),
    )
    .orderBy(asc(letras.fechaVencimiento));

  // Los tramos: vencido, cada una de las próximas semanas, y todo lo demás.
  const tramos: TramoProyeccion[] = [
    { etiqueta: "vencido", desde: null, hasta: sumarDias(hoy, -1), importe: "0.00", documentos: 0 },
  ];
  for (let i = 0; i < semanas; i++) {
    const desde = sumarDias(hoy, i * 7);
    const hasta = sumarDias(hoy, i * 7 + 6);
    tramos.push({
      etiqueta: i === 0 ? "esta semana" : `en ${i + 1} semanas`,
      desde,
      hasta,
      importe: "0.00",
      documentos: 0,
    });
  }
  tramos.push({
    etiqueta: "más adelante",
    desde: sumarDias(hoy, semanas * 7),
    hasta: null,
    importe: "0.00",
    documentos: 0,
  });
  tramos.push({ etiqueta: "sin vencimiento", desde: null, hasta: null, importe: "0.00", documentos: 0 });

  const acumulado = new Map<string, Dec>(tramos.map((t) => [t.etiqueta, money.ZERO]));
  const cuenta = new Map<string, number>(tramos.map((t) => [t.etiqueta, 0]));

  const tramoDe = (vencimiento: string | null): string => {
    if (!vencimiento) return "sin vencimiento";
    if (vencimiento < hoy) return "vencido";
    const dias = diasEntre(hoy, vencimiento);
    const semana = Math.floor(dias / 7);
    if (semana >= semanas) return "más adelante";
    return semana === 0 ? "esta semana" : `en ${semana + 1} semanas`;
  };

  const detalle: ProyeccionCobranzas["detalle"] = [];
  let totalSoles = money.ZERO;

  const anotar = (
    clienteId: string,
    cliente: string,
    tipo: "comprobante" | "letra",
    referencia: string,
    vencimiento: string | null,
    moneda: string,
    saldo: Dec,
    tipoCambio: Dec,
  ) => {
    if (!money.gt(saldo, money.ZERO)) return;
    const enSoles = money.round(money.mul(saldo, tipoCambio), 2);
    const tramo = tramoDe(vencimiento);
    acumulado.set(tramo, money.add(acumulado.get(tramo) ?? money.ZERO, enSoles));
    cuenta.set(tramo, (cuenta.get(tramo) ?? 0) + 1);
    totalSoles = money.add(totalSoles, enSoles);
    detalle.push({
      clienteId,
      cliente,
      tipo,
      referencia,
      fechaVencimiento: vencimiento,
      moneda,
      saldo: txt2(saldo),
      saldoSoles: txt2(enSoles),
      tramo,
      diasParaVencer: vencimiento ? diasEntre(hoy, vencimiento) : null,
    });
  };

  for (const f of facturas) {
    anotar(
      f.cliente_id,
      f.cliente,
      "comprobante",
      `${f.serie}-${f.numero}`,
      f.fecha_vencimiento,
      f.moneda,
      dec(f.saldo),
      dec(f.tipo_cambio),
    );
  }
  for (const l of enCartera) {
    // Una letra en soles no lleva tipo de cambio propio; en dólares habría que
    // tomarlo del comprobante que la originó, y por ahora se usa 1 con moneda a
    // la vista para no inventar una conversión.
    anotar(
      l.clienteId,
      l.cliente,
      "letra",
      l.numero,
      l.fechaVencimiento,
      l.moneda,
      dec(l.saldo),
      money.dec("1"),
    );
  }

  detalle.sort((a, b) => (a.fechaVencimiento ?? "9999").localeCompare(b.fechaVencimiento ?? "9999"));

  return {
    tramos: tramos
      .map((t) => ({
        ...t,
        importe: txt2(acumulado.get(t.etiqueta) ?? money.ZERO),
        documentos: cuenta.get(t.etiqueta) ?? 0,
      }))
      .filter((t) => t.documentos > 0),
    detalle,
    totalSoles: txt2(totalSoles),
  };
}

// ─── Antigüedad de saldos y morosidad ─────────────────────────────────────

export type ClienteMoroso = {
  clienteId: string;
  cliente: string;
  documentoCliente: string;
  /** Todavía no vence. */
  porVencer: string;
  de1a30: string;
  de31a60: string;
  de61a90: string;
  mas90: string;
  total: string;
  vencido: string;
  /** Qué parte de lo que debe está vencida. */
  porcentajeVencido: string;
  /**
   * Días de atraso promedio, ponderados por importe.
   *
   * Sin ponderar, una factura de cien soles con doscientos días de atraso
   * pesaría lo mismo que una de cincuenta mil con diez, y el número diría lo
   * contrario de lo que pasa.
   */
  diasPromedioMora: string;
  documentoMasAntiguo: { referencia: string; vencimiento: string; dias: number } | null;
  /** Límite de crédito del cliente, si tiene uno puesto. */
  limite: string | null;
  excedeLimite: boolean;
  /** Letras suyas que fueron protestadas. */
  protestadas: number;
};

export type AntiguedadCartera = {
  fecha: string;
  clientes: ClienteMoroso[];
  totales: {
    porVencer: string;
    de1a30: string;
    de31a60: string;
    de61a90: string;
    mas90: string;
    total: string;
    vencido: string;
    porcentajeVencido: string;
  };
  avisos: string[];
};

/**
 * Antigüedad de saldos: cuánto debe cada cliente y desde cuándo.
 *
 * Es el informe con el que se decide a quién se le sigue vendiendo a crédito.
 * Mira las facturas con saldo **y las letras en cartera**, por la misma razón
 * que la proyección: dejar las letras fuera daría una cartera sana justo en la
 * empresa que más las usa.
 *
 * Dos cosas que no hace, a propósito:
 *
 * - **No puntúa al cliente.** Un número del uno al diez esconde en qué tramo
 *   está la deuda, y esa es toda la información. Lo que se entrega son los
 *   tramos, el porcentaje vencido y los días de atraso ponderados.
 * - **No reparte lo que no puede clasificar.** Un documento sin fecha de
 *   vencimiento no se mete en «por vencer» para que cuadre el total: se
 *   denuncia aparte. Meterlo ahí sería enseñar una cartera más sana de lo que es.
 */
export async function antiguedadCartera(
  db: Db,
  hoy: string,
  opciones?: { clienteId?: string },
): Promise<AntiguedadCartera> {
  const filtro = opciones?.clienteId ? sql`AND c.cliente_id = ${opciones.clienteId}` : sql``;
  const filtroLetra = opciones?.clienteId ? sql`AND l.tercero_id = ${opciones.clienteId}` : sql``;

  const filas = (await db.execute(sql`
    SELECT t.id AS cliente_id, t.razon_social AS cliente,
           t.numero_documento AS documento_cliente,
           t.limite_credito::text AS limite,
           'comprobante' AS clase,
           c.serie || '-' || c.numero AS referencia,
           -- Sin plazo pactado, la deuda es exigible desde que nace: se
           -- clasifica por la emisión. Dejar fuera lo que no trae vencimiento
           -- enseñaría una cartera más sana de lo que es, que es peor.
           coalesce(c.fecha_vencimiento, c.fecha_emision)::text AS vencimiento,
           c.fecha_vencimiento IS NULL AS sin_plazo,
           c.moneda, c.tipo_cambio::text AS tipo_cambio,
           ${SALDO_POR_COBRAR}::text AS saldo,
           false AS protestada
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    WHERE c.estado NOT IN ('anulado', 'rechazado')
      AND c.tipo_documento IN ('01', '03')
      AND ${SALDO_POR_COBRAR} > 0
      ${filtro}

    UNION ALL

    SELECT t.id, t.razon_social, t.numero_documento, t.limite_credito::text,
           'letra' AS clase,
           'Letra ' || l.numero AS referencia,
           l.fecha_vencimiento::text,
           false AS sin_plazo,
           l.moneda, '1' AS tipo_cambio,
           l.saldo::text,
           l.estado = 'protestada' AS protestada
    FROM letras l
    JOIN terceros t ON t.id = l.tercero_id
    WHERE l.cartera = 'cobrar'
      AND l.estado IN ('girada', 'aceptada', 'en_cartera', 'descontada', 'protestada')
      AND l.saldo > 0
      ${filtroLetra}`)) as unknown as {
    cliente_id: string;
    cliente: string;
    documento_cliente: string;
    limite: string | null;
    clase: string;
    referencia: string;
    vencimiento: string | null;
    sin_plazo: boolean;
    moneda: string;
    tipo_cambio: string;
    saldo: string;
    protestada: boolean;
  }[];

  const dias = (vencimiento: string): number =>
    Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${vencimiento}T00:00:00Z`)) / 86400000);

  type Acumulador = {
    datos: ClienteMoroso;
    /** Suma de importe × días, para el promedio ponderado. */
    ponderado: Dec;
  };
  const porCliente = new Map<string, Acumulador>();
  let sinVencimiento = money.ZERO;
  let documentosSinVencimiento = 0;
  let sinPlazo = 0;

  for (const f of filas) {
    // A soles con el tipo de cambio del documento: una cartera con dos monedas
    // sin convertir no se puede sumar ni ordenar.
    const saldo = money.round(money.mul(dec(f.saldo), dec(f.tipo_cambio)), 6);
    if (money.isZero(saldo)) continue;

    if (!f.vencimiento) {
      sinVencimiento = money.add(sinVencimiento, saldo);
      documentosSinVencimiento++;
      continue;
    }

    if (f.sin_plazo) sinPlazo++;

    let acc = porCliente.get(f.cliente_id);
    if (!acc) {
      acc = {
        ponderado: money.ZERO,
        datos: {
          clienteId: f.cliente_id,
          cliente: f.cliente,
          documentoCliente: f.documento_cliente,
          porVencer: "0", de1a30: "0", de31a60: "0", de61a90: "0", mas90: "0",
          total: "0", vencido: "0",
          porcentajeVencido: "0.00",
          diasPromedioMora: "0.0",
          documentoMasAntiguo: null,
          limite: f.limite,
          excedeLimite: false,
          protestadas: 0,
        },
      };
      porCliente.set(f.cliente_id, acc);
    }

    const atraso = dias(f.vencimiento);
    const d = acc.datos;
    const sumar = (campo: keyof ClienteMoroso) => {
      (d[campo] as string) = money.toString(money.add(dec(d[campo] as string), saldo), 6);
    };

    if (atraso <= 0) sumar("porVencer");
    else if (atraso <= 30) sumar("de1a30");
    else if (atraso <= 60) sumar("de31a60");
    else if (atraso <= 90) sumar("de61a90");
    else sumar("mas90");

    sumar("total");
    if (atraso > 0) {
      sumar("vencido");
      acc.ponderado = money.add(acc.ponderado, money.mul(saldo, money.dec(String(atraso))));
      if (!d.documentoMasAntiguo || atraso > d.documentoMasAntiguo.dias) {
        d.documentoMasAntiguo = { referencia: f.referencia, vencimiento: f.vencimiento, dias: atraso };
      }
    }
    if (f.protestada) d.protestadas++;
  }

  const totales = {
    porVencer: money.ZERO, de1a30: money.ZERO, de31a60: money.ZERO,
    de61a90: money.ZERO, mas90: money.ZERO, total: money.ZERO, vencido: money.ZERO,
  };

  const clientes = [...porCliente.values()].map(({ datos, ponderado }) => {
    const total = dec(datos.total);
    const vencido = dec(datos.vencido);
    for (const k of Object.keys(totales) as (keyof typeof totales)[]) {
      totales[k] = money.add(totales[k], dec(datos[k] as string));
    }
    const limite = datos.limite === null ? null : dec(datos.limite);
    return {
      ...datos,
      porVencer: txt2(dec(datos.porVencer)),
      de1a30: txt2(dec(datos.de1a30)),
      de31a60: txt2(dec(datos.de31a60)),
      de61a90: txt2(dec(datos.de61a90)),
      mas90: txt2(dec(datos.mas90)),
      total: txt2(total),
      vencido: txt2(vencido),
      porcentajeVencido: money.isZero(total)
        ? "0.00"
        : money.toString(
            money.round(money.mul(money.div(vencido, total), money.dec("100")), 2),
            2,
          ),
      diasPromedioMora: money.isZero(vencido)
        ? "0.0"
        : money.toString(money.round(money.div(ponderado, vencido), 1), 1),
      limite: limite === null ? null : txt2(limite),
      // Un límite en cero es «sin límite puesto», no «no puede deber nada».
      excedeLimite: limite !== null && !money.isZero(limite) && money.gt(total, limite),
    };
  });

  // De mayor deuda vencida a menor: es el orden en que se llama por teléfono.
  clientes.sort((a, b) => Number(b.vencido) - Number(a.vencido) || Number(b.total) - Number(a.total));

  const avisos: string[] = [];
  if (documentosSinVencimiento > 0) {
    avisos.push(
      `${documentosSinVencimiento} ${documentosSinVencimiento === 1 ? "documento" : "documentos"} ` +
        `por ${txt2(sinVencimiento)} sin fecha de vencimiento: no se pueden clasificar por antigüedad ` +
        `y quedan fuera de este cuadro.`,
    );
  }
  if (sinPlazo > 0) {
    avisos.push(
      `${sinPlazo} ${sinPlazo === 1 ? "documento no tiene" : "documentos no tienen"} plazo ` +
        `pactado: se clasifican por su fecha de emisión, porque una deuda sin plazo es exigible ` +
        `desde que nace.`,
    );
  }
  const protestadas = clientes.reduce((a, c) => a + c.protestadas, 0);
  if (protestadas > 0) {
    avisos.push(
      `${protestadas} ${protestadas === 1 ? "letra protestada" : "letras protestadas"} en la cartera: ` +
        `siguen contando como deuda, pero ya fueron impagadas una vez.`,
    );
  }
  const excedidos = clientes.filter((c) => c.excedeLimite).length;
  if (excedidos > 0) {
    avisos.push(
      `${excedidos} ${excedidos === 1 ? "cliente debe" : "clientes deben"} más que su límite de crédito.`,
    );
  }

  return {
    fecha: hoy,
    clientes,
    totales: {
      porVencer: txt2(totales.porVencer),
      de1a30: txt2(totales.de1a30),
      de31a60: txt2(totales.de31a60),
      de61a90: txt2(totales.de61a90),
      mas90: txt2(totales.mas90),
      total: txt2(totales.total),
      vencido: txt2(totales.vencido),
      porcentajeVencido: money.isZero(totales.total)
        ? "0.00"
        : money.toString(
            money.round(
              money.mul(money.div(totales.vencido, totales.total), money.dec("100")),
              2,
            ),
            2,
          ),
    },
    avisos,
  };
}
