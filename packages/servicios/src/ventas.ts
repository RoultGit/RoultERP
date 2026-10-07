/**
 * Ventas y emisión electrónica.
 *
 * La decisión que gobierna este módulo: **emitir y enviar son dos actos
 * separados**.
 *
 * Emitir es una operación de la empresa. Ocurre en una transacción: se numera
 * el comprobante, se descarga el inventario, se genera el asiento y nace la
 * cuenta por cobrar. Cuando esa transacción termina, la venta existe.
 *
 * Enviar a SUNAT es una conversación con un servicio ajeno que se cae, tarda y
 * responde tarde. Si el envío fuera parte de la misma transacción, una caída de
 * SUNAT impediría facturar, y eso es exactamente lo que no puede pasar en un
 * mostrador. El comprobante queda emitido y en cola; el envío se reintenta.
 *
 * Esa separación es también lo que exige la norma: el comprobante se entrega al
 * cliente en el acto y se informa a SUNAT dentro del plazo, no antes.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  money, tributario, cpe, inventario as kardexDominio,
} from "@roulterp/core";
import { abrir, type SobreCifrado } from "@roulterp/core/auth";
import { enEmpresa, schema as s, type Conexion, type Db } from "@roulterp/db";
import { registrarMovimiento } from "./inventario.ts";
import { atenderPedido } from "./pedidos.ts";
import { cabeEnElLimite } from "./cobranzas.ts";
import { asentar, type LineaAsientoEntrada } from "./contabilidad.ts";
import { cuentasDe, type Cuentas } from "./parametros.ts";
import { ErrorDeNegocio } from "@roulterp/core";
import { horaEnPeru } from "@roulterp/core/fecha";

const {
  comprobantes, comprobanteItems, terceros, productos, unidadesMedida,
  empresas, certificadosDigitales, credencialesSunat, 
} = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt = (v: Dec, d = 6): string => money.toString(v, d);
const txt2 = (v: Dec): string => money.toString(v, 2);

export class VentaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "VentaInvalida");
  }
}

export type LineaVenta = {
  productoId?: string;
  codigo?: string;
  descripcion?: string;
  unidad?: string;
  cantidad: string;
  valorUnitario: string;
  descuento?: string;
  /** Catálogo 07. Por defecto, el del producto. */
  afectacionIgv?: string;
};

export type DatosVenta = {
  clienteId: string;
  /** Catálogo 01: 01 factura, 03 boleta. */
  tipoDocumento: string;
  serie: string;
  fechaEmision: string;
  fechaVencimiento?: string;
  moneda: string;
  tipoCambio: string;
  lineas: LineaVenta[];
  /** Almacén del que sale la mercadería. Sin él, no se descarga inventario. */
  almacenId?: string;
  /** Pedido que se atiende. Descuenta su saldo dentro de esta transacción. */
  pedidoId?: string;
  /**
   * Autorización expresa para facturar por encima del límite de crédito.
   *
   * Vender al cliente que ya está al tope es una decisión comercial, no un
   * error de captura: a veces se autoriza y se factura igual. Por eso el sistema
   * no lo impide sin más, lo bloquea hasta que alguien lo autoriza, y entonces
   * queda dicho quién y sobre qué cifras.
   */
  autorizadoSobreLimite?: boolean;
  detraccionCodigo?: string;
  otrosCargos?: string;
  descuentoGlobal?: string;
  observaciones?: string;
};

export type VentaEmitida = {
  comprobanteId: string;
  serie: string;
  numero: string;
  total: string;
  asientoId: string;
  movimientos: string[];
};

/**
 * Emite un comprobante de venta.
 *
 * Todo ocurre en la transacción de quien llama: numeración, inventario,
 * contabilidad y documento. El envío a SUNAT **no** está aquí a propósito; se
 * hace después con `enviarASunat`.
 */
