/**
 * Caja y bancos: los tres papeles que faltaban.
 *
 * - El **recibo** es lo que se firma. Envuelve un movimiento de caja para que
 *   quien entrega o recibe el dinero se lleve un documento numerado; sin él la
 *   caja no tiene cómo demostrar qué salió.
 *
 * - El **cheque** es dinero comprometido que el saldo del banco todavía no
 *   refleja. Girarlo y cobrarlo son dos hechos distintos, y entre uno y otro
 *   hay días: la «situación de cheques» es esa lista.
 *
 * - La **entrega a rendir** es un activo, no un gasto. Sale de caja a nombre de
 *   alguien y vuelve como documentos; hasta entonces vive en la cuenta 14.
 *   Tratarla como gasto el día que sale es lo que hace aparecer el gasto del mes
 *   en el mes equivocado.
 *
 * Lo que ya existía —el movimiento de efectivo y su asiento— no se duplica: los
 * tres documentos lo reutilizan.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { siguienteNumero } from "./correlativos.ts";
import { asentar, exigirPeriodoAbierto, type LineaAsientoEntrada } from "./contabilidad.ts";
import { registrarMovimientoEfectivo, anotarMovimientoDeOtroModulo } from "./tesoreria.ts";
import { enLetras } from "./ventas.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  recibos, cheques, entregasRendir, rendicionItems,
  cuentasEfectivo, terceros, pagos,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class CajaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "CajaInvalida");
  }
}

async function exigirCuenta(db: Db, cuentaId: string) {
  const [c] = await db
    .select()
    .from(cuentasEfectivo)
    .where(eq(cuentasEfectivo.id, cuentaId))
    .limit(1);
  if (!c) throw new CajaInvalida(["la cuenta no existe en esta empresa"]);
  if (!c.activa) throw new CajaInvalida([`la cuenta ${c.nombre} está inactiva`]);
  return c;
}

// ─── Recibos ──────────────────────────────────────────────────────────────

export type DatosRecibo = {
  tipo: "ingreso" | "egreso";
  fecha: string;
  cuentaId: string;
  concepto: string;
  importe: string;
  /** Contrapartida contable: 759 otros ingresos, 6391 gastos varios… */
  cuentaContrapartida: string;
  terceroId?: string;
  aNombreDe?: string;
  centroCostoId?: string;
  referencia?: string;
};

export type ReciboEmitido = {
  reciboId: string;
  numero: string;
  movimientoId: string;
  asientoId: string;
};

/**
 * Emite un recibo y mueve la caja.
 *
 * El movimiento y el asiento son los de siempre: el recibo sólo les pone número
 * y beneficiario. Todo en la transacción de quien llama, porque un recibo
 * numerado sin su movimiento es un papel que miente.
 */
export async function emitirRecibo(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosRecibo,
): Promise<ReciboEmitido> {
  const motivos: string[] = [];
  if (!money.gt(dec(datos.importe), money.ZERO)) motivos.push("el importe debe ser mayor que cero");
  if (!datos.concepto.trim()) motivos.push("indique el concepto del recibo");
  if (!datos.terceroId && !datos.aNombreDe?.trim()) {
    motivos.push(
      datos.tipo === "egreso"
        ? "indique a nombre de quién se emite el recibo"
        : "indique de quién se recibe el dinero",
    );
  }
  if (motivos.length) throw new CajaInvalida(motivos);

  const cuenta = await exigirCuenta(db, datos.cuentaId);
  await exigirPeriodoAbierto(db, datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7));

  const mov = await registrarMovimientoEfectivo(db, empresaId, usuarioId, {
    cuentaId: datos.cuentaId,
    fecha: datos.fecha,
    sentido: datos.tipo,
    concepto: datos.concepto,
    importe: datos.importe,
    cuentaContrapartida: datos.cuentaContrapartida,
    ...(datos.terceroId ? { terceroId: datos.terceroId } : {}),
    ...(datos.centroCostoId ? { centroCostoId: datos.centroCostoId } : {}),
    ...(datos.referencia ? { referencia: datos.referencia } : {}),
  });

  const prefijo = datos.tipo === "ingreso" ? "RI" : "RE";
  const numero = await siguienteNumero(
    db, recibos, recibos.numero, prefijo, datos.fecha.slice(0, 4),
  );

  const [cab] = await db
    .insert(recibos)
    .values({
      empresaId,
      numero,
      tipo: datos.tipo,
      fecha: datos.fecha,
      cuentaId: datos.cuentaId,
      terceroId: datos.terceroId ?? null,
      aNombreDe: datos.aNombreDe ?? null,
      concepto: datos.concepto,
      importe: txt2(dec(datos.importe)),
      moneda: cuenta.moneda,
      // El importe en letras es lo que hace difícil alterar un recibo firmado.
      importeEnLetras: enLetras(dec(datos.importe), cuenta.moneda),
      movimientoId: mov.movimientoId,
      asientoId: mov.asientoId,
      creadoPor: usuarioId,
    })
    .returning({ id: recibos.id });

  return {
    reciboId: cab!.id,
    numero,
    movimientoId: mov.movimientoId,
    asientoId: mov.asientoId,
  };
}

