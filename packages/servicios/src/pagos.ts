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
import { anotarMovimientoDeOtroModulo } from "./tesoreria.ts";
import { cuentasDe, type Cuentas } from "./parametros.ts";
import { ErrorDeNegocio } from "@roulterp/core";

const {
  documentosCxp, pagos, pagoAplicaciones, terceros, letras, letraDocumentos, letraPagos,
  empresas, cuentasEfectivo,
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);
const txt = (v: Dec, d = 6): string => money.toString(v, d);

export class PagoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "PagoInvalido");
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
  /**
   * Cuenta de efectivo concreta de la que sale.
   *
   * Igual que en cobranzas: sin ella el pago se contabiliza pero no aparece en
   * Caja y Bancos, y la conciliación se queda sin nada que casar contra el
   * extracto del banco.
   */
  cuentaEfectivoId?: string;
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

  // Ver la nota en cobranzas: la cuenta contable la manda la cuenta de
  // efectivo elegida, para que el asiento y la tesorería no se contradigan.
  const cuentaOrigen = datos.cuentaEfectivoId
    ? (
        await db
          .select({ cuentaContable: cuentasEfectivo.cuentaContable })
          .from(cuentasEfectivo)
          .where(eq(cuentasEfectivo.id, datos.cuentaEfectivoId))
          .limit(1)
      )[0]?.cuentaContable ?? datos.cuentaOrigen
    : datos.cuentaOrigen;

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
    lineas: lineasAsientoPago(await cuentasDe(db), {
      importeBruto,
      brutoHistorico,
      retencion: retencion.monto,
      importeNeto,
      diferencia: diferenciaTotal,
      tipoCambioPago,
      cuentaOrigen,
      proveedorId: datos.proveedorId,
    }),
  });

  await db.update(pagos).set({ asientoId }).where(eq(pagos.id, pagoId));

  if (datos.cuentaEfectivoId) {
    // Sale el neto, no el bruto: la retención no cruza la cuenta del banco.
    await anotarMovimientoDeOtroModulo(db, empresaId, usuarioId, {
      cuentaId: datos.cuentaEfectivoId,
      fecha: datos.fecha,
      sentido: "egreso",
      concepto: `Pago ${datos.numero} · ${proveedor.razonSocial}`,
      importe: txt2(importeNeto),
      ...(datos.referencia ? { referencia: datos.referencia } : {}),
      terceroId: datos.proveedorId,
      origenModulo: "pagos",
      origenId: pagoId,
      asientoId,
    });
  }

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
function lineasAsientoPago(cuentas: Cuentas, p: {
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
      cuenta: cuentas.get("proveedores"),
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
      cuenta: cuentas.get("retencion_igv"),
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
      ? {
          cuenta: cuentas.get("ganancia_cambio"),
          glosa: "Diferencia de cambio",
          haberFuncional: txt2(p.diferencia),
        }
      : {
          cuenta: cuentas.get("perdida_cambio"),
          glosa: "Diferencia de cambio",
          debeFuncional: txt2(money.neg(p.diferencia)),
        };
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
  const porPagar = datos.cartera === "pagar";

  /*
   * Cada cartera canjea documentos de origen distinto.
   *
   * Por pagar, la factura del proveedor vive en `documentos_cxp`. Por cobrar,
   * el documento es el comprobante que la empresa emitió: no hay una tabla
   * espejo, y su saldo se deriva del total menos lo cobrado y lo ya canjeado.
   */
  const pendientes = porPagar
    ? (await db.select().from(documentosCxp).where(inArray(documentosCxp.id, ids)).for("update"))
        .map((d) => ({
          id: d.id,
          etiqueta: `${d.serie}-${d.numero}`,
          saldo: dec(d.saldo),
        }))
    : await saldosDeComprobantes(db, ids);

  if (pendientes.length !== ids.length) {
    throw new PagoInvalido(["alguno de los documentos no existe en esta empresa"]);
  }

  let importe = money.ZERO;
  for (const d of datos.documentos) {
    const doc = pendientes.find((x) => x.id === d.documentoId)!;
    const monto = dec(d.importe);
    if (money.gt(monto, doc.saldo)) {
      throw new PagoInvalido([
        `${doc.etiqueta} tiene un saldo de ${txt2(doc.saldo)} y se intenta canjear ${txt2(monto)}`,
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
    const doc = pendientes.find((x) => x.id === d.documentoId)!;
    const monto = dec(d.importe);

    await db.insert(letraDocumentos).values({
      empresaId,
      letraId: letra!.id,
      documentoId: d.documentoId,
      importe: txt2(monto),
    });

    // En la cartera por pagar hay que actualizar el saldo de la factura; en la
    // de cobrar no existe tal columna: el saldo se deriva, y la propia fila de
    // `letra_documentos` que se acaba de insertar ya lo reduce.
    if (porPagar) {
      const saldoNuevo = money.sub(doc.saldo, monto);
      await db
        .update(documentosCxp)
        .set({
          saldo: txt2(saldoNuevo),
          estado: money.isZero(saldoNuevo) ? "canjeado" : "parcial",
        })
        .where(eq(documentosCxp.id, d.documentoId));
    }
  }

  const periodo = datos.fechaGiro.slice(0, 4) + datos.fechaGiro.slice(5, 7);
  // Por pagar se traslada de la 4212 a la 4231; por cobrar, de la 1212 a la
  // 1232, que es la divisionaria de letras en cartera.
  const cuentas = await cuentasDe(db);
  const [origen, destino, glosaDestino] = porPagar
    ? [cuentas.get("proveedores"), cuentas.get("letras_por_pagar"), "Letras por pagar no vencidas"]
    : [cuentas.get("letras_por_cobrar"), cuentas.get("clientes"), "Letras por cobrar en cartera"];

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
        cuenta: origen,
        glosa: porPagar ? "Documentos canjeados" : glosaDestino,
        debe: txt2(importe),
        anexoId: datos.terceroId,
      },
      {
        cuenta: destino,
        glosa: porPagar ? glosaDestino : "Documentos canjeados",
        haber: txt2(importe),
        anexoId: datos.terceroId,
      },
    ],
  });

  return { letraId: letra!.id, asientoId, importe: txt2(importe) };
}