export async function emitirVenta(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosVenta,
): Promise<VentaEmitida> {
  const motivos: string[] = [];
  if (datos.lineas.length === 0) motivos.push("el comprobante necesita al menos una línea");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEmision)) motivos.push("la fecha de emisión es inválida");
  if (!money.gt(dec(datos.tipoCambio), money.ZERO)) motivos.push("el tipo de cambio debe ser positivo");
  if (motivos.length) throw new VentaInvalida(motivos);

  const cliente = await exigirCliente(db, datos.clienteId, datos.tipoDocumento);
  const lineasResueltas = await resolverLineas(db, datos.lineas);

  // El pedido se descuenta antes que nada, dentro de esta misma transacción.
  // Podría ir al final —todo se deshace igual—, pero entonces una factura que
  // excede el pedido *y* el stock se rechazaría por el stock, y el usuario
  // leería el problema equivocado.
  if (datos.pedidoId) {
    await atenderPedido(
      db,
      datos.pedidoId,
      lineasResueltas.map((l) => ({
        productoId: l.productoId ?? null,
        codigo: l.codigo,
        cantidad: l.cantidad,
      })),
    );
  }

  const totales = tributario.totalizar(
    lineasResueltas.map((l) => ({
      cantidad: dec(l.cantidad),
      valorUnitario: dec(l.valorUnitario),
      afectacion: l.afectacionIgv as tributario.Afectacion,
      ...(l.descuento ? { descuento: dec(l.descuento) } : {}),
    })),
    {
      ...(datos.otrosCargos ? { otrosCargos: dec(datos.otrosCargos) } : {}),
      ...(datos.descuentoGlobal ? { descuentoGlobal: dec(datos.descuentoGlobal) } : {}),
    },
  );

  /*
   * El límite de crédito del cliente, comprobado **antes** de tomar correlativo.
   *
   * `cabeEnElLimite` existía desde el principio, con sus pruebas, y no la
   * llamaba nadie: el límite se configuraba por cliente, se veía en su ficha y
   * en la cartera, y al facturar no se miraba. `docs/CONTRATADO.md` afirmaba que
   * «se comprueba al facturar» y no era verdad. Una simulación de un mes de
   * operaciones facturó 26 432 soles a un cliente con tope de 20 000 sin una
   * palabra.
   *
   * Va antes del correlativo a propósito: un número de serie consumido no se
   * devuelve, y ante SUNAT un salto en la numeración hay que justificarlo.
   *
   * No bloquea para siempre. Vender al cliente que está al tope es una decisión
   * comercial —a veces se autoriza y se factura igual— así que el sistema la
   * informa con las cifras y espera que alguien la tome.
   */
  if (!datos.autorizadoSobreLimite) {
    const credito = await cabeEnElLimite(db, datos.clienteId, totales.total);
    if (!credito.cabe) {
      throw new VentaInvalida([
        credito.motivo ?? "la venta supera el límite de crédito del cliente",
        `Esta venta suma ${txt2(totales.total)}. Si se autoriza igual, márquelo y vuelva a emitir.`,
      ]);
    }
  }

  // El correlativo se toma con UPDATE ... RETURNING dentro de la transacción:
  // dos facturas simultáneas no pueden recibir el mismo número, que ante SUNAT
  // es una infracción y no un detalle.
  const numero = await siguienteCorrelativo(db, datos.tipoDocumento, datos.serie);
  const periodo = datos.fechaEmision.slice(0, 4) + datos.fechaEmision.slice(5, 7);

  const detraccion = datos.detraccionCodigo
    ? await detraccionDe(db, empresaId, datos.detraccionCodigo, totales.total)
    : null;

  const [cab] = await db
    .insert(comprobantes)
    .values({
      empresaId,
      clienteId: datos.clienteId,
      tipoDocumento: datos.tipoDocumento,
      serie: datos.serie,
      numero,
      fechaEmision: datos.fechaEmision,
      horaEmision: horaEnPeru(),
      fechaVencimiento: datos.fechaVencimiento ?? null,
      periodo,
      moneda: datos.moneda,
      tipoCambio: datos.tipoCambio,
      tipoOperacion: detraccion?.aplica
        ? cpe.TIPO_OPERACION.DETRACCION
        : cpe.TIPO_OPERACION.VENTA_INTERNA,
      gravadas: txt2(totales.gravadas),
      exoneradas: txt2(totales.exoneradas),
      inafectas: txt2(totales.inafectas),
      exportacion: txt2(totales.exportacion),
      gratuitas: txt2(totales.gratuitas),
      isc: txt2(totales.isc),
      igv: txt2(totales.igv),
      igvGratuitas: txt2(totales.igvGratuitas),
      otrosCargos: datos.otrosCargos ?? "0",
      descuentoGlobal: datos.descuentoGlobal ?? "0",
      total: txt2(totales.total),
      totalEnLetras: enLetras(totales.total, datos.moneda),
      detraccionCodigo: detraccion?.aplica ? detraccion.codigo : null,
      detraccionTasa: detraccion?.aplica ? txt(detraccion.tasa) : null,
      detraccionMonto: detraccion?.aplica ? txt2(detraccion.monto) : "0",
      almacenId: datos.almacenId ?? null,
      pedidoId: datos.pedidoId ?? null,
      estado: cpe.ESTADO_CPE.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: comprobantes.id });
  const comprobanteId = cab!.id;

  // Descarga de inventario. Se hace antes del asiento porque el costo de venta
  // lo determina el kardex, y hasta aquí no se conoce.
  const movimientos: string[] = [];
  let costoVenta = money.ZERO;

  if (datos.almacenId) {
    for (const l of lineasResueltas) {
      if (!l.productoId || l.tipo !== "bien") continue;
      const mov = await registrarMovimiento(db, empresaId, {
        almacenId: datos.almacenId,
        productoId: l.productoId,
        fecha: datos.fechaEmision,
        sentido: "salida",
        tipoOperacion: kardexDominio.TIPO_OPERACION.VENTA,
        cantidad: dec(l.cantidad),
        origenModulo: "ventas",
        origenId: comprobanteId,
      });
      movimientos.push(mov.id);
      costoVenta = money.add(costoVenta, dec(mov.importeTotal));
      l.costoUnitario = mov.costoUnitario;
    }
  }

  await db.insert(comprobanteItems).values(
    lineasResueltas.map((l, i) => {
      const calc = totales.lineas[i]!;
      return {
        empresaId,
        comprobanteId,
        linea: i + 1,
        productoId: l.productoId ?? null,
        codigo: l.codigo,
        descripcion: l.descripcion,
        unidad: l.unidad,
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        precioUnitario: txt(calc.precioUnitario),
        descuento: l.descuento ?? "0",
        afectacionIgv: l.afectacionIgv,
        valorVenta: txt2(calc.valorVenta),
        igv: txt2(calc.igv),
        importeLinea: txt2(calc.importe),
        costoUnitario: l.costoUnitario ?? null,
      };
    }),
  );

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fechaEmision,
    subdiario: "14",
    glosa: `Venta ${datos.serie}-${numero} · ${cliente.razonSocial}`,
    moneda: datos.moneda,
    tipoCambio: datos.tipoCambio,
    origenModulo: "ventas",
    origenId: comprobanteId,
    lineas: lineasAsiento(await cuentasDe(db), totales, costoVenta, datos.clienteId, dec(datos.tipoCambio)),
  });

  await db.update(comprobantes).set({ asientoId }).where(eq(comprobantes.id, comprobanteId));

  return {
    comprobanteId,
    serie: datos.serie,
    numero,
    total: txt2(totales.total),
    asientoId,
    movimientos,
  };
}

