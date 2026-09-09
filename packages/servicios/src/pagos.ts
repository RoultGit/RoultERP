/**
 * Pagos a proveedores y letras.
 *
 * Un pago es un acto que toca tres cosas a la vez: sale dinero del banco, baja
 * el saldo de uno o varios documentos, y se contabiliza. Las tres viven en la
 * misma transacción; un pago que descargó el banco sin bajar la deuda deja al
 * proveedor cobrando dos veces.
 *
 * Dos particularidades peruanas que este archivo resuelve:
 *
 * - **Retención del IGV.** Si la empresa es agente de retención, al pagar
 *   retiene el 3 % y se lo entrega al fisco. El proveedor recibe el neto, pero
 *   su deuda se cancela por el bruto: la retención es dinero suyo que la
 *   empresa paga en su nombre.
 *
 * - **Diferencia de cambio.** Una factura en dólares de hace dos meses se paga
 *   al tipo de hoy. La diferencia no es un descuadre: es una ganancia o una
 *   pérdida que va a la 776 o a la 676, y hay que reconocerla al cancelar.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { money, tributario, contabilidad } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { asentar, type LineaAsientoEntrada } from "./contabilidad.ts";

const { documentosCxp, pagos, pagoAplicaciones, terceros, letras, letraDocumentos, empresas } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);
const txt = (v: Dec, d = 6): string => money.toString(v, d);

export class PagoInvalido extends Error {
  constructor(readonly motivos: readonly string[]) {
    super(motivos.join("; "));
    this.name = "PagoInvalido";
  }
}

export type AplicacionPago = {
  documentoId: string;
  /** Importe a aplicar, en la moneda del documento. */
  importe: string;
};

export type DatosPago = {
  numero: string;
  proveedorId: string;
  fecha: string;
  moneda: string;
  tipoCambio: string;
  /** efectivo, transferencia, cheque, letra */
  medioPago: string;
  /** Cuenta contable de donde sale el dinero: 1041 banco, 1011 caja… */
  cuentaOrigen: string;
  aplicaciones: AplicacionPago[];
  /** Retener el IGV. Sólo si la empresa es agente de retención. */
  retenerIgv?: boolean;
  referencia?: string;
};

export type PagoRegistrado = {
  pagoId: string;
  asientoId: string;
  importeBruto: string;
  retencion: string;
  importeNeto: string;
  diferenciaCambio: string;
  documentosCancelados: number;
};

/**
 * Registra un pago y lo aplica a los documentos indicados.
 *
 * El importe de cada aplicación se valida contra el saldo del documento en el
 * momento, con la fila bloqueada: dos pagos simultáneos sobre la misma factura
 * no pueden dejarla con saldo negativo.
 */
