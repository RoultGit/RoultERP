/**
 * Saldos de apertura: lo que se trae del sistema anterior el día del cambio.
 *
 * El cliente eligió la opción b del cuestionario —traer sólo los saldos, no el
 * histórico—, que es también lo que se recomienda: el histórico se consulta en
 * Starsoft, que no se apaga, y lo que hace falta aquí es poder cobrar lo que
 * deben, pagar lo que se debe y saber qué hay en el almacén.
 *
 * Tres decisiones lo gobiernan, y las tres están para evitar errores caros:
 *
 * **Lo migrado no entra en los libros.** Las facturas que quedaron por cobrar
 * ya se declararon en Starsoft. Vuelven a este sistema porque el cliente las
 * debe, no porque haya que declararlas: van marcadas con `esApertura`, y el
 * registro de ventas, el PLE 14.1 y la liquidación del PDT las excluyen. Sin
 * esa marca, la empresa pagaría dos veces el IGV de toda su cartera.
 *
 * **Se analiza antes de escribir, y se escribe una sola vez.** La apertura no
 * es una operación repetible: cargarla dos veces duplica la cartera y el stock.
 * El análisis no toca la base, y el registro se niega si ya hay una apertura
 * hecha.
 *
 * **El asiento cuadra o no hay apertura.** Lo que no cuadre por sí solo va a la
 * cuenta de contrapartida —el patrimonio con el que la empresa empieza aquí— y
 * la cifra se enseña **antes** de confirmar. Un descuadre silencioso en el
 * asiento de apertura contamina todos los estados financieros del ejercicio y
 * no se encuentra nunca.
 */
import { inArray, sql } from "drizzle-orm";
import { ErrorDeNegocio, money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { asentar } from "./contabilidad.ts";
import { cuentasDe } from "./parametros.ts";
import { registrarMovimiento } from "./inventario.ts";

const { comprobantes, documentosCxp, terceros, productos, almacenes } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

type LineaApertura = {
  cuenta: string;
  debe?: string;
  haber?: string;
  glosa: string;
  anexoId?: string;
  documento?: { tipo: string; serie: string; numero: string; fecha: string };
};

export class AperturaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "AperturaInvalida");
  }
}

/**
 * Estado de un comprobante traído de otro sistema.
 *
 * No es ninguno de los del camino hacia SUNAT, porque un documento migrado no
 * está en ninguno: nunca se envía. Tenerlo aparte lo deja fuera de la cola de
 * emisión electrónica sin depender de la bandera, y la bandera lo deja fuera de
 * los libros sin depender del estado. Cada guarda vale por sí sola.
 */
export const ESTADO_MIGRADO = "migrado";

// ─── Lectura de las hojas ─────────────────────────────────────────────────

export const COLUMNAS_CXC = [
  "tipoDocumento", "serie", "numero", "rucCliente",
  "fechaEmision", "fechaVencimiento", "moneda", "tipoCambio", "saldo",
] as const;

export const COLUMNAS_CXP = [
  "tipoDocumento", "serie", "numero", "rucProveedor",
  "fechaEmision", "fechaVencimiento", "moneda", "tipoCambio", "saldo",
] as const;

export const COLUMNAS_STOCK = ["codigoProducto", "codigoAlmacen", "cantidad", "costoUnitario"] as const;

/** Tabulaciones (pegado desde Excel) o punto y coma. */
const celdas = (linea: string): string[] => {
  const sep = linea.includes("\t") ? "\t" : ";";
  return linea.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
};

/**
 * Normaliza una cifra escrita a la peruana.
 *
 * Un Excel en español escribe `1.234,56`; uno en inglés, `1,234.56`. Adivinar
 * mal convierte mil doscientos treinta y cuatro soles en uno con veintitrés, y
 * eso pasa el resto de validaciones sin quejarse. La regla: el último separador
 * que aparece es el decimal.
 */