/**
 * Asiento de la venta.
 *
 * Dos movimientos en uno, como manda el PCGE: la venta (cliente contra ingreso
 * e IGV) y el costo de lo vendido (costo de ventas contra existencias). Sin el
 * segundo, el estado de resultados muestra ingresos sin su costo y el margen
 * aparece disparado hasta el cierre.
 */
function lineasAsiento(
  cuentas: Cuentas,
  totales: tributario.TotalesComprobante,
  costoVenta: Dec,
  clienteId: string,
  tipoCambio: Dec,
): LineaAsientoEntrada[] {
  const lineas: LineaAsientoEntrada[] = [
    {
      cuenta: cuentas.get("clientes"),
      glosa: "Cliente",
      debe: txt2(totales.total),
      anexoId: clienteId,
    },
  ];

  if (!money.isZero(totales.igv)) {
    lineas.push({
      cuenta: cuentas.get("igv_ventas"),
      glosa: "IGV de la venta",
      haber: txt2(totales.igv),
    });
  }
  const ingreso = money.add(
    money.add(totales.gravadas, totales.exoneradas),
    money.add(totales.inafectas, totales.exportacion),
  );
  if (!money.isZero(ingreso)) {
    lineas.push({
      cuenta: cuentas.get("ventas_mercaderia"),
      glosa: "Venta de mercadería",
      haber: txt2(ingreso),
    });
  }

  // El costo de ventas ya viene en moneda funcional desde el kardex, así que se
  // pasa su equivalente explícito para no volver a convertirlo con el tipo de
  // cambio de la venta.
  if (!money.isZero(costoVenta)) {
    const enMonedaOperacion = money.isZero(tipoCambio)
      ? costoVenta
      : money.round(money.div(costoVenta, tipoCambio), 2);
    lineas.push({
      cuenta: cuentas.get("costo_ventas"),
      glosa: "Costo de ventas",
      debe: txt2(enMonedaOperacion),
      debeFuncional: txt2(costoVenta),
    });
    lineas.push({
      cuenta: cuentas.get("existencias"),
      glosa: "Salida de mercadería",
      haber: txt2(enMonedaOperacion),
      haberFuncional: txt2(costoVenta),
    });
  }

  return lineas;
}

// ─── Notas de crédito y débito ────────────────────────────────────────────

export type DatosNota = {
  /** Comprobante que la nota modifica. */
  comprobanteId: string;
  /** "07" nota de crédito, "08" nota de débito. */
  tipoDocumento: string;
  serie: string;
  fechaEmision: string;
  /** Catálogo 09 para la de crédito, catálogo 10 para la de débito. */
  motivo: string;
  descripcionMotivo: string;
  /**
   * Líneas de la nota. Si se omiten se copian las del comprobante original,
   * que es el caso de la anulación total y el más frecuente con diferencia.
   */
  lineas?: LineaVenta[];
  /**
   * Devuelve la mercadería al almacén. Sólo tiene sentido en una nota de
   * crédito por devolución: una anulación por error en el RUC no mueve stock.
   */
  devuelveMercaderia?: boolean;
};

export type NotaEmitida = VentaEmitida & { modificaA: string };

/**
 * Emite una nota de crédito o de débito.
 *
 * Una nota no corrige el comprobante original: lo deja intacto y emite un
 * documento nuevo que lo modifica. Eso es lo que exige SUNAT y también lo que
 * hace que los libros sigan cuadrando —el original ya se declaró.
 *
 * El asiento es el inverso del de la venta para la nota de crédito y el mismo
 * signo para la de débito. La devolución de mercadería es opcional y explícita:
 * hay motivos de nota de crédito que no mueven un solo artículo.
 */