export async function registrarPago(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosPago,
): Promise<PagoRegistrado> {
  const motivos: string[] = [];
  if (datos.aplicaciones.length === 0) motivos.push("indique a qué documentos se aplica el pago");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) motivos.push("la fecha del pago es inválida");
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) motivos.push("el tipo de cambio debe ser positivo");
  if (motivos.length) throw new PagoInvalido(motivos);

  const [proveedor] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, datos.proveedorId))
    .limit(1);
  if (!proveedor) throw new PagoInvalido(["el proveedor no existe en esta empresa"]);

  const [empresa] = await db
    .select({ esAgenteRetencion: empresas.esAgenteRetencion })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);

  // Se bloquean los documentos antes de mirar sus saldos. Sin el bloqueo, dos
  // pagos simultáneos leerían el mismo saldo y ambos cabrían dentro de él.
  const ids = datos.aplicaciones.map((a) => a.documentoId);
  const docs = await db
    .select()
    .from(documentosCxp)
    .where(inArray(documentosCxp.id, ids))
    .for("update");

  if (docs.length !== ids.length) {
    throw new PagoInvalido(["alguno de los documentos no existe en esta empresa"]);
  }

  let importeBruto = money.ZERO;
  let brutoHistorico = money.ZERO;
  let diferenciaTotal = money.ZERO;
  const detalle: {
    documentoId: string;
    importe: Dec;
    diferencia: Dec;
    saldoNuevo: Dec;
    moneda: string;
  }[] = [];

  const tipoCambioPago = dec(datos.tipoCambio);

  for (const a of datos.aplicaciones) {
    const doc = docs.find((d) => d.id === a.documentoId)!;
    const importe = dec(a.importe);

    if (!money.gt(importe, money.ZERO)) {
      throw new PagoInvalido([`el importe aplicado a ${doc.serie}-${doc.numero} debe ser positivo`]);
    }
    if (doc.proveedorId !== datos.proveedorId) {
      throw new PagoInvalido([
        `el documento ${doc.serie}-${doc.numero} es de otro proveedor`,
      ]);
    }
    if (money.gt(importe, dec(doc.saldo))) {
      throw new PagoInvalido([
        `${doc.serie}-${doc.numero} tiene un saldo de ${txt2(dec(doc.saldo))} y se intenta aplicar ${txt2(importe)}`,
      ]);
    }

    // Diferencia de cambio: la deuda se registró a un tipo y se paga a otro.
    // Para un pasivo, que el dólar suba es una pérdida.
    const diferencia = doc.moneda === "PEN"
      ? money.ZERO
      : contabilidad.diferenciaCambio(
          importe,
          dec(doc.tipoCambio),
          tipoCambioPago,
          "pasivo",
        ).importe;

    importeBruto = money.add(importeBruto, importe);
    diferenciaTotal = money.add(diferenciaTotal, diferencia);
    // Lo que la deuda vale en la cuenta 42: al tipo con el que se registró, no
    // al de hoy. Es la cifra que hay que cancelar para dejar la cuenta en cero.
    brutoHistorico = money.add(
      brutoHistorico,
      money.round(money.mul(importe, dec(doc.tipoCambio)), 2),
    );
    detalle.push({
      documentoId: doc.id,
      importe,
      diferencia,
      saldoNuevo: money.sub(dec(doc.saldo), importe),
      moneda: doc.moneda,
    });
  }

  // La retención se calcula sobre el bruto pagado. Sólo aplica si la empresa es
  // agente de retención y el proveedor no está excluido.
  const retencion =
    datos.retenerIgv && empresa?.esAgenteRetencion && !proveedor.esAgenteRetencion
      ? tributario.calcularRetencion(importeBruto)
      : { aplica: false, monto: money.ZERO, neto: importeBruto, tasa: tributario.TASA_RETENCION };

  const importeNeto = retencion.neto;

  const [cab] = await db
    .insert(pagos)
    .values({
      empresaId,
      numero: datos.numero,
      proveedorId: datos.proveedorId,
      fecha: datos.fecha,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      medioPago: datos.medioPago,
      importeBruto: txt2(importeBruto),
      retencionMonto: txt2(retencion.monto),
      importeNeto: txt2(importeNeto),
      referencia: datos.referencia ?? null,
      creadoPor: usuarioId,
    })
    .returning({ id: pagos.id });
  const pagoId = cab!.id;

  for (const d of detalle) {
    await db.insert(pagoAplicaciones).values({
      empresaId,
      pagoId,
      documentoId: d.documentoId,
      importeAplicado: txt2(d.importe),
      diferenciaCambio: txt2(d.diferencia),
    });

    await db
      .update(documentosCxp)
      .set({
        saldo: txt2(d.saldoNuevo),
        estado: money.isZero(d.saldoNuevo) ? "pagado" : "parcial",
      })
      .where(eq(documentosCxp.id, d.documentoId));
  }

  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa: `Pago ${datos.numero} · ${proveedor.razonSocial}`,
    moneda: datos.moneda,
    tipoCambio: datos.tipoCambio,
    origenModulo: "pagos",
    origenId: pagoId,
    lineas: lineasAsientoPago({
      importeBruto,
      brutoHistorico,
      retencion: retencion.monto,
      importeNeto,
      diferencia: diferenciaTotal,
      tipoCambioPago,
      cuentaOrigen: datos.cuentaOrigen,
      proveedorId: datos.proveedorId,
    }),
  });

  await db.update(pagos).set({ asientoId }).where(eq(pagos.id, pagoId));

  return {
    pagoId,
    asientoId,
    importeBruto: txt2(importeBruto),
    retencion: txt2(retencion.monto),
    importeNeto: txt2(importeNeto),
    diferenciaCambio: txt2(diferenciaTotal),
    documentosCancelados: detalle.filter((d) => money.isZero(d.saldoNuevo)).length,
  };
}

/**
 * Asiento del pago.
 *
 * La cuenta del proveedor se carga por lo que la deuda vale **en la cuenta**,
 * es decir, al tipo de cambio con el que se registró. El banco se abona por lo
 * que sale hoy, al tipo de hoy. La diferencia entre ambos es real y va a la 776
 * o a la 676; no es un descuadre que haya que forzar a cero.
 *
 * Por eso los importes funcionales se pasan explícitos en lugar de dejar que se
 * conviertan con el tipo de la cabecera: si se convirtieran todos al mismo
 * tipo, la diferencia de cambio desaparecería y la deuda quedaría con un saldo
 * residual en la cuenta 42 que nadie sabría explicar.
 */