export const listarRecibos = (db: Db, filtro?: { tipo?: string; desde?: string; hasta?: string }) => {
  const cond = [sql`true`];
  if (filtro?.tipo) cond.push(eq(recibos.tipo, filtro.tipo));
  if (filtro?.desde) cond.push(sql`${recibos.fecha} >= ${filtro.desde}`);
  if (filtro?.hasta) cond.push(sql`${recibos.fecha} <= ${filtro.hasta}`);
  return db
    .select({
      id: recibos.id,
      numero: recibos.numero,
      tipo: recibos.tipo,
      fecha: recibos.fecha,
      cuenta: cuentasEfectivo.nombre,
      tercero: terceros.razonSocial,
      aNombreDe: recibos.aNombreDe,
      concepto: recibos.concepto,
      importe: recibos.importe,
      moneda: recibos.moneda,
      estado: recibos.estado,
    })
    .from(recibos)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, recibos.cuentaId))
    .leftJoin(terceros, eq(terceros.id, recibos.terceroId))
    .where(and(...cond))
    .orderBy(desc(recibos.fecha), desc(recibos.numero))
    .limit(300);
};

export async function cargarRecibo(db: Db, reciboId: string) {
  const [fila] = await db
    .select({
      id: recibos.id,
      numero: recibos.numero,
      tipo: recibos.tipo,
      fecha: recibos.fecha,
      cuenta: cuentasEfectivo.nombre,
      cuentaContable: cuentasEfectivo.cuentaContable,
      tercero: terceros.razonSocial,
      documentoTercero: terceros.numeroDocumento,
      aNombreDe: recibos.aNombreDe,
      concepto: recibos.concepto,
      importe: recibos.importe,
      importeEnLetras: recibos.importeEnLetras,
      moneda: recibos.moneda,
      estado: recibos.estado,
      asientoId: recibos.asientoId,
    })
    .from(recibos)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, recibos.cuentaId))
    .leftJoin(terceros, eq(terceros.id, recibos.terceroId))
    .where(eq(recibos.id, reciboId))
    .limit(1);
  if (!fila) throw new CajaInvalida(["el recibo no existe"]);
  return fila;
}

// ─── Cheques ──────────────────────────────────────────────────────────────

export const ESTADO_CHEQUE = {
  /** Cartera emitida. */
  GIRADO: "girado",
  ENTREGADO: "entregado",
  COBRADO: "cobrado",
  ANULADO: "anulado",
  /** Cartera recibida. */
  RECIBIDO: "recibido",
  DEPOSITADO: "depositado",
  REBOTADO: "rebotado",
} as const;

export type DatosCheque = {
  cuentaId: string;
  numero: string;
  fechaGiro: string;
  /** Posterior a la de giro en un cheque diferido. */
  fechaCobro?: string;
  beneficiarioId?: string;
  beneficiario?: string;
  importe: string;
  pagoId?: string;
  observaciones?: string;
};