export async function emitirNota(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosNota,
): Promise<NotaEmitida> {
  const esCredito = datos.tipoDocumento === cpe.TIPO_DOCUMENTO.NOTA_CREDITO;
  const motivos: string[] = [];
  if (!esCredito && datos.tipoDocumento !== cpe.TIPO_DOCUMENTO.NOTA_DEBITO) {
    motivos.push("una nota es de tipo 07 (crédito) o 08 (débito)");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEmision)) {
    motivos.push("la fecha de emisión es inválida");
  }
  if (!datos.motivo) motivos.push("indique el motivo de la nota");
  if (motivos.length) throw new VentaInvalida(motivos);

  const [original] = await db
    .select()
    .from(comprobantes)
    .where(eq(comprobantes.id, datos.comprobanteId))
    .limit(1);
  if (!original) throw new VentaInvalida(["el comprobante que se modifica no existe"]);
  if (original.tipoDocumento === cpe.TIPO_DOCUMENTO.NOTA_CREDITO ||
      original.tipoDocumento === cpe.TIPO_DOCUMENTO.NOTA_DEBITO) {
    throw new VentaInvalida(["una nota no modifica a otra nota"]);
  }
  // Un borrador todavía no se entregó a nadie: se corrige o se descarta, no se
  // le emite una nota que SUNAT rechazaría por referirse a algo que no conoce.
  if (original.estado === cpe.ESTADO_CPE.BORRADOR) {
    throw new VentaInvalida([
      "el comprobante todavía no se ha enviado a SUNAT; corríjalo en vez de emitir una nota",
    ]);
  }
  if (original.estado === "anulado") {
    throw new VentaInvalida(["el comprobante ya está anulado"]);
  }

  const cliente = await exigirCliente(db, original.clienteId, original.tipoDocumento);

  // Sin líneas propias, la nota reproduce el comprobante entero.
  const lineasNota: LineaVenta[] = datos.lineas ?? (await lineasDelOriginal(db, original.id));
  if (lineasNota.length === 0) throw new VentaInvalida(["la nota necesita al menos una línea"]);

  const lineasResueltas = await resolverLineas(db, lineasNota);
  const totales = tributario.totalizar(
    lineasResueltas.map((l) => ({
      cantidad: dec(l.cantidad),
      valorUnitario: dec(l.valorUnitario),
      afectacion: l.afectacionIgv as tributario.Afectacion,
      ...(l.descuento ? { descuento: dec(l.descuento) } : {}),
    })),
    {},
  );

  if (esCredito) {
    // Una nota de crédito no puede llevarse más de lo que queda vivo del
    // comprobante: si lo hiciera, el cliente quedaría con saldo a favor sin
    // que nadie lo haya decidido.
    const [saldo] = (await db.execute(sql`
      SELECT (c.total - coalesce((
                SELECT sum(n.total) FROM comprobantes n
                WHERE n.modifica_a = c.id AND n.tipo_documento = '07'
                  AND n.estado NOT IN ('anulado', 'rechazado')), 0))::text AS disponible
      FROM comprobantes c WHERE c.id = ${original.id}`)) as unknown as [{ disponible: string }];
    if (money.gt(totales.total, dec(saldo!.disponible))) {
      throw new VentaInvalida([
        `la nota (${txt2(totales.total)}) excede lo que queda del comprobante (${importeLegible(saldo!.disponible)})`,
      ]);
    }
  }

  const numero = await siguienteCorrelativo(db, datos.tipoDocumento, datos.serie);
  const periodo = datos.fechaEmision.slice(0, 4) + datos.fechaEmision.slice(5, 7);

  const [cab] = await db
    .insert(comprobantes)
    .values({
      empresaId,
      clienteId: original.clienteId,
      tipoDocumento: datos.tipoDocumento,
      serie: datos.serie,
      numero,
      fechaEmision: datos.fechaEmision,
      horaEmision: horaEnPeru(),
      periodo,
      // La nota hereda moneda y tipo de cambio del original: convertirla a otro
      // tipo dejaría una diferencia que nadie pidió.
      moneda: original.moneda,
      tipoCambio: original.tipoCambio,
      tipoOperacion: original.tipoOperacion,
      gravadas: txt2(totales.gravadas),
      exoneradas: txt2(totales.exoneradas),
      inafectas: txt2(totales.inafectas),
      exportacion: txt2(totales.exportacion),
      gratuitas: txt2(totales.gratuitas),
      isc: txt2(totales.isc),
      igv: txt2(totales.igv),
      igvGratuitas: txt2(totales.igvGratuitas),
      total: txt2(totales.total),
      totalEnLetras: enLetras(totales.total, original.moneda),
      modificaA: original.id,
      motivoNota: datos.motivo,
      descripcionMotivo: datos.descripcionMotivo,
      almacenId: original.almacenId,
      estado: cpe.ESTADO_CPE.BORRADOR,
      creadoPor: usuarioId,
    })
    .returning({ id: comprobantes.id });
  const notaId = cab!.id;

  // Devolución al almacén, al costo con el que salió. Reingresarla al costo
  // promedio del día inventaría un margen que no existió.
  const movimientos: string[] = [];
  let costoDevuelto = money.ZERO;
  if (esCredito && datos.devuelveMercaderia && original.almacenId) {
    const costos = await costosDelOriginal(db, original.id);
    for (const l of lineasResueltas) {
      if (!l.productoId || l.tipo !== "bien") continue;
      const costoUnitario = costos.get(l.productoId);
      if (costoUnitario === undefined) continue;
      const cantidad = dec(l.cantidad);
      const importeTotal = money.round(money.mul(cantidad, costoUnitario), 6);
      const mov = await registrarMovimiento(db, empresaId, {
        almacenId: original.almacenId,
        productoId: l.productoId,
        fecha: datos.fechaEmision,
        sentido: "ingreso",
        tipoOperacion: kardexDominio.TIPO_OPERACION.DEVOLUCION_RECIBIDA,
        cantidad,
        costoUnitario,
        importeTotal,
        origenModulo: "ventas",
        origenId: notaId,
      });
      movimientos.push(mov.id);
      costoDevuelto = money.add(costoDevuelto, dec(mov.importeTotal));
    }
  }

  await db.insert(comprobanteItems).values(
    lineasResueltas.map((l, i) => {
      const calc = totales.lineas[i]!;
      return {
        empresaId,
        comprobanteId: notaId,
        linea: i + 1,
        productoId: l.productoId ?? null,
        codigo: l.codigo,
        descripcion: l.descripcion,
        unidad: l.unidad,
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        precioUnitario: txt(calc.precioUnitario),
        descuento: l.descuento ?? "0",
        afectacionIgv: l.afectacionIgv,
        valorVenta: txt2(calc.valorVenta),
        igv: txt2(calc.igv),
        importeLinea: txt2(calc.importe),
      };
    }),
  );

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: datos.fechaEmision,
    subdiario: "14",
    glosa: `${esCredito ? "Nota de crédito" : "Nota de débito"} ${datos.serie}-${numero} sobre ${original.serie}-${original.numero} · ${cliente.razonSocial}`,
    moneda: original.moneda,
    tipoCambio: original.tipoCambio,
    origenModulo: "ventas",
    origenId: notaId,
    lineas: lineasAsientoNota(
      await cuentasDe(db),
      totales,
      costoDevuelto,
      original.clienteId,
      dec(original.tipoCambio),
      esCredito,
    ),
  });

  await db.update(comprobantes).set({ asientoId }).where(eq(comprobantes.id, notaId));

  return {
    comprobanteId: notaId,
    modificaA: original.id,
    serie: datos.serie,
    numero,
    total: txt2(totales.total),
    asientoId,
    movimientos,
  };
}

const importeLegible = (v: string): string => txt2(dec(v));