function lineasAsientoPago(p: {
  importeBruto: Dec;
  brutoHistorico: Dec;
  retencion: Dec;
  importeNeto: Dec;
  diferencia: Dec;
  tipoCambioPago: Dec;
  cuentaOrigen: string;
  proveedorId: string;
}): LineaAsientoEntrada[] {
  const aFuncional = (v: Dec) => txt2(money.round(money.mul(v, p.tipoCambioPago), 2));

  const lineas: LineaAsientoEntrada[] = [
    {
      cuenta: "4212",
      glosa: "Cancelación al proveedor",
      debe: txt2(p.importeBruto),
      debeFuncional: txt2(p.brutoHistorico),
      anexoId: p.proveedorId,
    },
    {
      cuenta: p.cuentaOrigen,
      glosa: "Salida de fondos",
      haber: txt2(p.importeNeto),
      haberFuncional: aFuncional(p.importeNeto),
    },
  ];

  if (!money.isZero(p.retencion)) {
    lineas.push({
      cuenta: "40114",
      glosa: "Retención de IGV por pagar",
      haber: txt2(p.retencion),
      haberFuncional: aFuncional(p.retencion),
    });
  }

  if (!money.isZero(p.diferencia)) {
    // Sólo tiene importe funcional: la diferencia de cambio no existe en la
    // moneda de la operación. Ganancia a la 776, pérdida a la 676; el signo lo
    // trae calculado `diferenciaCambio`, que sabe que esto es un pasivo.
    const linea: LineaAsientoEntrada = money.gt(p.diferencia, money.ZERO)
      ? { cuenta: "776", glosa: "Diferencia de cambio", haberFuncional: txt2(p.diferencia) }
      : { cuenta: "676", glosa: "Diferencia de cambio", debeFuncional: txt2(money.neg(p.diferencia)) };
    lineas.push(linea);
  }

  return lineas;
}

// ─── Letras ───────────────────────────────────────────────────────────────

export type DatosLetra = {
  numero: string;
  /** "cobrar" o "pagar". */
  cartera: "cobrar" | "pagar";
  terceroId: string;
  fechaGiro: string;
  fechaVencimiento: string;
  moneda: string;
  /** Documentos que se canjean por esta letra. */
  documentos: { documentoId: string; importe: string }[];
};

/**
 * Canjea uno o varios documentos por una letra.
 *
 * El canje no cancela la deuda: la cambia de forma. La factura deja de estar
 * pendiente y en su lugar queda una letra con su propio vencimiento, que es
 * exactamente lo que refleja el asiento: se carga la 4212 y se abona la 4231.
 */
export async function canjearPorLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosLetra,
): Promise<{ letraId: string; asientoId: string; importe: string }> {
  if (datos.documentos.length === 0) {
    throw new PagoInvalido(["indique qué documentos se canjean por la letra"]);
  }
  if (datos.fechaVencimiento <= datos.fechaGiro) {
    throw new PagoInvalido(["la letra debe vencer después de su fecha de giro"]);
  }

  const ids = datos.documentos.map((d) => d.documentoId);
  const docs = await db
    .select()
    .from(documentosCxp)
    .where(inArray(documentosCxp.id, ids))
    .for("update");
  if (docs.length !== ids.length) {
    throw new PagoInvalido(["alguno de los documentos no existe en esta empresa"]);
  }

  let importe = money.ZERO;
  for (const d of datos.documentos) {
    const doc = docs.find((x) => x.id === d.documentoId)!;
    const monto = dec(d.importe);
    if (money.gt(monto, dec(doc.saldo))) {
      throw new PagoInvalido([
        `${doc.serie}-${doc.numero} tiene un saldo de ${txt2(dec(doc.saldo))} y se intenta canjear ${txt2(monto)}`,
      ]);
    }
    importe = money.add(importe, monto);
  }

  const [letra] = await db
    .insert(letras)
    .values({
      empresaId,
      numero: datos.numero,
      cartera: datos.cartera,
      terceroId: datos.terceroId,
      fechaGiro: datos.fechaGiro,
      fechaVencimiento: datos.fechaVencimiento,
      moneda: datos.moneda,
      importe: txt2(importe),
      saldo: txt2(importe),
      estado: "girada",
      creadoPor: usuarioId,
    })
    .returning({ id: letras.id });

  for (const d of datos.documentos) {
    const doc = docs.find((x) => x.id === d.documentoId)!;
    const monto = dec(d.importe);
    const saldoNuevo = money.sub(dec(doc.saldo), monto);

    await db.insert(letraDocumentos).values({
      empresaId,
      letraId: letra!.id,
      documentoId: d.documentoId,
      importe: txt2(monto),
    });
    await db
      .update(documentosCxp)
      .set({
        saldo: txt2(saldoNuevo),
        estado: money.isZero(saldoNuevo) ? "canjeado" : "parcial",
      })
      .where(eq(documentosCxp.id, d.documentoId));
  }

  const periodo = datos.fechaGiro.slice(0, 4) + datos.fechaGiro.slice(5, 7);
  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fechaGiro,
    subdiario: "08",
    glosa: `Canje por letra ${datos.numero}`,
    moneda: datos.moneda,
    tipoCambio: "1",
    origenModulo: "letras",
    origenId: letra!.id,
    lineas: [
      {
        cuenta: "4212",
        glosa: "Documentos canjeados",
        debe: txt2(importe),
        anexoId: datos.terceroId,
      },
      {
        cuenta: "4231",
        glosa: "Letras por pagar no vencidas",
        haber: txt2(importe),
        anexoId: datos.terceroId,
      },
    ],
  });

  return { letraId: letra!.id, asientoId, importe: txt2(importe) };
}