/**
 * Registra un cheque girado.
 *
 * No mueve dinero: el movimiento de caja lo hace el pago que lo originó, o el
 * cobro cuando el banco lo carga. Girar un cheque y descontarlo del saldo el
 * mismo día es lo que hace que el libro de bancos nunca cuadre contra el
 * extracto.
 */
export async function girarCheque(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosCheque,
): Promise<string> {
  const motivos: string[] = [];
  if (!datos.numero.trim()) motivos.push("indique el número del cheque");
  if (!money.gt(dec(datos.importe), money.ZERO)) motivos.push("el importe debe ser mayor que cero");
  if (datos.fechaCobro && datos.fechaCobro < datos.fechaGiro) {
    motivos.push("la fecha de cobro no puede ser anterior a la de giro");
  }
  if (motivos.length) throw new CajaInvalida(motivos);

  const cuenta = await exigirCuenta(db, datos.cuentaId);

  let beneficiario = datos.beneficiario?.trim() ?? "";
  if (datos.beneficiarioId) {
    const [t] = await db
      .select({ razonSocial: terceros.razonSocial })
      .from(terceros)
      .where(eq(terceros.id, datos.beneficiarioId))
      .limit(1);
    if (!t) throw new CajaInvalida(["el beneficiario no existe en esta empresa"]);
    beneficiario = beneficiario || t.razonSocial;
  }
  if (!beneficiario) throw new CajaInvalida(["indique a nombre de quién va el cheque"]);

  const [fila] = await db
    .insert(cheques)
    .values({
      empresaId,
      cartera: "emitido",
      cuentaId: datos.cuentaId,
      numero: datos.numero.trim(),
      fechaGiro: datos.fechaGiro,
      fechaCobro: datos.fechaCobro ?? null,
      beneficiarioId: datos.beneficiarioId ?? null,
      beneficiario,
      importe: txt2(dec(datos.importe)),
      moneda: cuenta.moneda,
      pagoId: datos.pagoId ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: cheques.id });
  return fila!.id;
}

/**
 * Avanza el estado de un cheque.
 *
 * girado → entregado → cobrado, y desde girado o entregado se puede anular.
 * Un cheque cobrado ya no se toca: el banco lo cargó y está en el extracto.
 */
export async function cambiarEstadoCheque(
  db: Db,
  chequeId: string,
  nuevo: string,
  extra?: { fechaCobrado?: string; observaciones?: string; motivoRechazo?: string },
): Promise<void> {
  const [c] = await db.select().from(cheques).where(eq(cheques.id, chequeId)).limit(1);
  if (!c) throw new CajaInvalida(["el cheque no existe"]);

  /*
   * Cada cartera tiene su propio recorrido.
   *
   * El nuestro termina cuando el banco carga el cheque. El del cliente puede
   * terminar mal: un cheque rebotado vuelve a ser deuda, y por eso «rebotado»
   * es un estado y no una observación.
   */
  const permitidos: Record<string, Record<string, string[]>> = {
    emitido: {
      girado: ["entregado", "cobrado", "anulado"],
      entregado: ["cobrado", "anulado"],
      cobrado: [],
      anulado: [],
    },
    recibido: {
      recibido: ["depositado", "rebotado", "anulado"],
      depositado: ["cobrado", "rebotado"],
      cobrado: [],
      rebotado: [],
      anulado: [],
    },
  };
  if (!permitidos[c.cartera]?.[c.estado]?.includes(nuevo)) {
    throw new CajaInvalida([`un cheque ${c.estado} no pasa a ${nuevo}`]);
  }
  if (nuevo === "cobrado" && !extra?.fechaCobrado) {
    throw new CajaInvalida(["indique la fecha en que el banco cargó el cheque"]);
  }
  if (nuevo === "rebotado" && !extra?.motivoRechazo?.trim()) {
    throw new CajaInvalida(["indique por qué el banco devolvió el cheque"]);
  }

  await db
    .update(cheques)
    .set({
      estado: nuevo,
      ...(extra?.fechaCobrado ? { fechaCobrado: extra.fechaCobrado } : {}),
      ...(extra?.observaciones ? { observaciones: extra.observaciones } : {}),
      ...(extra?.motivoRechazo ? { motivoRechazo: extra.motivoRechazo.trim() } : {}),
    })
    .where(eq(cheques.id, chequeId));
}