/** Las líneas del comprobante original, tal cual, para la nota total. */
async function lineasDelOriginal(db: Db, comprobanteId: string): Promise<LineaVenta[]> {
  const items = await db
    .select()
    .from(comprobanteItems)
    .where(eq(comprobanteItems.comprobanteId, comprobanteId))
    .orderBy(asc(comprobanteItems.linea));
  return items.map((i) => ({
    ...(i.productoId ? { productoId: i.productoId } : {}),
    codigo: i.codigo,
    descripcion: i.descripcion,
    unidad: i.unidad,
    cantidad: i.cantidad,
    valorUnitario: i.valorUnitario,
    ...(i.descuento && i.descuento !== "0.000000" ? { descuento: i.descuento } : {}),
    afectacionIgv: i.afectacionIgv,
  }));
}

/** Costo unitario con el que cada producto salió en la venta original. */
async function costosDelOriginal(db: Db, comprobanteId: string): Promise<Map<string, Dec>> {
  const items = await db
    .select({ productoId: comprobanteItems.productoId, costo: comprobanteItems.costoUnitario })
    .from(comprobanteItems)
    .where(eq(comprobanteItems.comprobanteId, comprobanteId));
  const mapa = new Map<string, Dec>();
  for (const i of items) {
    if (i.productoId && i.costo) mapa.set(i.productoId, dec(i.costo));
  }
  return mapa;
}

/**
 * Asiento de la nota.
 *
 * La de crédito es la venta al revés: se abona al cliente y se cargan el
 * ingreso y el IGV. La de débito repite el signo de la venta. La devolución de
 * mercadería, cuando la hay, deshace también el costo de ventas.
 */
function lineasAsientoNota(
  cuentas: Cuentas,
  totales: tributario.TotalesComprobante,
  costoDevuelto: Dec,
  clienteId: string,
  tipoCambio: Dec,
  esCredito: boolean,
): LineaAsientoEntrada[] {
  const cargo = (importe: Dec) => (esCredito ? { haber: txt2(importe) } : { debe: txt2(importe) });
  const abono = (importe: Dec) => (esCredito ? { debe: txt2(importe) } : { haber: txt2(importe) });

  const lineas: LineaAsientoEntrada[] = [
    {
      cuenta: cuentas.get("clientes"),
      glosa: "Cliente",
      anexoId: clienteId,
      ...cargo(totales.total),
    },
  ];

  if (!money.isZero(totales.igv)) {
    lineas.push({
      cuenta: cuentas.get("igv_ventas"),
      glosa: "IGV de la nota",
      ...abono(totales.igv),
    });
  }
  const ingreso = money.add(
    money.add(totales.gravadas, totales.exoneradas),
    money.add(totales.inafectas, totales.exportacion),
  );
  if (!money.isZero(ingreso)) {
    // El 709 es la cuenta de devoluciones sobre ventas; una nota de débito
    // aumenta el ingreso y vuelve a la 701.
    lineas.push({
      cuenta: esCredito
        ? cuentas.get("ventas_devoluciones")
        : cuentas.get("ventas_mercaderia"),
      glosa: esCredito ? "Devolución sobre ventas" : "Aumento del valor de la venta",
      ...abono(ingreso),
    });
  }

  if (!money.isZero(costoDevuelto)) {
    const enMonedaOperacion = money.isZero(tipoCambio)
      ? costoDevuelto
      : money.round(money.div(costoDevuelto, tipoCambio), 2);
    lineas.push({
      cuenta: cuentas.get("existencias"),
      glosa: "Reingreso de mercadería",
      debe: txt2(enMonedaOperacion),
      debeFuncional: txt2(costoDevuelto),
    });
    lineas.push({
      cuenta: cuentas.get("costo_ventas"),
      glosa: "Extorno del costo de ventas",
      haber: txt2(enMonedaOperacion),
      haberFuncional: txt2(costoDevuelto),
    });
  }

  return lineas;
}

// ─── Emisión electrónica ──────────────────────────────────────────────────

export type ResultadoEnvio = {
  estado: cpe.EstadoCpe;
  codigo: number;
  mensaje: string;
  observaciones: string[];
};

/**
 * Firma el comprobante y lo envía a SUNAT.
 *
 * Recibe la **conexión**, no una transacción, y abre las suyas. Dos razones:
 *
 * - Hablar con SUNAT puede tardar un minuto. Mantener una transacción abierta
 *   mientras tanto retiene una conexión del pool y bloquea filas sin necesidad.
 *
 * - Un rechazo hay que guardarlo. Si la escritura viviera en la transacción de
 *   quien llama y después se lanzara, el ROLLBACK se llevaría el estado y el
 *   comprobante volvería a la cola para siempre.
 *
 * Un rechazo de SUNAT **se devuelve, no se lanza**: es un resultado legítimo de
 * la operación —el comprobante no vale y hay que emitir otro— y el sistema debe
 * poder registrarlo. Sólo se lanza cuando el fallo es de la red o del servicio,
 * porque entonces no hay nada que registrar y toca reintentar.
 */