/**
 * Saldo pendiente de comprobantes emitidos, para el canje de la cartera por
 * cobrar. Réplica intencionada de la definición de `cobranzas.ts`: importarla
 * desde allí crearía una dependencia circular entre los dos módulos.
 */
async function saldosDeComprobantes(
  db: Db,
  ids: string[],
): Promise<{ id: string; etiqueta: string; saldo: Dec }[]> {
  const totales = await db
    .select({
      id: s.comprobantes.id,
      serie: s.comprobantes.serie,
      numero: s.comprobantes.numero,
      total: s.comprobantes.total,
    })
    .from(s.comprobantes)
    .where(inArray(s.comprobantes.id, ids));

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

  return totales.map((t) => ({
    id: t.id,
    etiqueta: `${t.serie}-${t.numero}`,
    saldo: money.sub(
      dec(t.total),
      money.add(porCobrado.get(t.id) ?? money.ZERO, porCanjeado.get(t.id) ?? money.ZERO),
    ),
  }));
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

  if (!money.isZero(intereses)) {
    await asentarIntereses(db, empresaId, usuarioId, {
      cartera: original.cartera,
      terceroId: original.terceroId,
      moneda: original.moneda,
      fecha: datos.fecha,
      importe: intereses,
      glosa: `Intereses por renovación de la letra ${original.numero}`,
      origenId: nueva!.id,
    });
  }

  return { letraId: nueva!.id, importe: txt2(nuevoImporte) };
}

/**
 * Asiento de los intereses de una renovación o una refinanciación.
 *
 * El signo depende de la cartera, y confundirlo es caro: si la letra es **por
 * pagar**, los intereses son un gasto financiero y aumentan lo que debemos; si
 * es **por cobrar**, son un ingreso financiero y aumentan lo que nos deben.
 *
 * Antes se asentaba siempre como gasto contra letras por pagar, con lo que
 * refinanciarle una letra a un cliente inflaba el gasto y el pasivo por una
 * operación que en realidad aumenta el activo y el ingreso. Los asientos
 * cuadraban igual, que es lo que hacía el error invisible.
 */