export type SituacionCheques = {
  cheques: {
    id: string;
    numero: string;
    cuenta: string;
    fechaGiro: string;
    fechaCobro: string | null;
    beneficiario: string;
    importe: string;
    moneda: string;
    estado: string;
    fechaCobrado: string | null;
    motivoRechazo: string | null;
    bancoGirador: string | null;
    /** Todavía no puede presentarse: se giró con fecha futura. */
    diferido: boolean;
    /** Girado hace más de 30 días y sin cobrar. */
    aniejo: boolean;
  }[];
  /** Comprometido y no cobrado, por moneda: el saldo del banco no lo refleja. */
  enCirculacion: { moneda: string; importe: string }[];
};

/**
 * La situación de cheques de Starsoft.
 *
 * Lo que interesa de esta lista no es el histórico sino lo que sigue en el
 * aire: cheques girados que nadie ha cobrado. Ese dinero está comprometido y el
 * saldo del banco todavía no lo descuenta, así que quien mira sólo el saldo cree
 * tener más de lo que tiene.
 */
export async function situacionCheques(
  db: Db,
  hoy: string,
  filtro?: { estado?: string; cuentaId?: string; cartera?: string },
): Promise<SituacionCheques> {
  const cond = [eq(cheques.cartera, filtro?.cartera ?? "emitido")];
  if (filtro?.estado) cond.push(eq(cheques.estado, filtro.estado));
  if (filtro?.cuentaId) cond.push(eq(cheques.cuentaId, filtro.cuentaId));

  const filas = await db
    .select({
      id: cheques.id,
      numero: cheques.numero,
      cuenta: cuentasEfectivo.nombre,
      fechaGiro: cheques.fechaGiro,
      fechaCobro: cheques.fechaCobro,
      beneficiario: cheques.beneficiario,
      importe: cheques.importe,
      moneda: cheques.moneda,
      estado: cheques.estado,
      fechaCobrado: cheques.fechaCobrado,
      motivoRechazo: cheques.motivoRechazo,
      bancoGirador: cheques.bancoGirador,
    })
    .from(cheques)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, cheques.cuentaId))
    .where(and(...cond))
    .orderBy(desc(cheques.fechaGiro), desc(cheques.numero))
    .limit(500);

  const treintaDias = new Date(`${hoy}T00:00:00Z`);
  treintaDias.setUTCDate(treintaDias.getUTCDate() - 30);
  const limite = treintaDias.toISOString().slice(0, 10);

  const detalle = filas.map((f) => ({
    ...f,
    diferido: f.fechaCobro !== null && f.fechaCobro > hoy,
    aniejo:
      f.estado !== "cobrado" &&
      f.estado !== "anulado" &&
      f.estado !== "rebotado" &&
      f.fechaGiro < limite,
  }));

  const porMoneda = new Map<string, Dec>();
  for (const f of detalle) {
    if (f.estado === "cobrado" || f.estado === "anulado" || f.estado === "rebotado") continue;
    porMoneda.set(f.moneda, money.add(porMoneda.get(f.moneda) ?? money.ZERO, dec(f.importe)));
  }

  return {
    cheques: detalle,
    enCirculacion: [...porMoneda].map(([moneda, importe]) => ({ moneda, importe: txt2(importe) })),
  };
}

export type DatosChequeRecibido = {
  /** Cuenta donde se va a depositar. */
  cuentaId: string;
  numero: string;
  fechaGiro: string;
  /** Diferido: no se deposita antes de esta fecha. */
  fechaCobro?: string;
  clienteId?: string;
  girador?: string;
  bancoGirador?: string;
  importe: string;
  cobranzaId?: string;
  observaciones?: string;
};