export async function enviarASunat(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  comprobanteId: string,
  kek: Uint8Array,
  opts: { fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<ResultadoEnvio> {
  // Fase 1: leer y firmar, en su propia transacción.
  const preparado = await enEmpresa(conexion, ctx, async (db) => {
    const [comp] = await db
      .select()
      .from(comprobantes)
      .where(eq(comprobantes.id, comprobanteId))
      .limit(1);
    if (!comp) throw new VentaInvalida(["el comprobante no existe"]);

    if (
      comp.estado === cpe.ESTADO_CPE.ACEPTADO ||
      comp.estado === cpe.ESTADO_CPE.ACEPTADO_CON_OBSERVACIONES
    ) {
      return {
        yaAceptado: {
          estado: comp.estado as cpe.EstadoCpe,
          codigo: comp.codigoSunat ?? 0,
          mensaje: comp.mensajeSunat ?? "ya aceptado",
          observaciones: comp.observacionesSunat ?? [],
        },
      };
    }

    const { certificado, credenciales, entorno } = await materialDeFirma(db, ctx.empresaId, kek);
    const documento = await armarComprobanteCpe(db, ctx.empresaId, comp);

    const xml = cpe.construirXml(documento);
    const firmado = cpe.firmarXml(xml, certificado, { rucEsperado: documento.emisor.ruc });
    const hash = createHash("sha256").update(firmado).digest("hex");

    await db
      .update(comprobantes)
      .set({ xmlFirmado: firmado, hashXml: hash, estado: cpe.ESTADO_CPE.FIRMADO })
      .where(eq(comprobantes.id, comprobanteId));

    return {
      envio: {
        credenciales,
        firmado,
        entorno,
        nombre: cpe.nombreCpe(documento.emisor.ruc, comp.tipoDocumento, comp.serie, comp.numero),
      },
    };
  });

  if ("yaAceptado" in preparado) return preparado.yaAceptado;
  const { credenciales, firmado, entorno, nombre } = preparado.envio;

  // Fase 2: hablar con SUNAT, fuera de toda transacción.
  let resultado: ResultadoEnvio;
  let cdrZip: Uint8Array | null = null;

  try {
    const cdr = await cpe.enviarComprobante(credenciales, nombre, firmado, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      endpoint:
        opts.endpoint ??
        (entorno === "produccion" ? cpe.ENDPOINT_PRODUCCION : cpe.ENDPOINT_BETA),
    });
    cdrZip = cdr.cdrZip;
    resultado = {
      estado: cdr.estado,
      codigo: cdr.codigo,
      mensaje: cdr.descripcion,
      observaciones: cdr.observaciones,
    };
  } catch (e) {
    if (!(e instanceof cpe.ErrorSunat)) throw e;

    // 1033: el comprobante ya está registrado en SUNAT. Ocurre al reintentar un
    // envío cuyo resultado se perdió; el comprobante está bien, e insistir sólo
    // lo dejaría en la cola para siempre.
    if (e.codigo === 1033) {
      resultado = {
        estado: cpe.ESTADO_CPE.ACEPTADO,
        codigo: 1033,
        mensaje: "ya registrado en SUNAT",
        observaciones: [],
      };
    } else if (e.reintentable) {
      // Nada que guardar: el comprobante sigue en la cola tal como estaba.
      throw e;
    } else {
      resultado = {
        estado: cpe.ESTADO_CPE.RECHAZADO,
        codigo: e.codigo,
        mensaje: e.message,
        observaciones: [],
      };
    }
  }

  // Fase 3: guardar el desenlace, en su propia transacción.
  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(comprobantes)
      .set({
        estado: resultado.estado,
        codigoSunat: resultado.codigo,
        mensajeSunat: resultado.mensaje,
        observacionesSunat: resultado.observaciones,
        ...(cdrZip ? { cdrBase64: Buffer.from(cdrZip).toString("base64") } : {}),
        enviadoEn: new Date(),
      })
      .where(eq(comprobantes.id, comprobanteId)),
  );

  return resultado;
}

/**
 * Reúne el certificado y las credenciales, descifrándolos.
 *
 * Los secretos se descifran aquí, se usan y se descartan: no se devuelven hacia
 * arriba ni se registran en ninguna parte.
 */
async function materialDeFirma(db: Db, empresaId: string, kek: Uint8Array) {
  const [cert] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .orderBy(desc(certificadosDigitales.creadoEn))
    .limit(1);
  if (!cert) {
    throw new VentaInvalida([
      "esta empresa no tiene un certificado digital cargado; súbalo antes de emitir",
    ]);
  }

  const [cred] = await db.select().from(credencialesSunat).limit(1);
  if (!cred) {
    throw new VentaInvalida([
      "faltan las credenciales SOL de esta empresa para enviar a SUNAT",
    ]);
  }

  const contexto = `empresa:${empresaId}:certificado`;
  const pfx = abrir(kek, cert.pfxCifrado as SobreCifrado, contexto);
  const password = new TextDecoder().decode(
    abrir(kek, cert.passwordCifrado as SobreCifrado, contexto),
  );
  const claveSol = new TextDecoder().decode(
    abrir(kek, cred.claveCifrada as SobreCifrado, `empresa:${empresaId}:sol`),
  );

  const [emp] = await db.select({ ruc: empresas.ruc }).from(empresas).limit(1);

  return {
    certificado: cpe.abrirPfx(pfx, password),
    credenciales: {
      ruc: emp?.ruc ?? "",
      usuarioSol: cred.usuarioSol,
      claveSol,
    },
    entorno: cred.entorno,
  };
}