function cifra(v: string): string {
  const t = v.replace(/\s|S\/|US\$|\$/g, "");
  if (t === "") return "0";
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  if (coma === -1 && punto === -1) return t;
  const decimal = coma > punto ? "," : ".";
  const miles = decimal === "," ? "." : ",";
  return t.split(miles).join("").replace(decimal, ".");
}

/** Acepta AAAA-MM-DD y DD/MM/AAAA, y comprueba que la fecha exista de verdad. */
function fechaIso(v: string): string | null {
  const t = v.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(t)
    ? t
    : (() => {
        const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
        return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
      })();
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const esDecimal = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

function filasDe(texto: string, columnas: readonly string[], primeraEsFecha: boolean) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lineas.length === 0) return [];
  // Una cabecera pegada por error se descarta sola.
  const cabecera = primeraEsFecha
    ? fechaIso(celdas(lineas[0]!)[0] ?? "") === null
    : !/^\d/.test(celdas(lineas[0]!)[2] ?? "");
  return (cabecera ? lineas.slice(1) : lineas).map((l, i) => {
    const c = celdas(l);
    const campos: Record<string, string> = {};
    columnas.forEach((n, j) => (campos[n] = c[j] ?? ""));
    return { linea: i + 1, campos };
  });
}

// ─── Análisis ─────────────────────────────────────────────────────────────

export type FilaApertura = {
  linea: number;
  campos: Record<string, string>;
  /** Cliente, proveedor o producto resuelto contra el maestro. */
  refId: string | null;
  refNombre: string | null;
  /** Equivalente en soles. Es lo que va al asiento. */
  soles: string;
  problemas: readonly string[];
};

export type AnalisisApertura = {
  cxc: readonly FilaApertura[];
  cxp: readonly FilaApertura[];
  stock: readonly FilaApertura[];
  totales: { cxc: string; cxp: string; stock: string };
  /** Lo que hace falta para que el asiento cuadre. Con signo. */
  contrapartida: string;
  cuentaContrapartida: string;
  problemas: number;
  /** Ya se cargó una apertura antes; volver a hacerlo duplicaría todo. */
  yaCargada: boolean;
  /** Documentos que faltan en el maestro, una vez cada uno. */
  faltantes: { terceros: readonly string[]; productos: readonly string[]; almacenes: readonly string[] };
};

export type HojasApertura = { cxc?: string; cxp?: string; stock?: string };

/**
 * Lee las tres hojas y dice, fila por fila, qué entendió y qué no.
 *
 * No escribe nada. Quien va a volcar la cartera entera de la empresa tiene que
 * ver el cuadro antes, porque una apertura mal cargada no se corrige: se borra
 * y se vuelve a empezar, y para entonces ya hay cobranzas encima.
 */
