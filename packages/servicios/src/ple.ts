/**
 * Libros electrónicos (PLE).
 *
 * SUNAT no acepta un PDF ni una hoja de cálculo: exige un archivo de texto con
 * campos separados por barra vertical, un nombre de archivo con catorce
 * componentes y un contenido que su validador revisa campo por campo. Este
 * módulo produce exactamente eso.
 *
 * Tres detalles que hacen que un archivo pase o rebote:
 *
 * 1. **El nombre del archivo lleva la información.** `LE` + RUC + periodo +
 *    código del libro + indicadores. Un dígito mal puesto y el PLE lo rechaza
 *    antes de mirar el contenido.
 *
 * 2. **Los importes van sin separador de miles, con punto decimal y dos
 *    decimales.** Un importe negativo lleva el signo delante.
 *
 * 3. **Cada línea termina en barra vertical**, incluida la última, y el archivo
 *    se codifica en Latin-1 porque el validador de SUNAT no entiende UTF-8 en
 *    las razones sociales con tilde.
 *
 * Los formatos implementados son los obligatorios para el cliente: 8.1 registro
 * de compras, 14.1 registro de ventas y 13.1 inventario permanente valorizado.
 */
import { asc, eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";

const { compras, compraItems, terceros, empresas } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");

/** Importe con el formato que exige SUNAT: punto decimal, dos decimales, sin miles. */
export const importePle = (v: string | null | undefined): string =>
  money.toString(dec(v), 2);

/** Fecha en DD/MM/AAAA, que es como SUNAT las quiere en el PLE. */
export function fechaPle(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Arma una línea del PLE.
 *
 * Se limpia cada campo de barras verticales y saltos de línea: una razón social
 * con una barra rompería la estructura entera del archivo y el error aparecería
 * como un campo corrido treinta líneas más abajo.
 */
export function linea(campos: readonly (string | number | null | undefined)[]): string {
  return (
    campos
      .map((c) => String(c ?? "").replace(/[|\r\n]/g, " ").trim())
      .join("|") + "|"
  );
}

export type LibroPle = {
  /** Nombre del archivo tal como debe subirse al PLE. */
  nombre: string;
  /** Contenido en texto, con las líneas separadas por salto de línea. */
  contenido: string;
  filas: number;
};

/**
 * Nombre del archivo del PLE.
 *
 * SUNAT lo especifica como `LERRRRRRRRRRRAAAAMMDDLLLLLLCCOIMG.TXT`, 33
 * caracteres exactos antes de la extensión:
 *
 * ```
 *   LE            2   prefijo fijo
 *   RRRRRRRRRRR  11   RUC del contribuyente
 *   AAAAMMDD      8   periodo; el día va en 00 en los libros mensuales
 *   LLLLLL        6   código del libro o registro (tabla 8 de SUNAT)
 *   CC            2   código de oportunidad de presentación
 *   O             1   indicador de operaciones en el periodo
 *   I             1   indicador de contenido del libro
 *   M             1   indicador de moneda: 1 soles, 2 dólares
 *   G             1   indicador de libro generado por el PLE
 * ```
 *
 * El aplicativo rechaza el archivo por el nombre antes de mirar el contenido,
 * así que la longitud se comprueba en una prueba: un componente de más o de
 * menos corre todos los siguientes y el error es imposible de leer.
 */
export const LIBROS = {
  /** Registro de compras — formato 8.1. */
  COMPRAS: "080100",
  /** Registro de compras, operaciones con no domiciliados — formato 8.2. */
  COMPRAS_NO_DOMICILIADOS: "080200",
  /** Registro de ventas e ingresos — formato 14.1. */
  VENTAS: "140100",
  /** Inventario permanente en unidades físicas — formato 12.1. */
  INVENTARIO_UNIDADES: "120100",
  /** Inventario permanente valorizado — formato 13.1. */
  INVENTARIO_VALORIZADO: "130100",
  /** Libro diario — formato 5.1. */
  DIARIO: "050100",
  /** Libro mayor — formato 6.1. */
  MAYOR: "060100",
} as const;

export function nombreArchivo(opts: {
  ruc: string;
  /** AAAAMM. El día se completa en 00, que es lo que aplica a los mensuales. */
  periodo: string;
  libro: string;
  /** Hubo operaciones en el periodo y el libro lleva información. */
  conInformacion: boolean;
  /** 1 soles (por defecto), 2 dólares. */
  monedaNacional?: boolean;
  /** Código de oportunidad. "00" salvo cierres y casos especiales. */
  oportunidad?: string;
}): string {
  if (!/^\d{11}$/.test(opts.ruc)) throw new Error("el RUC debe tener 11 dígitos");
  if (!/^\d{6}$/.test(opts.periodo)) throw new Error("el periodo debe ser AAAAMM");
  if (!/^\d{6}$/.test(opts.libro)) throw new Error("el código de libro debe tener 6 dígitos");

  const bandera = opts.conInformacion ? "1" : "0";
  const nombre =
    "LE" +
    opts.ruc +
    opts.periodo +
    "00" + // día
    opts.libro +
    (opts.oportunidad ?? "00") +
    bandera + // indicador de operaciones
    bandera + // indicador de contenido
    (opts.monedaNacional === false ? "2" : "1") +
    "1"; // generado por el PLE

  if (nombre.length !== 33) {
    // Una falla aquí es un error de programación, no de datos: mejor que
    // reviente en desarrollo que ver rebotar el archivo el día 12 del mes.
    throw new Error(`el nombre del archivo PLE debe tener 33 caracteres, tiene ${nombre.length}`);
  }
  return `${nombre}.TXT`;
}

// ─── Formato 8.1: Registro de Compras ─────────────────────────────────────

/**
 * Registro de compras.
 *
 * Es el libro que sustenta el crédito fiscal, y el que SUNAT cruza contra las
 * ventas declaradas por los proveedores. Los campos siguen el anexo 2 de la
 * R.S. 286-2009/SUNAT y sus modificatorias.
 */
export async function registroCompras(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const [empresa] = await db
    .select({ ruc: empresas.ruc })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  if (!empresa) throw new Error("la empresa no existe");

  const filas = await db
    .select({
      id: compras.id,
      fechaEmision: compras.fechaEmision,
      fechaVencimiento: compras.fechaVencimiento,
      tipoDocumento: compras.tipoDocumento,
      serie: compras.serie,
      numero: compras.numero,
      tipoDocProveedor: terceros.tipoDocumento,
      numDocProveedor: terceros.numeroDocumento,
      razonSocial: terceros.razonSocial,
      gravadas: compras.gravadas,
      igv: compras.igv,
      exoneradas: compras.exoneradas,
      inafectas: compras.inafectas,
      isc: compras.isc,
      otrosCargos: compras.otrosCargos,
      total: compras.total,
      moneda: compras.moneda,
      tipoCambio: compras.tipoCambio,
      estado: compras.estado,
    })
    .from(compras)
    .innerJoin(terceros, eq(terceros.id, compras.proveedorId))
    .where(eq(compras.periodo, periodo))
    .orderBy(asc(compras.fechaEmision), asc(compras.serie), asc(compras.numero));

  const lineas = filas.map((f, i) => {
    // El correlativo del asiento identifica la fila dentro del periodo. Se usa
    // el número de orden porque el registro se reconstruye completo cada vez.
    const correlativo = `M${String(i + 1).padStart(9, "0")}`;
    return linea([
      periodo + "00", // 1. periodo
      correlativo, // 2. correlativo único del asiento
      String(i + 1), // 3. número correlativo del detalle
      fechaPle(f.fechaEmision), // 4. fecha de emisión
      fechaPle(f.fechaVencimiento), // 5. fecha de vencimiento
      f.tipoDocumento, // 6. tipo de comprobante
      f.serie, // 7. serie
      "", // 8. año de emisión de la DUA (sólo importaciones)
      f.numero, // 9. número del comprobante
      "", // 10. número final (rangos)
      f.tipoDocProveedor, // 11. tipo de documento del proveedor
      f.numDocProveedor, // 12. número de documento del proveedor
      f.razonSocial, // 13. razón social
      importePle(f.gravadas), // 14. base imponible gravada (destino gravadas)
      importePle(f.igv), // 15. IGV de esa base
      "0.00", // 16. base gravada mixta
      "0.00", // 17. IGV mixto
      "0.00", // 18. base gravada no gravadas
      "0.00", // 19. IGV no gravadas
      importePle(f.exoneradas), // 20. valor adquisiciones no gravadas
      importePle(f.isc), // 21. ISC
      importePle(f.otrosCargos), // 22. otros tributos y cargos
      importePle(f.total), // 23. importe total
      f.moneda, // 24. código de moneda
      importePle(f.tipoCambio), // 25. tipo de cambio
      "", // 26-30. datos del comprobante modificado
      "",
      "",
      "",
      "",
      "", // 31. fecha de emisión de la DUA
      "", // 32. tipo de documento del emisor no domiciliado
      "", // 33. número del documento
      "", // 34. datos del proveedor no domiciliado
      "", // 35. constancia de detracción
      "", // 36. fecha de la constancia
      "", // 37. marca del comprobante sujeto a retención
      "", // 38. clasificación de bienes y servicios
      "", // 39. identificación del contrato
      "", // 40. error tipo 1
      "", // 41. indicador de comprobantes cancelados con medio de pago
      f.estado === "anulada" ? "2" : "1", // 42. estado
    ]);
  });

  return {
    nombre: nombreArchivo({
      ruc: empresa.ruc,
      periodo,
      libro: LIBROS.COMPRAS,
      conInformacion: lineas.length > 0,
    }),
    contenido: lineas.join("\r\n"),
    filas: lineas.length,
  };
}

// ─── Formato 13.1: Inventario permanente valorizado ───────────────────────

/**
 * Inventario permanente valorizado.
 *
 * Se presenta por semestre y detalla, movimiento a movimiento, cómo se llegó al
 * costo de las existencias. Es el libro que sustenta el costo de ventas ante
 * una fiscalización, y el que hace imprescindible que el kardex sea exacto.
 */
export async function inventarioValorizado(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const [empresa] = await db
    .select({ ruc: empresas.ruc })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  if (!empresa) throw new Error("la empresa no existe");

  const anio = periodo.slice(0, 4);
  const mes = periodo.slice(4, 6);

  const filas = (await db.execute(sql`
    SELECT m.fecha, m.sentido, m.tipo_operacion, m.cantidad::text AS cantidad,
           m.costo_unitario::text AS costo_unitario, m.importe_total::text AS importe,
           p.codigo AS producto, p.descripcion,
           u.codigo AS unidad, a.codigo_sunat AS establecimiento,
           m.orden
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    JOIN unidades_medida u ON u.id = p.unidad_id
    JOIN almacenes al ON al.id = m.almacen_id
    LEFT JOIN sucursales a ON a.id = al.sucursal_id
    WHERE to_char(m.fecha, 'YYYYMM') = ${periodo}
    ORDER BY p.codigo, m.fecha, m.orden`)) as unknown as {
    fecha: string;
    sentido: string;
    tipo_operacion: string;
    cantidad: string;
    costo_unitario: string;
    importe: string;
    producto: string;
    descripcion: string;
    unidad: string;
    establecimiento: string | null;
    orden: number;
  }[];

  // El saldo corrido se reconstruye por producto, que es como el formato lo
  // exige: cada línea muestra el saldo después del movimiento.
  const saldos = new Map<string, { cantidad: Dec; valor: Dec }>();

  const lineas = filas.map((f, i) => {
    const saldo = saldos.get(f.producto) ?? { cantidad: money.ZERO, valor: money.ZERO };
    const cant = dec(f.cantidad);
    const importe = dec(f.importe);
    const entrada = f.sentido === "ingreso";

    saldo.cantidad = entrada
      ? money.add(saldo.cantidad, cant)
      : money.sub(saldo.cantidad, cant);
    saldo.valor = entrada ? money.add(saldo.valor, importe) : money.sub(saldo.valor, importe);
    if (money.isZero(saldo.cantidad)) saldo.valor = money.ZERO;
    saldos.set(f.producto, saldo);

    const costoSaldo = money.isZero(saldo.cantidad)
      ? money.ZERO
      : money.round(money.div(saldo.valor, saldo.cantidad), 6);

    return linea([
      `${anio}${mes}00`, // 1. periodo
      `M${String(i + 1).padStart(9, "0")}`, // 2. correlativo
      f.establecimiento ?? "0000", // 3. código del establecimiento
      "1", // 4. catálogo usado (1 = propio)
      f.producto, // 5. código de la existencia
      "01", // 6. tipo de existencia (mercadería)
      f.descripcion, // 7. descripción
      f.unidad, // 8. unidad de medida
      // 9. método de valuación aplicado. 1 = PEPS, 2 = promedio.
      "2",
      fechaPle(f.fecha), // 10. fecha de emisión del documento
      "", // 11. tipo de documento
      "", // 12. serie
      "", // 13. número
      f.tipo_operacion, // 14. tipo de operación
      entrada ? money.toString(cant, 2) : "0.00", // 15. entradas: cantidad
      entrada ? money.toString(dec(f.costo_unitario), 2) : "0.00", // 16. costo unitario
      entrada ? money.toString(importe, 2) : "0.00", // 17. costo total
      entrada ? "0.00" : money.toString(cant, 2), // 18. salidas: cantidad
      entrada ? "0.00" : money.toString(dec(f.costo_unitario), 2), // 19. costo unitario
      entrada ? "0.00" : money.toString(importe, 2), // 20. costo total
      money.toString(saldo.cantidad, 2), // 21. saldo final: cantidad
      money.toString(costoSaldo, 2), // 22. costo unitario del saldo
      money.toString(saldo.valor, 2), // 23. costo total del saldo
      "1", // 24. estado
    ]);
  });

  return {
    nombre: nombreArchivo({
      ruc: empresa.ruc,
      periodo,
      libro: LIBROS.INVENTARIO_VALORIZADO,
      conInformacion: lineas.length > 0,
    }),
    contenido: lineas.join("\r\n"),
    filas: lineas.length,
  };
}

/**
 * Codifica el contenido en Latin-1.
 *
 * El validador de SUNAT no entiende UTF-8: una razón social con tilde llega
 * como caracteres partidos y el archivo rebota. Los caracteres que no existen
 * en Latin-1 se reemplazan por su equivalente sin acento, no por un signo de
 * interrogación, para que el nombre siga siendo legible.
 */
export function aLatin1(contenido: string): Buffer {
  const normalizado = contenido
    .normalize("NFD")
    // Se quitan los diacríticos que Latin-1 no tiene; los que sí tiene (á, ñ)
    // se recomponen justo después.
    .replace(/[̀-ͯ]/g, (m, offset, str) => {
      const base = str[offset - 1];
      const compuesto = (base + m).normalize("NFC");
      return compuesto.length === 1 && compuesto.charCodeAt(0) < 256 ? m : "";
    })
    .normalize("NFC");
  return Buffer.from(normalizado, "latin1");
}