/** Traduce el comprobante almacenado a la forma que espera el generador de XML. */
async function armarComprobanteCpe(
  db: Db,
  _empresaId: string,
  comp: typeof comprobantes.$inferSelect,
): Promise<cpe.ComprobanteCpe> {
  const [emp] = await db.select().from(empresas).limit(1);
  const [cli] = await db.select().from(terceros).where(eq(terceros.id, comp.clienteId)).limit(1);
  if (!emp || !cli) throw new VentaInvalida(["faltan datos del emisor o del cliente"]);

  const items = await db
    .select()
    .from(comprobanteItems)
    .where(eq(comprobanteItems.comprobanteId, comp.id))
    .orderBy(asc(comprobanteItems.linea));

  // Una nota tiene que decir a qué comprobante se refiere; sin esto el XML no
  // se construye siquiera.
  const [modificado] = comp.modificaA
    ? await db
        .select({
          tipoDocumento: comprobantes.tipoDocumento,
          serie: comprobantes.serie,
          numero: comprobantes.numero,
        })
        .from(comprobantes)
        .where(eq(comprobantes.id, comp.modificaA))
        .limit(1)
    : [];

  return {
    tipoDocumento: comp.tipoDocumento as cpe.TipoDocumento,
    serie: comp.serie,
    numero: comp.numero,
    fechaEmision: comp.fechaEmision,
    ...(comp.horaEmision ? { horaEmision: comp.horaEmision } : {}),
    ...(comp.fechaVencimiento ? { fechaVencimiento: comp.fechaVencimiento } : {}),
    moneda: comp.moneda,
    tipoOperacion: comp.tipoOperacion,
    emisor: {
      ruc: emp.ruc,
      razonSocial: emp.razonSocial,
      ...(emp.nombreComercial ? { nombreComercial: emp.nombreComercial } : {}),
      ...(emp.ubigeo ? { ubigeo: emp.ubigeo } : {}),
      ...(emp.direccion ? { direccion: emp.direccion } : {}),
    },
    receptor: {
      tipoDocumento: cli.tipoDocumento,
      numeroDocumento: cli.numeroDocumento,
      razonSocial: cli.razonSocial,
      ...(cli.direccion ? { direccion: cli.direccion } : {}),
    },
    lineas: items.map((it) => ({
      numero: it.linea,
      codigo: it.codigo,
      descripcion: it.descripcion,
      unidad: it.unidad,
      cantidad: dec(it.cantidad),
      valorUnitario: dec(it.valorUnitario),
      precioUnitario: dec(it.precioUnitario),
      afectacion: it.afectacionIgv,
      valorVenta: dec(it.valorVenta),
      igv: dec(it.igv),
      // La tasa se deduce de la propia línea en vez de asumir el 18 %: una
      // factura antigua reimpresa debe llevar la tasa que tuvo, no la de hoy.
      tasaIgv: money.isZero(dec(it.valorVenta))
        ? money.ZERO
        : money.round(money.div(dec(it.igv), dec(it.valorVenta)), 6),
    })),
    gravadas: dec(comp.gravadas),
    exoneradas: dec(comp.exoneradas),
    inafectas: dec(comp.inafectas),
    exportacion: dec(comp.exportacion),
    gratuitas: dec(comp.gratuitas),
    igv: dec(comp.igv),
    isc: dec(comp.isc),
    otrosCargos: dec(comp.otrosCargos),
    descuentoGlobal: dec(comp.descuentoGlobal),
    total: dec(comp.total),
    ...(comp.totalEnLetras ? { totalEnLetras: comp.totalEnLetras } : {}),
    ...(modificado
      ? {
          notaModificada: {
            tipoDocumento: modificado.tipoDocumento,
            serie: modificado.serie,
            numero: modificado.numero,
            motivo: comp.motivoNota ?? "",
            descripcionMotivo: comp.descripcionMotivo ?? "",
          },
        }
      : {}),
    ...(comp.detraccionCodigo
      ? {
          detraccion: {
            codigo: comp.detraccionCodigo,
            cuenta: "", // la cuenta del Banco de la Nación se configura por empresa
            porcentaje: dec(comp.detraccionTasa),
            monto: dec(comp.detraccionMonto),
          },
        }
      : {}),
  };
}

// ─── Auxiliares ───────────────────────────────────────────────────────────

/**
 * Toma el siguiente correlativo de la serie.
 *
 * El `UPDATE ... RETURNING` bloquea la fila hasta que la transacción cierra, de
 * modo que dos ventas simultáneas sobre la misma serie se serializan. Numerar
 * con `max + 1` dejaría hueco a que ambas leyeran el mismo número.
 */
async function siguienteCorrelativo(
  db: Db,
  tipoDocumento: string,
  serie: string,
): Promise<string> {
  const filas = (await db.execute(sql`
    UPDATE series_documento
    SET correlativo = correlativo + 1
    WHERE tipo_documento = ${tipoDocumento} AND serie = ${serie} AND activa
    RETURNING correlativo`)) as unknown as { correlativo: number }[];

  const fila = filas[0];
  if (!fila) {
    throw new VentaInvalida([
      `la serie ${serie} no está registrada para el tipo de documento ${tipoDocumento}`,
    ]);
  }
  return String(fila.correlativo).padStart(8, "0");
}

async function exigirCliente(db: Db, clienteId: string, tipoDocumento: string) {
  const [c] = await db.select().from(terceros).where(eq(terceros.id, clienteId)).limit(1);
  if (!c) throw new VentaInvalida(["el cliente no existe en esta empresa"]);
  if (!c.esCliente) throw new VentaInvalida([`${c.razonSocial} no está marcado como cliente`]);

  // Una factura exige RUC; una boleta admite DNI o incluso ningún documento por
  // debajo de S/ 700. Es la regla que más facturas rebota en SUNAT.
  if (tipoDocumento === cpe.TIPO_DOCUMENTO.FACTURA && c.tipoDocumento !== "6") {
    throw new VentaInvalida([
      `${c.razonSocial} no tiene RUC: emita una boleta, o registre su RUC para facturarle`,
    ]);
  }
  return c;
}

/** Completa cada línea con los datos del producto cuando no vienen explícitos. */
async function resolverLineas(db: Db, lineas: LineaVenta[]) {
  const resueltas: {
    productoId?: string;
    codigo: string;
    descripcion: string;
    unidad: string;
    cantidad: string;
    valorUnitario: string;
    descuento?: string;
    afectacionIgv: string;
    tipo: string;
    costoUnitario?: string;
  }[] = [];

  for (const [i, l] of lineas.entries()) {
    if (!l.productoId) {
      if (!l.descripcion) {
        throw new VentaInvalida([`línea ${i + 1}: indique un producto o una descripción`]);
      }
      resueltas.push({
        codigo: l.codigo ?? "SERV",
        descripcion: l.descripcion,
        unidad: l.unidad ?? "ZZ",
        cantidad: l.cantidad,
        valorUnitario: l.valorUnitario,
        ...(l.descuento ? { descuento: l.descuento } : {}),
        afectacionIgv: l.afectacionIgv ?? "10",
        tipo: "servicio",
      });
      continue;
    }

    const [p] = await db
      .select({
        codigo: productos.codigo,
        descripcion: productos.descripcion,
        tipo: productos.tipo,
        afectacion: productos.afectacionIgv,
        unidad: unidadesMedida.codigo,
      })
      .from(productos)
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
      .where(eq(productos.id, l.productoId))
      .limit(1);
    if (!p) throw new VentaInvalida([`línea ${i + 1}: el producto no existe en esta empresa`]);

    resueltas.push({
      productoId: l.productoId,
      codigo: l.codigo ?? p.codigo,
      descripcion: l.descripcion ?? p.descripcion,
      unidad: l.unidad ?? p.unidad,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      ...(l.descuento ? { descuento: l.descuento } : {}),
      afectacionIgv: l.afectacionIgv ?? p.afectacion,
      tipo: p.tipo,
    });
  }
  return resueltas;
}