export async function analizarApertura(
  db: Db,
  _empresaId: string,
  hojas: HojasApertura,
): Promise<AnalisisApertura> {
  const cxcCrudas = filasDe(hojas.cxc ?? "", COLUMNAS_CXC, false);
  const cxpCrudas = filasDe(hojas.cxp ?? "", COLUMNAS_CXP, false);
  const stockCrudas = filasDe(hojas.stock ?? "", COLUMNAS_STOCK, false);
  if (!cxcCrudas.length && !cxpCrudas.length && !stockCrudas.length) {
    throw new AperturaInvalida(["pegue al menos una de las tres hojas"]);
  }

  const cuentas = await cuentasDe(db);

  // Todo lo que hay que resolver contra el maestro, en tres consultas.
  const docs = [
    ...cxcCrudas.map((f) => f.campos["rucCliente"]!),
    ...cxpCrudas.map((f) => f.campos["rucProveedor"]!),
  ].filter(Boolean);
  const porDoc = new Map(
    (docs.length
      ? await db
          .select({ id: terceros.id, doc: terceros.numeroDocumento, razon: terceros.razonSocial,
                    esCliente: terceros.esCliente, esProveedor: terceros.esProveedor })
          .from(terceros)
          .where(inArray(terceros.numeroDocumento, [...new Set(docs)]))
      : []
    ).map((t) => [t.doc, t]),
  );

  const codigosProd = [...new Set(stockCrudas.map((f) => f.campos["codigoProducto"]!).filter(Boolean))];
  const porProducto = new Map(
    (codigosProd.length
      ? await db
          .select({ id: productos.id, codigo: productos.codigo, descripcion: productos.descripcion,
                    tipo: productos.tipo })
          .from(productos)
          .where(inArray(productos.codigo, codigosProd))
      : []
    ).map((p) => [p.codigo, p]),
  );

  const codigosAlm = [...new Set(stockCrudas.map((f) => f.campos["codigoAlmacen"]!).filter(Boolean))];
  const porAlmacen = new Map(
    (codigosAlm.length
      ? await db
          .select({ id: almacenes.id, codigo: almacenes.codigo })
          .from(almacenes)
          .where(inArray(almacenes.codigo, codigosAlm))
      : []
    ).map((a) => [a.codigo, a.id]),
  );

  const TIPOS = new Set(["01", "03", "07", "08", "12", "14"]);

  const revisarDocumento = (
    { linea, campos }: { linea: number; campos: Record<string, string> },
    clave: "rucCliente" | "rucProveedor",
    papel: "cliente" | "proveedor",
  ): FilaApertura => {
    const problemas: string[] = [];
    const tipo = (campos["tipoDocumento"] || "01").padStart(2, "0");
    if (!TIPOS.has(tipo)) problemas.push(`tipo de documento «${campos["tipoDocumento"]}»`);
    if (!campos["serie"]) problemas.push("falta la serie");
    if (!campos["numero"]) problemas.push("falta el número");

    const t = porDoc.get(campos[clave] ?? "");
    if (!campos[clave]) problemas.push(`falta el documento del ${papel}`);
    else if (!t) problemas.push(`${campos[clave]} no está en el maestro de terceros`);
    else if (papel === "cliente" && !t.esCliente) problemas.push(`${t.razon} no está marcado como cliente`);
    else if (papel === "proveedor" && !t.esProveedor) problemas.push(`${t.razon} no está marcado como proveedor`);

    const emision = fechaIso(campos["fechaEmision"] ?? "");
    if (!emision) problemas.push("la fecha de emisión no se entiende");
    const vence = campos["fechaVencimiento"] ? fechaIso(campos["fechaVencimiento"]) : emision;
    if (campos["fechaVencimiento"] && !vence) problemas.push("la fecha de vencimiento no se entiende");

    const moneda = (campos["moneda"] || "PEN").toUpperCase();
    const tc = cifra(campos["tipoCambio"] || "1");
    if (!esDecimal(tc) || money.lte(dec(tc), money.ZERO)) problemas.push("tipo de cambio inválido");
    if (moneda !== "PEN" && tc === "1") {
      problemas.push("un saldo en moneda extranjera necesita su tipo de cambio");
    }

    const saldo = cifra(campos["saldo"] ?? "");
    if (!esDecimal(saldo)) problemas.push("el saldo no es un número");
    else if (!money.gt(dec(saldo), money.ZERO)) {
      // Un saldo cero no es una deuda, y uno negativo es un anticipo, que no se
      // migra como documento sino como saldo a favor.
      problemas.push("el saldo debe ser mayor que cero");
    }

    return {
      linea,
      campos,
      refId: t?.id ?? null,
      refNombre: t?.razon ?? null,
      soles: esDecimal(saldo) && esDecimal(tc) ? txt2(money.mul(dec(saldo), dec(tc))) : "0.00",
      problemas,
    };
  };

  const cxc = cxcCrudas.map((f) => revisarDocumento(f, "rucCliente", "cliente"));
  const cxp = cxpCrudas.map((f) => revisarDocumento(f, "rucProveedor", "proveedor"));

  const stock = stockCrudas.map(({ linea, campos }): FilaApertura => {
    const problemas: string[] = [];
    const p = porProducto.get(campos["codigoProducto"] ?? "");
    if (!campos["codigoProducto"]) problemas.push("falta el código del producto");
    else if (!p) problemas.push(`el producto ${campos["codigoProducto"]} no existe`);
    else if (p.tipo !== "bien") problemas.push(`${p.codigo} es un servicio y no tiene stock`);

    const almacenId = porAlmacen.get(campos["codigoAlmacen"] ?? "");
    if (!campos["codigoAlmacen"]) problemas.push("falta el código del almacén");
    else if (!almacenId) problemas.push(`el almacén ${campos["codigoAlmacen"]} no existe`);

    const cantidad = cifra(campos["cantidad"] ?? "");
    const costo = cifra(campos["costoUnitario"] ?? "");
    if (!esDecimal(cantidad) || !money.gt(dec(cantidad), money.ZERO)) {
      problemas.push("la cantidad debe ser mayor que cero");
    }
    if (!esDecimal(costo) || !money.gt(dec(costo), money.ZERO)) {
      // Un costo cero entra al kardex y arrastra el promedio a cero: toda la
      // mercadería de ese producto pasa a costar nada y el costo de ventas
      // desaparece del estado de resultados.
      problemas.push("el costo unitario debe ser mayor que cero");
    }

    return {
      linea,
      campos,
      refId: p?.id ?? null,
      refNombre: p?.descripcion ?? null,
      soles:
        esDecimal(cantidad) && esDecimal(costo) ? txt2(money.mul(dec(cantidad), dec(costo))) : "0.00",
      problemas,
    };
  });

  const suma = (filas: readonly FilaApertura[]) =>
    money.sum(filas.filter((f) => f.problemas.length === 0).map((f) => dec(f.soles)));
  const totalCxc = suma(cxc);
  const totalCxp = suma(cxp);
  const totalStock = suma(stock);

  // Activo (cartera + almacén) menos pasivo (proveedores). Lo que queda es el
  // patrimonio con el que la empresa empieza en este sistema.
  const contrapartida = money.sub(money.add(totalCxc, totalStock), totalCxp);

  const [{ hay }] = (await db.execute(
    sql`SELECT EXISTS (SELECT 1 FROM comprobantes WHERE es_apertura) AS hay`,
  )) as unknown as [{ hay: boolean }];

  return {
    cxc,
    cxp,
    stock,
    totales: { cxc: txt2(totalCxc), cxp: txt2(totalCxp), stock: txt2(totalStock) },
    contrapartida: txt2(contrapartida),
    cuentaContrapartida: cuentas.get("apertura_contrapartida"),
    problemas: [...cxc, ...cxp, ...stock].filter((f) => f.problemas.length > 0).length,
    yaCargada: hay,
    faltantes: {
      terceros: [
        ...new Set(
          [...cxcCrudas.map((f) => f.campos["rucCliente"]!), ...cxpCrudas.map((f) => f.campos["rucProveedor"]!)]
            .filter((d) => d && !porDoc.has(d)),
        ),
      ],
      productos: codigosProd.filter((c) => !porProducto.has(c)),
      almacenes: codigosAlm.filter((c) => !porAlmacen.has(c)),
    },
  };
}