/**
 * Renueva una letra por otra con nuevo vencimiento.
 *
 * La original queda marcada como renovada y la nueva nace por el saldo, más los
 * intereses si los hubo. Es lo que ocurre cuando el proveedor acepta esperar.
 */
export async function renovarLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  letraId: string,
  datos: { numero: string; fechaVencimiento: string; fecha: string; intereses?: string },
): Promise<{ letraId: string; importe: string }> {
  const [original] = await db.select().from(letras).where(eq(letras.id, letraId)).limit(1);
  if (!original) throw new PagoInvalido(["la letra no existe"]);
  if (original.estado === "cobrada" || original.estado === "renovada") {
    throw new PagoInvalido([`la letra está ${original.estado} y no se renueva`]);
  }

  const intereses = dec(datos.intereses);
  const nuevoImporte = money.add(dec(original.saldo), intereses);

  const [nueva] = await db
    .insert(letras)
    .values({
      empresaId,
      numero: datos.numero,
      cartera: original.cartera,
      terceroId: original.terceroId,
      fechaGiro: datos.fecha,
      fechaVencimiento: datos.fechaVencimiento,
      moneda: original.moneda,
      importe: txt2(nuevoImporte),
      saldo: txt2(nuevoImporte),
      estado: "girada",
      creadoPor: usuarioId,
    })
    .returning({ id: letras.id });

  await db
    .update(letras)
    .set({ estado: "renovada", saldo: "0", renuevaA: nueva!.id })
    .where(eq(letras.id, letraId));

  // Los intereses son un gasto financiero nuevo, no parte de la deuda original.
  if (!money.isZero(intereses)) {
    await asentar(db, empresaId, usuarioId, {
      periodo: datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7),
      fecha: datos.fecha,
      subdiario: "08",
      glosa: `Intereses por renovación de la letra ${original.numero}`,
      moneda: original.moneda,
      tipoCambio: "1",
      origenModulo: "letras",
      origenId: nueva!.id,
      lineas: [
        { cuenta: "6711", glosa: "Intereses de renovación", debe: txt2(intereses) },
        {
          cuenta: "4231",
          glosa: "Letras por pagar",
          haber: txt2(intereses),
          anexoId: original.terceroId,
        },
      ],
    });
  }

  return { letraId: nueva!.id, importe: txt2(nuevoImporte) };
}

// ─── Consultas ────────────────────────────────────────────────────────────

export const listarPagos = (db: Db) =>
  db
    .select({
      id: pagos.id,
      numero: pagos.numero,
      proveedor: terceros.razonSocial,
      fecha: pagos.fecha,
      moneda: pagos.moneda,
      medioPago: pagos.medioPago,
      importeBruto: pagos.importeBruto,
      retencionMonto: pagos.retencionMonto,
      importeNeto: pagos.importeNeto,
      referencia: pagos.referencia,
      estado: pagos.estado,
    })
    .from(pagos)
    .innerJoin(terceros, eq(terceros.id, pagos.proveedorId))
    .orderBy(desc(pagos.fecha))
    .limit(300);

export const listarLetras = (db: Db, cartera: "cobrar" | "pagar" = "pagar") =>
  db
    .select({
      id: letras.id,
      numero: letras.numero,
      tercero: terceros.razonSocial,
      fechaGiro: letras.fechaGiro,
      fechaVencimiento: letras.fechaVencimiento,
      moneda: letras.moneda,
      importe: letras.importe,
      saldo: letras.saldo,
      estado: letras.estado,
    })
    .from(letras)
    .innerJoin(terceros, eq(terceros.id, letras.terceroId))
    .where(eq(letras.cartera, cartera))
    .orderBy(asc(letras.fechaVencimiento))
    .limit(300);

/** Documentos abiertos de un proveedor, para armar el pago. */
export const documentosPorPagar = (db: Db, proveedorId: string) =>
  db
    .select()
    .from(documentosCxp)
    .where(
      and(eq(documentosCxp.proveedorId, proveedorId), sql`${documentosCxp.saldo} > 0`),
    )
    .orderBy(asc(documentosCxp.fechaVencimiento));

export { txt };