async function detraccionDe(db: Db, empresaId: string, codigo: string, total: Dec) {
  const [regla] = await db
    .select()
    .from(s.reglasDetraccion)
    .where(eq(s.reglasDetraccion.codigo, codigo))
    .orderBy(desc(s.reglasDetraccion.vigenteDesde))
    .limit(1);
  if (!regla) throw new VentaInvalida([`el código de detracción ${codigo} no está configurado`]);

  const [emp] = await db
    .select({ redondeo: empresas.redondeoDetraccion })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);

  return tributario.calcularDetraccion(
    total,
    {
      codigo: regla.codigo,
      descripcion: regla.descripcion,
      tasa: dec(regla.tasa),
      aplicaMinimo: regla.aplicaMinimo,
    },
    { redondeo: emp?.redondeo === "arriba" ? "arriba" : "cercano" },
  );
}

const UNIDADES_TEXTO = [
  "", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE",
];
const DECENAS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

/**
 * Importe en letras.
 *
 * SUNAT lo exige en la representación impresa. Se implementa aquí y no con una
 * dependencia porque las reglas del español —«veintiuno» junto, «ciento» pero
 * «cien», «un mil» y no «uno mil»— son más cortas de escribir que de configurar
 * en una librería genérica.
 */
export function enLetras(monto: Dec, moneda: string): string {
  const entero = Number(money.toString(money.trunc(monto, 0), 0));
  const centimos = money.toString(money.sub(monto, money.trunc(monto, 0)), 2).replace("0.", "");
  const nombre = moneda === "USD" ? "DÓLARES AMERICANOS" : moneda === "EUR" ? "EUROS" : "SOLES";
  return `${aTexto(entero)} CON ${centimos}/100 ${nombre}`;
}

function aTexto(n: number): string {
  if (n === 0) return "CERO";
  if (n < 0) return `MENOS ${aTexto(-n)}`;
  if (n <= 20) return UNIDADES_TEXTO[n]!;
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return DECENAS[d]!;
    return d === 2 ? `VEINTI${UNIDADES_TEXTO[u]!.toLowerCase().toUpperCase()}` : `${DECENAS[d]} Y ${UNIDADES_TEXTO[u]}`;
  }
  if (n === 100) return "CIEN";
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? CENTENAS[c]! : `${CENTENAS[c]} ${aTexto(r)}`;
  }
  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const r = n % 1000;
    const prefijo = miles === 1 ? "MIL" : `${aTexto(miles)} MIL`;
    return r === 0 ? prefijo : `${prefijo} ${aTexto(r)}`;
  }
  const millones = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  const prefijo = millones === 1 ? "UN MILLÓN" : `${aTexto(millones)} MILLONES`;
  return r === 0 ? prefijo : `${prefijo} ${aTexto(r)}`;
}

// ─── Consultas ────────────────────────────────────────────────────────────

export const listarVentas = (db: Db, periodo?: string) =>
  db
    .select({
      id: comprobantes.id,
      tipoDocumento: comprobantes.tipoDocumento,
      serie: comprobantes.serie,
      numero: comprobantes.numero,
      cliente: terceros.razonSocial,
      documentoCliente: terceros.numeroDocumento,
      fechaEmision: comprobantes.fechaEmision,
      moneda: comprobantes.moneda,
      gravadas: comprobantes.gravadas,
      igv: comprobantes.igv,
      total: comprobantes.total,
      estado: comprobantes.estado,
      codigoSunat: comprobantes.codigoSunat,
      mensajeSunat: comprobantes.mensajeSunat,
    })
    .from(comprobantes)
    .innerJoin(terceros, eq(terceros.id, comprobantes.clienteId))
    .where(periodo ? eq(comprobantes.periodo, periodo) : undefined)
    .orderBy(desc(comprobantes.fechaEmision), desc(comprobantes.numero))
    .limit(500);

/** Comprobantes pendientes de informar a SUNAT, para la cola de envíos. */
export const pendientesDeEnvio = (db: Db) =>
  db
    .select({ id: comprobantes.id, serie: comprobantes.serie, numero: comprobantes.numero })
    .from(comprobantes)
    .where(
      and(
        sql`${comprobantes.estado} IN ('borrador', 'firmado', 'enviado')`,
        sql`${comprobantes.tipoDocumento} IN ('01', '07', '08')`,
      ),
    )
    .orderBy(asc(comprobantes.fechaEmision))
    .limit(100);

export async function cargarComprobante(db: Db, id: string) {
  const [cabecera] = await db.select().from(comprobantes).where(eq(comprobantes.id, id)).limit(1);
  if (!cabecera) throw new VentaInvalida(["el comprobante no existe"]);
  const items = await db
    .select()
    .from(comprobanteItems)
    .where(eq(comprobanteItems.comprobanteId, id))
    .orderBy(asc(comprobanteItems.linea));
  const [cliente] = await db
    .select()
    .from(terceros)
    .where(eq(terceros.id, cabecera.clienteId))
    .limit(1);
  return { cabecera, items, cliente };
}

export { cpe };