// ─── Registro ─────────────────────────────────────────────────────────────

export type ResultadoApertura = {
  cxc: number;
  cxp: number;
  stock: number;
  asientoId: string;
  totales: { cxc: string; cxp: string; stock: string; contrapartida: string };
};

/**
 * Carga los saldos. Todo en una transacción, y una sola vez.
 *
 * Aquí sí es todo o nada, al revés que en la carga en serie de compras: una
 * apertura a medias —la cartera cargada y el almacén no— deja el balance
 * descuadrado desde el primer día, y el asiento de apertura es uno solo. Si una
 * fila falla, no hay apertura y se corrige la hoja.
 *
 * Se niega a correr dos veces. Cargarla de nuevo duplicaría la cartera entera y
 * el stock, y para cuando alguien lo note ya habrá cobranzas encima.
 */
export async function registrarApertura(
  db: Db,
  empresaId: string,
  usuarioId: string,
  hojas: HojasApertura,
  opciones: { fecha: string; glosa?: string },
): Promise<ResultadoApertura> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opciones.fecha)) {
    throw new AperturaInvalida(["indique la fecha de corte"]);
  }

  const a = await analizarApertura(db, empresaId, hojas);
  if (a.yaCargada) {
    throw new AperturaInvalida([
      "ya hay una apertura cargada en esta empresa; cargarla otra vez duplicaría la cartera y el stock",
    ]);
  }
  if (a.problemas > 0) {
    const primeros = [...a.cxc, ...a.cxp, ...a.stock]
      .filter((f) => f.problemas.length)
      .slice(0, 5)
      .map((f) => `línea ${f.linea}: ${f.problemas[0]}`);
    throw new AperturaInvalida([
      `hay ${a.problemas} filas con problemas; la apertura es todo o nada`,
      ...primeros,
    ]);
  }

  const periodo = opciones.fecha.slice(0, 4) + opciones.fecha.slice(5, 7);
  const cuentas = await cuentasDe(db);
  const glosa = opciones.glosa?.trim() || `Saldos de apertura al ${opciones.fecha}`;

  // ── Cuentas por cobrar ───────────────────────────────────────────────
  for (const f of a.cxc) {
    const tc = cifra(f.campos["tipoCambio"] || "1");
    const saldo = cifra(f.campos["saldo"]!);
    await db.insert(comprobantes).values({
      empresaId,
      clienteId: f.refId!,
      tipoDocumento: (f.campos["tipoDocumento"] || "01").padStart(2, "0"),
      serie: f.campos["serie"]!,
      numero: f.campos["numero"]!,
      fechaEmision: fechaIso(f.campos["fechaEmision"]!)!,
      fechaVencimiento: f.campos["fechaVencimiento"]
        ? fechaIso(f.campos["fechaVencimiento"])
        : fechaIso(f.campos["fechaEmision"]!),
      periodo,
      moneda: (f.campos["moneda"] || "PEN").toUpperCase(),
      tipoCambio: tc,
      /*
       * El saldo va como total, y no el importe original de la factura.
       *
       * Lo que se migra es lo que queda por cobrar, no la venta: sus cobranzas
       * parciales ocurrieron en Starsoft y no existen aquí. Poner el importe
       * original dejaría al cliente debiendo lo que ya pagó.
       *
       * Las bases quedan en cero a propósito: no hay IGV que declarar en un
       * documento que ya se declaró allá, y así ninguna consulta fiscal que se
       * escriba mañana puede sumarlo por descuido.
       */
      gravadas: "0",
      igv: "0",
      exoneradas: "0",
      inafectas: "0",
      exportacion: "0",
      isc: "0",
      otrosCargos: "0",
      total: saldo,
      estado: ESTADO_MIGRADO,
      esApertura: true,
      creadoPor: usuarioId,
    });
  }

  // ── Cuentas por pagar ────────────────────────────────────────────────
  //
  // Van directas a su tabla: el registro de compras y el PLE 8.1 leen
  // `compras`, no ésta, así que un saldo migrado no puede colarse en los libros
  // ni tomar un crédito fiscal que ya se tomó allá.
  for (const f of a.cxp) {
    const saldo = cifra(f.campos["saldo"]!);
    await db.insert(documentosCxp).values({
      empresaId,
      proveedorId: f.refId!,
      tipoDocumento: (f.campos["tipoDocumento"] || "01").padStart(2, "0"),
      serie: f.campos["serie"]!,
      numero: f.campos["numero"]!,
      fechaEmision: fechaIso(f.campos["fechaEmision"]!)!,
      fechaVencimiento:
        (f.campos["fechaVencimiento"] ? fechaIso(f.campos["fechaVencimiento"]) : null) ??
        fechaIso(f.campos["fechaEmision"]!)!,
      moneda: (f.campos["moneda"] || "PEN").toUpperCase(),
      tipoCambio: cifra(f.campos["tipoCambio"] || "1"),
      total: saldo,
      saldo,
      estado: "pendiente",
      creadoPor: usuarioId,
    });
  }

  // ── Stock ────────────────────────────────────────────────────────────
  const porCodigoAlmacen = new Map(
    (await db.select({ id: almacenes.id, codigo: almacenes.codigo }).from(almacenes)).map((x) => [
      x.codigo,
      x.id,
    ]),
  );
  for (const f of a.stock) {
    await registrarMovimiento(db, empresaId, {
      almacenId: porCodigoAlmacen.get(f.campos["codigoAlmacen"]!)!,
      productoId: f.refId!,
      fecha: opciones.fecha,
      sentido: "ingreso",
      tipoOperacion: "saldo_apertura",
      cantidad: money.dec(cifra(f.campos["cantidad"]!)),
      costoUnitario: money.dec(cifra(f.campos["costoUnitario"]!)),
      origenModulo: "apertura",
    });
  }

  // ── El asiento ───────────────────────────────────────────────────────
  //
  // Activo al debe, pasivo al haber, y la diferencia contra el patrimonio con
  // el que la empresa empieza aquí. No es una operación del ejercicio: no toca
  // ventas, ni compras, ni resultado.
  const totalStock = dec(a.totales.stock);
  const contrapartida = dec(a.contrapartida);

  /*
   * Una línea por documento, no una suma por cuenta.
   *
   * La 1212 y la 4212 exigen tercero y documento de referencia en el plan, y con
   * razón: la cuenta corriente por anexo es lo que el contador mira cuando un
   * cliente reclama. Un único apunte de «clientes» por el total dejaría esa
   * consulta diciendo que nadie debe nada y el saldo colgando de la nada.
   */
  const lineas: LineaApertura[] = [];
  for (const f of a.cxc) {
    lineas.push({
      cuenta: cuentas.get("clientes"),
      debe: f.soles,
      glosa: `${f.refNombre} · ${f.campos["serie"]}-${f.campos["numero"]}`,
      anexoId: f.refId!,
      documento: {
        tipo: (f.campos["tipoDocumento"] || "01").padStart(2, "0"),
        serie: f.campos["serie"]!,
        numero: f.campos["numero"]!,
        fecha: fechaIso(f.campos["fechaEmision"]!)!,
      },
    });
  }
  for (const f of a.cxp) {
    lineas.push({
      cuenta: cuentas.get("proveedores"),
      haber: f.soles,
      glosa: `${f.refNombre} · ${f.campos["serie"]}-${f.campos["numero"]}`,
      anexoId: f.refId!,
      documento: {
        tipo: (f.campos["tipoDocumento"] || "01").padStart(2, "0"),
        serie: f.campos["serie"]!,
        numero: f.campos["numero"]!,
        fecha: fechaIso(f.campos["fechaEmision"]!)!,
      },
    });
  }
  // El almacén sí va en un solo apunte: la existencia no se lleva por tercero,
  // y el detalle por producto ya está en el kardex.
  if (!money.isZero(totalStock)) {
    lineas.push({ cuenta: cuentas.get("existencias"), debe: txt2(totalStock), glosa });
  }
  if (!money.isZero(contrapartida)) {
    const cuenta = cuentas.get("apertura_contrapartida");
    lineas.push(
      money.gt(contrapartida, money.ZERO)
        ? { cuenta, haber: txt2(contrapartida), glosa }
        : { cuenta, debe: txt2(money.neg(contrapartida)), glosa },
    );
  }
  if (lineas.length === 0) throw new AperturaInvalida(["no hay nada que cargar"]);

  const asientoId = await asentar(db, empresaId, usuarioId, {
    periodo,
    fecha: opciones.fecha,
    // Subdiario de operaciones diversas: la apertura no es compra ni venta.
    subdiario: "08",
    glosa,
    moneda: "PEN",
    tipoCambio: "1",
    origenModulo: "apertura",
    lineas,
  });

  return {
    cxc: a.cxc.length,
    cxp: a.cxp.length,
    stock: a.stock.length,
    asientoId,
    totales: { ...a.totales, contrapartida: a.contrapartida },
  };
}