async function asentarIntereses(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    cartera: string;
    terceroId: string;
    moneda: string;
    fecha: string;
    importe: Dec;
    glosa: string;
    origenId: string;
  },
): Promise<void> {
  const porPagar = datos.cartera === "pagar";
  const cuentas = await cuentasDe(db);
  await asentar(db, empresaId, usuarioId, {
    periodo: datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7),
    fecha: datos.fecha,
    subdiario: "08",
    glosa: datos.glosa,
    moneda: datos.moneda,
    tipoCambio: "1",
    origenModulo: "letras",
    origenId: datos.origenId,
    lineas: porPagar
      ? [
          { cuenta: cuentas.get("intereses_gasto"), glosa: datos.glosa, debe: txt2(datos.importe) },
          {
            cuenta: cuentas.get("letras_por_pagar"),
            glosa: "Letras por pagar",
            haber: txt2(datos.importe),
            anexoId: datos.terceroId,
          },
        ]
      : [
          {
            cuenta: cuentas.get("letras_por_cobrar"),
            glosa: "Letras por cobrar",
            debe: txt2(datos.importe),
            anexoId: datos.terceroId,
          },
          { cuenta: cuentas.get("intereses_ingreso"), glosa: datos.glosa, haber: txt2(datos.importe) },
        ],
  });
}

export type Cuota = { numero: string; fechaVencimiento: string; importe: string };

/**
 * Refinancia una letra en varias cuotas.
 *
 * Es lo que se hace cuando el cliente no puede pagar el total en la fecha: en
 * vez de protestar la letra, se reemplaza por dos o tres con vencimientos
 * escalonados. Renovar es el caso de una sola cuota; esto generaliza.
 *
 * La suma de las cuotas tiene que ser el saldo más los intereses pactados, al
 * céntimo. Dejar que no cuadre convertiría la refinanciación en una condonación
 * parcial silenciosa, que es exactamente lo contrario de lo que se pretende.
 */