/**
 * Registra un cheque que entrega un cliente.
 *
 * No es dinero todavía: es una promesa de dinero con nombre de banco. Tratarlo
 * como cobrado el día que llega es lo que hace que un rebote aparezca como una
 * sorpresa contable semanas después, cuando la factura ya figuraba pagada.
 */
export async function recibirCheque(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosChequeRecibido,
): Promise<string> {
  const motivos: string[] = [];
  if (!datos.numero.trim()) motivos.push("indique el número del cheque");
  if (!money.gt(dec(datos.importe), money.ZERO)) motivos.push("el importe debe ser mayor que cero");
  if (datos.fechaCobro && datos.fechaCobro < datos.fechaGiro) {
    motivos.push("la fecha de cobro no puede ser anterior a la de giro");
  }
  if (motivos.length) throw new CajaInvalida(motivos);

  const cuenta = await exigirCuenta(db, datos.cuentaId);

  let girador = datos.girador?.trim() ?? "";
  if (datos.clienteId) {
    const [t] = await db
      .select({ razonSocial: terceros.razonSocial })
      .from(terceros)
      .where(eq(terceros.id, datos.clienteId))
      .limit(1);
    if (!t) throw new CajaInvalida(["el cliente no existe en esta empresa"]);
    girador = girador || t.razonSocial;
  }
  if (!girador) throw new CajaInvalida(["indique quién gira el cheque"]);

  const [fila] = await db
    .insert(cheques)
    .values({
      empresaId,
      cartera: "recibido",
      cuentaId: datos.cuentaId,
      numero: datos.numero.trim(),
      fechaGiro: datos.fechaGiro,
      fechaCobro: datos.fechaCobro ?? null,
      beneficiarioId: datos.clienteId ?? null,
      beneficiario: girador,
      bancoGirador: datos.bancoGirador ?? null,
      importe: txt2(dec(datos.importe)),
      moneda: cuenta.moneda,
      estado: "recibido",
      cobranzaId: datos.cobranzaId ?? null,
      observaciones: datos.observaciones ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: cheques.id });
  return fila!.id;
}

/** Cheque con los documentos que cancela: el cheque-voucher de Starsoft. */
export async function chequeVoucher(db: Db, chequeId: string) {
  const [cheque] = await db
    .select({
      id: cheques.id,
      numero: cheques.numero,
      cuenta: cuentasEfectivo.nombre,
      cuentaContable: cuentasEfectivo.cuentaContable,
      banco: cuentasEfectivo.banco,
      numeroCuenta: cuentasEfectivo.numeroCuenta,
      fechaGiro: cheques.fechaGiro,
      fechaCobro: cheques.fechaCobro,
      beneficiario: cheques.beneficiario,
      beneficiarioId: cheques.beneficiarioId,
      importe: cheques.importe,
      moneda: cheques.moneda,
      estado: cheques.estado,
      observaciones: cheques.observaciones,
      pagoId: cheques.pagoId,
    })
    .from(cheques)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, cheques.cuentaId))
    .where(eq(cheques.id, chequeId))
    .limit(1);
  if (!cheque) throw new CajaInvalida(["el cheque no existe"]);

  // Los documentos que paga. Es lo que convierte un cheque en un voucher:
  // quien firma tiene que ver qué se está cancelando, no sólo cuánto.
  const documentos = cheque.pagoId
    ? await db
        .select({
          tipoDocumento: s.documentosCxp.tipoDocumento,
          serie: s.documentosCxp.serie,
          numero: s.documentosCxp.numero,
          fechaEmision: s.documentosCxp.fechaEmision,
          total: s.documentosCxp.total,
          aplicado: s.pagoAplicaciones.importeAplicado,
          moneda: s.documentosCxp.moneda,
        })
        .from(s.pagoAplicaciones)
        .innerJoin(s.documentosCxp, eq(s.documentosCxp.id, s.pagoAplicaciones.documentoId))
        .where(eq(s.pagoAplicaciones.pagoId, cheque.pagoId))
        .orderBy(asc(s.documentosCxp.fechaEmision))
    : [];

  const [pago] = cheque.pagoId
    ? await db
        .select({ numero: pagos.numero, referencia: pagos.referencia })
        .from(pagos)
        .where(eq(pagos.id, cheque.pagoId))
        .limit(1)
    : [];

  return {
    cheque,
    pago,
    documentos,
    importeEnLetras: enLetras(dec(cheque.importe), cheque.moneda),
  };
}