export async function refinanciarLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  letraId: string,
  datos: { fecha: string; cuotas: Cuota[]; intereses?: string },
): Promise<{ letras: { id: string; numero: string; importe: string }[]; total: string }> {
  const [original] = await db.select().from(letras).where(eq(letras.id, letraId)).limit(1);
  if (!original) throw new PagoInvalido(["la letra no existe"]);
  if (original.estado === "cobrada" || original.estado === "renovada") {
    throw new PagoInvalido([`la letra está ${original.estado} y no se refinancia`]);
  }
  if (datos.cuotas.length < 2) {
    throw new PagoInvalido([
      "una refinanciación son dos cuotas o más: para una sola, renueve la letra",
    ]);
  }

  const motivos: string[] = [];
  for (const [i, c] of datos.cuotas.entries()) {
    if (!c.numero.trim()) motivos.push(`cuota ${i + 1}: indique el número de la letra`);
    if (!money.gt(dec(c.importe), money.ZERO)) {
      motivos.push(`cuota ${i + 1}: el importe debe ser positivo`);
    }
    if (c.fechaVencimiento <= datos.fecha) {
      motivos.push(`cuota ${i + 1}: debe vencer después de la fecha de refinanciación`);
    }
  }
  if (motivos.length) throw new PagoInvalido(motivos);

  const intereses = dec(datos.intereses);
  const esperado = money.add(dec(original.saldo), intereses);
  const suma = datos.cuotas.reduce<Dec>((a, c) => money.add(a, dec(c.importe)), money.ZERO);
  if (suma !== esperado) {
    throw new PagoInvalido([
      `las cuotas suman ${txt2(suma)} y deberían sumar ${txt2(esperado)} ` +
        `(saldo ${txt2(dec(original.saldo))} más intereses ${txt2(intereses)})`,
    ]);
  }

  const nuevas: { id: string; numero: string; importe: string }[] = [];
  for (const c of datos.cuotas) {
    const [fila] = await db
      .insert(letras)
      .values({
        empresaId,
        numero: c.numero.trim(),
        cartera: original.cartera,
        terceroId: original.terceroId,
        fechaGiro: datos.fecha,
        fechaVencimiento: c.fechaVencimiento,
        moneda: original.moneda,
        importe: txt2(dec(c.importe)),
        saldo: txt2(dec(c.importe)),
        estado: "girada",
        creadoPor: usuarioId,
      })
      .returning({ id: letras.id });
    nuevas.push({ id: fila!.id, numero: c.numero.trim(), importe: txt2(dec(c.importe)) });
  }

  // La original apunta a la primera cuota: con varias herederas no hay una sola
  // sucesora, y la primera es la que conserva el vencimiento más cercano.
  await db
    .update(letras)
    .set({ estado: "renovada", saldo: "0", renuevaA: nuevas[0]!.id })
    .where(eq(letras.id, letraId));

  if (!money.isZero(intereses)) {
    await asentarIntereses(db, empresaId, usuarioId, {
      cartera: original.cartera,
      terceroId: original.terceroId,
      moneda: original.moneda,
      fecha: datos.fecha,
      importe: intereses,
      glosa: `Intereses por refinanciación de la letra ${original.numero}`,
      origenId: nuevas[0]!.id,
    });
  }

  return { letras: nuevas, total: txt2(suma) };
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

// ─── Vencimiento de letras ────────────────────────────────────────────────

/**
 * Paga una letra al vencimiento.
 *
 * Es lo que cierra el ciclo del canje: la deuda dejó de estar en la factura
 * cuando se giró la letra, y deja de estar en la letra cuando se paga. El
 * asiento carga la 4231 y abona la cuenta de donde sale el dinero.
 *
 * Se admite el pago parcial —una letra se puede amortizar— pero no el que
 * excede el saldo: eso sería un pago a cuenta de nada.
 */
export async function pagarLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: {
    letraId: string;
    fecha: string;
    importe?: string;
    cuentaOrigen?: string;
    /** Cuenta de caja o banco de la que sale el dinero. */
    cuentaEfectivoId?: string;
    referencia?: string;
    /** Obligatorio si la letra no está en soles. */
    tipoCambio?: string;
    /**
     * Retener el IGV al pagar.
     *
     * Es el momento que manda la norma cuando la deuda se canjeó por letra: la
     * retención no se hace al canjear —ahí no se pagó nada— sino al vencimiento
     * o cuando la letra se hace efectiva, lo que ocurra primero.
     */
    retenerIgv?: boolean;
  },
): Promise<{
  asientoId: string;
  letraPagoId: string;
  numero: string;
  importe: string;
  retencion: string;
  importeNeto: string;
  saldo: string;
}> {
  const [letra] = await db
    .select()
    .from(letras)
    .where(eq(letras.id, datos.letraId))
    .for("update")
    .limit(1);
  if (!letra) throw new PagoInvalido(["la letra no existe"]);
  if (letra.cartera !== "pagar") {
    throw new PagoInvalido(["esta letra es de la cartera por cobrar; se cobra, no se paga"]);
  }
  if (letra.estado === "cobrada" || letra.estado === "renovada") {
    throw new PagoInvalido([`la letra ya está ${letra.estado}`]);
  }

  const saldo = dec(letra.saldo);
  const importe = datos.importe ? dec(datos.importe) : saldo;
  if (!money.gt(importe, money.ZERO)) throw new PagoInvalido(["el importe debe ser positivo"]);
  if (money.gt(importe, saldo)) {
    throw new PagoInvalido([
      `la letra ${letra.numero} tiene un saldo de ${txt2(saldo)} y se intenta pagar ${txt2(importe)}`,
    ]);
  }

  const saldoNuevo = money.sub(saldo, importe);

  const [tercero] = await db
    .select({
      razonSocial: terceros.razonSocial,
      esAgenteRetencion: terceros.esAgenteRetencion,
    })
    .from(terceros)
    .where(eq(terceros.id, letra.terceroId))
    .limit(1);
  const [empresa] = await db
    .select({ esAgenteRetencion: empresas.esAgenteRetencion })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);

  // Mismo criterio que en el pago de facturas: sólo retiene el agente, y no se
  // le retiene a otro agente de retención.
  const retencion =
    datos.retenerIgv && empresa?.esAgenteRetencion && !tercero?.esAgenteRetencion
      ? tributario.calcularRetencion(importe)
      : { aplica: false, monto: money.ZERO, neto: importe, tasa: tributario.TASA_RETENCION };
  const importeNeto = retencion.neto;

  // Si se dice de qué cuenta de efectivo sale, la cuenta contable se toma de
  // ella: escribir "1041" a mano cuando el dinero sale de la caja chica deja el
  // asiento diciendo una cosa y la tesorería otra.
  const cuentas = await cuentasDe(db);
  let cuenta = datos.cuentaOrigen ?? cuentas.get("banco_por_defecto");
  if (datos.cuentaEfectivoId) {
    const [ce] = await db
      .select({ cuentaContable: cuentasEfectivo.cuentaContable, moneda: cuentasEfectivo.moneda })
      .from(cuentasEfectivo)
      .where(eq(cuentasEfectivo.id, datos.cuentaEfectivoId))
      .limit(1);
    if (!ce) throw new PagoInvalido(["la cuenta de efectivo no existe en esta empresa"]);
    cuenta = datos.cuentaOrigen ?? ce.cuentaContable;
  }
  // Una letra vencida y no pagada pasó a la 4232; la que se paga a tiempo sigue
  // en la 4231. El asiento tiene que cargar la que corresponda.
  const cuentaLetra =
    letra.estado === "protestada"
      ? cuentas.get("letras_por_pagar_vencidas")
      : cuentas.get("letras_por_pagar");
  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "01",
    glosa: `Pago de la letra ${letra.numero}`,
    moneda: letra.moneda,
    // El tipo de cambio lo indica quien paga; si no lo da, se asienta al de la
    // moneda de la letra. Antes se pasaba aquí el importe de la letra, que no
    // es un tipo de cambio: en una letra en dólares el asiento salía disparado.
    tipoCambio: datos.tipoCambio ?? "1",
    origenModulo: "letras",
    origenId: letra.id,
    lineas: [
      {
        cuenta: cuentaLetra,
        glosa: "Letra pagada",
        debe: txt2(importe),
        anexoId: letra.terceroId,
      },
      { cuenta, glosa: "Salida de fondos", haber: txt2(importeNeto) },
      ...(money.isZero(retencion.monto)
        ? []
        : [
            {
              cuenta: cuentas.get("retencion_igv"),
              glosa: "Retención de IGV por pagar",
              haber: txt2(retencion.monto),
            },
          ]),
    ],
  });

  const [letraPago] = await db
    .insert(letraPagos)
    .values({
      empresaId,
      letraId: letra.id,
      fecha: datos.fecha,
      importe: txt2(importe),
      retencionMonto: txt2(retencion.monto),
      importeNeto: txt2(importeNeto),
      moneda: letra.moneda,
      tipoCambio: datos.tipoCambio ?? "1",
      cuentaEfectivoId: datos.cuentaEfectivoId ?? null,
      referencia: datos.referencia ?? null,
      asientoId,
      creadoPor: usuarioId,
    })
    .returning({ id: letraPagos.id });

  /*
   * El dinero tiene que aparecer en Caja y Bancos.
   *
   * Sin esto el asiento decía que el banco se había movido y la tesorería
   * seguía marcando lo mismo: dos verdades sobre el mismo dinero, que es
   * exactamente lo que impide conciliar. Sale el neto, porque la retención no
   * cruza la cuenta del banco.
   */
  if (datos.cuentaEfectivoId) {
    await anotarMovimientoDeOtroModulo(db, empresaId, usuarioId, {
      cuentaId: datos.cuentaEfectivoId,
      fecha: datos.fecha,
      sentido: "egreso",
      concepto: `Pago de la letra ${letra.numero}${tercero ? ` · ${tercero.razonSocial}` : ""}`,
      importe: txt2(importeNeto),
      ...(datos.referencia ? { referencia: datos.referencia } : {}),
      terceroId: letra.terceroId,
      origenModulo: "letras",
      origenId: letraPago!.id,
      asientoId,
    });
  }

  await db
    .update(letras)
    .set({
      saldo: txt2(saldoNuevo),
      // "cobrada" es el estado terminal en las dos carteras: la letra dejó de
      // deber. Se conserva el nombre para no multiplicar estados equivalentes.
      estado: money.isZero(saldoNuevo) ? "cobrada" : letra.estado,
    })
    .where(eq(letras.id, letra.id));

  return {
    asientoId,
    letraPagoId: letraPago!.id,
    numero: letra.numero,
    importe: txt2(importe),
    retencion: txt2(retencion.monto),
    importeNeto: txt2(importeNeto),
    saldo: txt2(saldoNuevo),
  };
}