// ─── Entregas a rendir ────────────────────────────────────────────────────

export type DatosEntrega = {
  fecha: string;
  cuentaId: string;
  responsable: string;
  responsableId?: string;
  motivo: string;
  importe: string;
  centroCostoId?: string;
  /** Cuenta del activo. Por defecto 1412, entregas a rendir al personal. */
  cuentaActivo?: string;
};

/**
 * Entrega dinero a rendir.
 *
 * El asiento carga la cuenta 14 y abona la caja: es un activo, no un gasto.
 * El gasto aparece cuando se rinde, con la fecha del documento que lo sustenta,
 * que puede ser de otro mes.
 */
export async function entregarARendir(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosEntrega,
): Promise<{ entregaId: string; numero: string; asientoId: string }> {
  const motivos: string[] = [];
  if (!money.gt(dec(datos.importe), money.ZERO)) motivos.push("el importe debe ser mayor que cero");
  if (!datos.responsable.trim()) motivos.push("indique a quién se le entrega");
  if (!datos.motivo.trim()) motivos.push("indique el motivo de la entrega");
  if (motivos.length) throw new CajaInvalida(motivos);

  const cuenta = await exigirCuenta(db, datos.cuentaId);
  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  await exigirPeriodoAbierto(db, periodo);

  const numero = await siguienteNumero(
    db, entregasRendir, entregasRendir.numero, "ER", datos.fecha.slice(0, 4),
  );
  const cuentaActivo = datos.cuentaActivo ?? "1412";

  const [cab] = await db
    .insert(entregasRendir)
    .values({
      empresaId,
      numero,
      fecha: datos.fecha,
      cuentaId: datos.cuentaId,
      responsableId: datos.responsableId ?? null,
      responsable: datos.responsable.trim(),
      motivo: datos.motivo.trim(),
      importe: txt2(dec(datos.importe)),
      moneda: cuenta.moneda,
      centroCostoId: datos.centroCostoId ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: entregasRendir.id });
  const entregaId = cab!.id;

  const glosa = `Entrega a rendir ${numero} · ${datos.responsable}`;
  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa,
    moneda: cuenta.moneda,
    tipoCambio: "1",
    origenModulo: "caja",
    origenId: entregaId,
    lineas: [
      { cuenta: cuentaActivo, glosa, debe: txt2(dec(datos.importe)) },
      { cuenta: cuenta.cuentaContable, glosa, haber: txt2(dec(datos.importe)) },
    ],
  });

  // El dinero sale de la caja de verdad, así que la tesorería tiene que verlo.
  // El asiento ya se hizo aquí: por eso se anota y no se vuelve a contabilizar.
  const movimientoId = await anotarMovimientoDeOtroModulo(db, empresaId, usuarioId, {
    cuentaId: datos.cuentaId,
    fecha: datos.fecha,
    sentido: "egreso",
    concepto: glosa,
    importe: txt2(dec(datos.importe)),
    origenModulo: "caja",
    origenId: entregaId,
    asientoId,
    ...(datos.responsableId ? { terceroId: datos.responsableId } : {}),
  });

  await db
    .update(entregasRendir)
    .set({ asientoId, movimientoId })
    .where(eq(entregasRendir.id, entregaId));

  return { entregaId, numero, asientoId };
}

export type LineaRendicion = {
  fecha: string;
  concepto: string;
  cuenta: string;
  importe: string;
  tipoDocumento?: string;
  serie?: string;
  numero?: string;
  proveedorId?: string;
  centroCostoId?: string;
  igv?: string;
};

/**
 * Rinde una entrega con sus documentos.
 *
 * Cada documento va a su cuenta de gasto y descarga la cuenta 14. Lo que sobra
 * se devuelve a caja en el mismo asiento; lo que falta queda como saldo a favor
 * del responsable, que la empresa le reembolsará.
 *
 * No se admite rendir más de lo entregado sin devolución: si el responsable
 * gastó de su bolsillo, eso es un reembolso aparte y no una rendición, porque
 * el dinero que se justifica aquí es el que salió de esta caja.
 */
export async function rendirEntrega(
  db: Db,
  empresaId: string,
  usuarioId: string,
  entregaId: string,
  datos: { fecha: string; lineas: LineaRendicion[]; devuelve?: string },
): Promise<{ asientoId: string; rendido: string; devuelto: string; saldo: string }> {
  const [e] = await db
    .select()
    .from(entregasRendir)
    .where(eq(entregasRendir.id, entregaId))
    .limit(1);
  if (!e) throw new CajaInvalida(["la entrega no existe"]);
  if (e.estado === "rendida") throw new CajaInvalida(["la entrega ya está rendida"]);
  if (e.estado === "anulada") throw new CajaInvalida(["la entrega está anulada"]);
  if (datos.lineas.length === 0 && !datos.devuelve) {
    throw new CajaInvalida(["agregue al menos un documento o indique cuánto se devuelve"]);
  }

  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  await exigirPeriodoAbierto(db, periodo);

  const gastado = datos.lineas.reduce<Dec>((a, l) => money.add(a, dec(l.importe)), money.ZERO);
  const devuelto = dec(datos.devuelve ?? "0");
  const pendiente = money.sub(money.sub(dec(e.importe), dec(e.rendido)), dec(e.devuelto));

  if (money.gt(money.add(gastado, devuelto), pendiente)) {
    throw new CajaInvalida([
      `sólo quedan ${txt2(pendiente)} por rendir y se están justificando ${txt2(money.add(gastado, devuelto))}`,
    ]);
  }

  const cuenta = await exigirCuenta(db, e.cuentaId);
  const cuentaActivo = "1412";
  const glosa = `Rendición de ${e.numero} · ${e.responsable}`;

  const lineasAsiento: LineaAsientoEntrada[] = datos.lineas.map((l) => ({
    cuenta: l.cuenta,
    glosa: l.concepto,
    debe: txt2(dec(l.importe)),
    ...(l.proveedorId ? { anexoId: l.proveedorId } : {}),
    ...(l.centroCostoId ?? e.centroCostoId
      ? { centroCostoId: (l.centroCostoId ?? e.centroCostoId)! }
      : {}),
  }));

  if (money.gt(devuelto, money.ZERO)) {
    lineasAsiento.push({ cuenta: cuenta.cuentaContable, glosa: `${glosa} · vuelto`, debe: txt2(devuelto) });
  }
  lineasAsiento.push({
    cuenta: cuentaActivo,
    glosa,
    haber: txt2(money.add(gastado, devuelto)),
  });

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa,
    moneda: e.moneda,
    tipoCambio: "1",
    origenModulo: "caja",
    origenId: entregaId,
    lineas: lineasAsiento,
  });

  if (datos.lineas.length > 0) {
    await db.insert(rendicionItems).values(
      datos.lineas.map((l) => ({
        empresaId,
        entregaId,
        fecha: l.fecha,
        tipoDocumento: l.tipoDocumento ?? null,
        serie: l.serie ?? null,
        numero: l.numero ?? null,
        proveedorId: l.proveedorId ?? null,
        concepto: l.concepto,
        cuenta: l.cuenta,
        centroCostoId: l.centroCostoId ?? e.centroCostoId,
        importe: txt2(dec(l.importe)),
        igv: txt2(dec(l.igv)),
      })),
    );
  }

  if (money.gt(devuelto, money.ZERO)) {
    await anotarMovimientoDeOtroModulo(db, empresaId, usuarioId, {
      cuentaId: e.cuentaId,
      fecha: datos.fecha,
      sentido: "ingreso",
      concepto: `${glosa} · vuelto`,
      importe: txt2(devuelto),
      origenModulo: "caja",
      origenId: entregaId,
      asientoId,
      ...(e.responsableId ? { terceroId: e.responsableId } : {}),
    });
  }

  const rendidoTotal = money.add(dec(e.rendido), gastado);
  const devueltoTotal = money.add(dec(e.devuelto), devuelto);
  const saldo = money.sub(money.sub(dec(e.importe), rendidoTotal), devueltoTotal);

  await db
    .update(entregasRendir)
    .set({
      rendido: txt2(rendidoTotal),
      devuelto: txt2(devueltoTotal),
      estado: money.isZero(saldo) ? "rendida" : "parcial",
    })
    .where(eq(entregasRendir.id, entregaId));

  return {
    asientoId,
    rendido: txt2(rendidoTotal),
    devuelto: txt2(devueltoTotal),
    saldo: txt2(saldo),
  };
}