/**
 * Protesta una letra vencida y no pagada.
 *
 * El protesto no cancela la deuda: la reclasifica. En la cartera por pagar
 * mueve la letra de "no vencidas" a "vencidas"; en la de cobrar, de "en
 * cartera" a "en cobranza judicial". Los gastos del protesto, si los hay, son
 * gasto financiero del periodo.
 */
export async function protestarLetra(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { letraId: string; fecha: string; gastos?: string; motivo?: string },
): Promise<{ asientoId: string; numero: string }> {
  const [letra] = await db
    .select()
    .from(letras)
    .where(eq(letras.id, datos.letraId))
    .for("update")
    .limit(1);
  if (!letra) throw new PagoInvalido(["la letra no existe"]);
  if (letra.estado === "cobrada") throw new PagoInvalido(["una letra pagada no se protesta"]);
  if (letra.estado === "protestada") throw new PagoInvalido(["la letra ya está protestada"]);
  if (datos.fecha < letra.fechaVencimiento) {
    throw new PagoInvalido([
      `la letra vence el ${letra.fechaVencimiento}; no se puede protestar antes`,
    ]);
  }

  const saldo = dec(letra.saldo);
  const porPagar = letra.cartera === "pagar";
  const cuentas = await cuentasDe(db);
  const [desde, hasta] = porPagar
    ? [cuentas.get("letras_por_pagar"), cuentas.get("letras_por_pagar_vencidas")]
    : [cuentas.get("letras_por_cobrar"), cuentas.get("letras_por_cobrar_vencidas")];
  const periodo = datos.fecha.slice(0, 4) + datos.fecha.slice(5, 7);
  const gastos = dec(datos.gastos ?? "0");

  const lineas: LineaAsientoEntrada[] = [
    { cuenta: desde, glosa: "Letra protestada", debe: txt2(saldo), anexoId: letra.terceroId },
    { cuenta: hasta, glosa: "Letra vencida", haber: txt2(saldo), anexoId: letra.terceroId },
  ];

  if (!money.isZero(gastos)) {
    lineas.push({
      cuenta: cuentas.get("gastos_bancarios"),
      glosa: "Gastos del protesto",
      debe: txt2(gastos),
    });
    lineas.push({
      cuenta: cuentas.get("banco_por_defecto"),
      glosa: "Gastos del protesto",
      haber: txt2(gastos),
    });
  }

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fecha,
    subdiario: "08",
    glosa: `Protesto de la letra ${letra.numero}${datos.motivo ? ` · ${datos.motivo}` : ""}`,
    moneda: letra.moneda,
    tipoCambio: "1",
    origenModulo: "letras",
    origenId: letra.id,
    lineas,
  });

  await db.update(letras).set({ estado: "protestada" }).where(eq(letras.id, letra.id));
  return { asientoId, numero: letra.numero };
}

/**
 * Letras que vencen dentro de un plazo, o que ya vencieron.
 *
 * Es la pantalla que el tesorero mira cada mañana: lo vencido primero, porque
 * es lo que ya está costando dinero.
 */
export async function letrasPorVencer(
  db: Db,
  opciones: { cartera?: "cobrar" | "pagar"; hasta?: string; dias?: number } = {},
) {
  const cartera = opciones.cartera ?? "pagar";
  const hasta =
    opciones.hasta ??
    new Date(Date.now() + (opciones.dias ?? 30) * 86_400_000).toISOString().slice(0, 10);

  const filas = (await db.execute(sql`
    SELECT l.id, l.numero, l.fecha_vencimiento::text AS vencimiento,
           l.moneda, l.importe::text AS importe, l.saldo::text AS saldo,
           l.estado, t.razon_social AS tercero,
           (current_date - l.fecha_vencimiento)::int AS dias_vencida
    FROM letras l
    JOIN terceros t ON t.id = l.tercero_id
    WHERE l.cartera = ${cartera}
      AND l.estado NOT IN ('cobrada', 'renovada')
      AND l.saldo > 0
      AND l.fecha_vencimiento <= ${hasta}
    ORDER BY l.fecha_vencimiento
    LIMIT 200`)) as unknown as {
    id: string; numero: string; vencimiento: string; moneda: string;
    importe: string; saldo: string; estado: string; tercero: string;
    dias_vencida: number;
  }[];
  return [...filas];
}