export const listarEntregas = (db: Db, estado?: string) =>
  db
    .select({
      id: entregasRendir.id,
      numero: entregasRendir.numero,
      fecha: entregasRendir.fecha,
      responsable: entregasRendir.responsable,
      motivo: entregasRendir.motivo,
      cuenta: cuentasEfectivo.nombre,
      importe: entregasRendir.importe,
      rendido: entregasRendir.rendido,
      devuelto: entregasRendir.devuelto,
      moneda: entregasRendir.moneda,
      estado: entregasRendir.estado,
    })
    .from(entregasRendir)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, entregasRendir.cuentaId))
    .where(estado ? eq(entregasRendir.estado, estado) : sql`true`)
    .orderBy(desc(entregasRendir.fecha), desc(entregasRendir.numero))
    .limit(300);

export async function cargarEntrega(db: Db, entregaId: string) {
  const [cabecera] = await db
    .select({
      id: entregasRendir.id,
      numero: entregasRendir.numero,
      fecha: entregasRendir.fecha,
      cuentaId: entregasRendir.cuentaId,
      cuenta: cuentasEfectivo.nombre,
      responsable: entregasRendir.responsable,
      motivo: entregasRendir.motivo,
      importe: entregasRendir.importe,
      rendido: entregasRendir.rendido,
      devuelto: entregasRendir.devuelto,
      moneda: entregasRendir.moneda,
      estado: entregasRendir.estado,
      centroCostoId: entregasRendir.centroCostoId,
    })
    .from(entregasRendir)
    .innerJoin(cuentasEfectivo, eq(cuentasEfectivo.id, entregasRendir.cuentaId))
    .where(eq(entregasRendir.id, entregaId))
    .limit(1);
  if (!cabecera) throw new CajaInvalida(["la entrega no existe"]);

  const items = await db
    .select()
    .from(rendicionItems)
    .where(eq(rendicionItems.entregaId, entregaId))
    .orderBy(asc(rendicionItems.fecha));

  const saldo = money.sub(
    money.sub(dec(cabecera.importe), dec(cabecera.rendido)),
    dec(cabecera.devuelto),
  );

  return { cabecera, items, saldo: txt2(saldo) };
}

export async function anularEntrega(db: Db, entregaId: string): Promise<void> {
  const [e] = await db
    .select({ estado: entregasRendir.estado, rendido: entregasRendir.rendido })
    .from(entregasRendir)
    .where(eq(entregasRendir.id, entregaId))
    .limit(1);
  if (!e) throw new CajaInvalida(["la entrega no existe"]);
  if (!money.isZero(dec(e.rendido))) {
    throw new CajaInvalida(["la entrega ya tiene rendiciones: extorne el asiento en su lugar"]);
  }
  await db
    .update(entregasRendir)
    .set({ estado: "anulada" })
    .where(eq(entregasRendir.id, entregaId));
}