/**
 * Programación de egresos.
 *
 * Junta en una sola vista todo lo que hay que pagar y cuándo: facturas de
 * proveedor con saldo y letras aceptadas. Se agrupa por semana porque así se
 * decide —«esta semana pago esto, la siguiente aquello»— y se acumula el total
 * para ver dónde se rompe la caja.
 */
export type LineaEgreso = {
  tipo: "factura" | "letra";
  id: string;
  documento: string;
  tercero: string;
  vencimiento: string;
  moneda: string;
  saldo: string;
  /** Días hasta el vencimiento; negativo si ya venció. */
  dias: number;
};

export async function programacionDeEgresos(
  db: Db,
  opciones: { hasta?: string; dias?: number } = {},
) {
  const hasta =
    opciones.hasta ??
    new Date(Date.now() + (opciones.dias ?? 60) * 86_400_000).toISOString().slice(0, 10);

  const filas = (await db.execute(sql`
    SELECT 'factura' AS tipo, d.id, d.serie || '-' || d.numero AS documento,
           t.razon_social AS tercero, d.fecha_vencimiento::text AS vencimiento,
           d.moneda, d.saldo::text AS saldo,
           (d.fecha_vencimiento - current_date)::int AS dias
    FROM documentos_cxp d
    JOIN terceros t ON t.id = d.proveedor_id
    WHERE d.saldo > 0 AND d.fecha_vencimiento <= ${hasta}

    UNION ALL

    SELECT 'letra' AS tipo, l.id, l.numero AS documento,
           t.razon_social AS tercero, l.fecha_vencimiento::text AS vencimiento,
           l.moneda, l.saldo::text AS saldo,
           (l.fecha_vencimiento - current_date)::int AS dias
    FROM letras l
    JOIN terceros t ON t.id = l.tercero_id
    WHERE l.cartera = 'pagar' AND l.saldo > 0
      AND l.estado NOT IN ('cobrada', 'renovada')
      AND l.fecha_vencimiento <= ${hasta}

    ORDER BY vencimiento, documento
    LIMIT 500`)) as unknown as LineaEgreso[];

  const lineas = [...filas];

  // El acumulado es lo que hace útil la lista: dice cuánta caja hace falta
  // hasta cada fecha, no cuánto se debe en total.
  let acumulado = money.ZERO;
  const conAcumulado = lineas.map((l) => {
    acumulado = money.add(acumulado, dec(l.saldo));
    return { ...l, acumulado: txt2(acumulado) };
  });

  return {
    lineas: conAcumulado,
    total: txt2(acumulado),
    vencido: txt2(
      lineas.filter((l) => l.dias < 0).reduce<Dec>((a, l) => money.add(a, dec(l.saldo)), money.ZERO),
    ),
  };
}

/**
 * ¿La empresa es agente de retención del IGV?
 *
 * La pantalla lo pregunta para no ofrecer la casilla de retener a quien no lo
 * es: el servicio le devolvería cero de todos modos, y una casilla que no hace
 * nada es peor que no tenerla.
 */
export async function esAgenteRetencion(db: Db): Promise<boolean> {
  const [e] = await db.select({ agente: empresas.esAgenteRetencion }).from(empresas).limit(1);
  return e?.agente ?? false;
}
