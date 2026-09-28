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
 * Las estructuras salen del Anexo 2 de la R.S. 286-2009/SUNAT y sus
 * modificatorias, contrastadas campo por campo contra el archivo oficial
 * "Estructura del PLE.xls" (PLE 5.0.0, febrero de 2021). Cada formato lleva su
 * número de campos en una constante y una prueba que lo comprueba: un campo de
 * más o de menos corre todos los siguientes y el rechazo llega sin explicación.
 *
 * Los campos de libre utilización que cada formato define al final se omiten a
 * propósito. La propia estructura lo autoriza: "en caso de no tener la
 * necesidad de utilizarlos, no incluya ni la información ni el separador".
 */
import { eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";

const { empresas } = s;

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

// ─── Piezas comunes ───────────────────────────────────────────────────────

/**
 * Número de campos de cada formato, sin contar los de libre utilización.
 *
 * Está aquí y no disperso en cada función porque es lo que se verifica: cada
 * generador comprueba que cada línea tenga exactamente estos campos antes de
 * devolverla. El PLE rechaza el archivo sin decir en qué campo se corrió todo.
 */
export const CAMPOS = {
  DIARIO: 21,
  MAYOR: 21,
  COMPRAS: 42,
  COMPRAS_NO_DOMICILIADOS: 36,
  INVENTARIO_UNIDADES: 19,
  INVENTARIO_VALORIZADO: 27,
  VENTAS: 35,
} as const;

/** El periodo AAAAMM00 con el que abre cada línea. */
const periodoPle = (periodo: string): string => `${periodo}00`;

const periodoDe = (iso: string): string => iso.slice(0, 4) + iso.slice(5, 7);

/**
 * Estado de la anotación (campo final de casi todos los formatos).
 *
 * `1` la operación es del periodo, `8` es de un periodo anterior y no se anotó
 * entonces. El `9` —anotada antes y ahora rectificada— no se puede deducir de
 * los datos: quien rectifica lo sabe, el generador no.
 */
const estadoAnotacion = (fecha: string, periodo: string): string =>
  periodoDe(fecha) < periodo ? "8" : "1";

/**
 * Estado del registro de compras, que tiene su propia tabla.
 *
 * `1` se anota en el periodo de emisión; `6` la emisión es anterior pero la
 * anotación cae dentro de los doce meses siguientes; `7` pasados esos doce
 * meses, momento en que la compra deja de dar derecho a crédito fiscal.
 */
function estadoCompra(fechaEmision: string, periodo: string): string {
  const emision = periodoDe(fechaEmision);
  if (emision >= periodo) return "1";
  const mesesTranscurridos =
    (Number(periodo.slice(0, 4)) - Number(emision.slice(0, 4))) * 12 +
    (Number(periodo.slice(4)) - Number(emision.slice(4)));
  return mesesTranscurridos <= 12 ? "6" : "7";
}

/**
 * Número correlativo del asiento contable.
 *
 * El primer dígito tiene que ser A, M o C: apertura, movimiento del mes o
 * cierre. Se deduce del origen del asiento en vez de pedírselo al usuario.
 */
const correlativoAsiento = (numero: string, origen: string | null): string =>
  `${origen === "cierre_ejercicio" ? "C" : origen === "apertura" ? "A" : "M"}${numero}`;

/** Comprueba la estructura antes de entregarla. Ver el comentario de CAMPOS. */
function verificar(lineas: string[], campos: number, formato: string): void {
  for (const [i, l] of lineas.entries()) {
    // Cada línea termina en barra, así que hay una posición vacía de más.
    const encontrados = l.split("|").length - 1;
    if (encontrados !== campos) {
      throw new Error(
        `formato ${formato}: la línea ${i + 1} tiene ${encontrados} campos y debe tener ${campos}`,
      );
    }
  }
}

async function rucDe(db: Db, empresaId: string): Promise<string> {
  const [empresa] = await db
    .select({ ruc: empresas.ruc })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  if (!empresa) throw new Error("la empresa no existe");
  return empresa.ruc;
}

function armar(opts: {
  ruc: string;
  periodo: string;
  libro: string;
  campos: number;
  formato: string;
  lineas: string[];
}): LibroPle {
  verificar(opts.lineas, opts.campos, opts.formato);
  return {
    nombre: nombreArchivo({
      ruc: opts.ruc,
      periodo: opts.periodo,
      libro: opts.libro,
      conInformacion: opts.lineas.length > 0,
    }),
    contenido: opts.lineas.join("\r\n"),
    filas: opts.lineas.length,
  };
}

// ─── Formato 8.1: Registro de Compras ─────────────────────────────────────

/**
 * Registro de compras.
 *
 * Es el libro que sustenta el crédito fiscal, y el que SUNAT cruza contra las
 * ventas declaradas por los proveedores. Cuarenta y dos campos: los importes
 * van en tres pares de columnas según el destino de la adquisición —gravadas,
 * mixtas, no gravadas—, y este generador imputa todo al primero porque el
 * cliente no lleva prorrata.
 */

export type FilaRegistroCompras = {
  id: string; fecha_emision: string; fecha_vencimiento: string | null;
  tipo_documento: string; serie: string; numero: string;
  tipo_doc_proveedor: string; num_doc_proveedor: string; razon_social: string;
  gravadas: string; igv: string; exoneradas: string; inafectas: string;
  isc: string; otros_cargos: string; total: string; moneda: string;
  tipo_cambio: string; detraccion_constancia: string | null;
  detraccion_fecha: string | null; estado: string;
  asiento: string | null; origen_modulo: string | null;
};

/**
 * Las filas del registro de compras de un periodo.
 *
 * Está aparte porque la usan dos cosas: el archivo del PLE y el registro que se
 * mira en pantalla. Con dos consultas parecidas, el día que una cambie el
 * contador tendría dos registros de compras distintos del mismo mes y ninguna
 * forma de saber cuál vale.
 */
export async function filasRegistroCompras(
  db: Db,
  periodo: string,
): Promise<FilaRegistroCompras[]> {
  const filas = (await db.execute(sql`
    SELECT c.id, c.fecha_emision::text AS fecha_emision,
           c.fecha_vencimiento::text AS fecha_vencimiento,
           c.tipo_documento, c.serie, c.numero,
           t.tipo_documento AS tipo_doc_proveedor, t.numero_documento AS num_doc_proveedor,
           t.razon_social,
           c.gravadas::text AS gravadas, c.igv::text AS igv,
           c.exoneradas::text AS exoneradas, c.inafectas::text AS inafectas,
           c.isc::text AS isc, c.otros_cargos::text AS otros_cargos,
           c.total::text AS total, c.moneda, c.tipo_cambio::text AS tipo_cambio,
           c.detraccion_constancia, c.detraccion_fecha::text AS detraccion_fecha,
           c.estado, a.numero AS asiento, a.origen_modulo
    FROM compras c
    JOIN terceros t ON t.id = c.proveedor_id
    LEFT JOIN asientos a ON a.id = c.asiento_id
    WHERE c.periodo = ${periodo}
    ORDER BY c.fecha_emision, c.serie, c.numero`)) as unknown as FilaRegistroCompras[];
  return [...filas];
}

export type FilaRegistroVentas = {
  fecha_emision: string; fecha_vencimiento: string | null;
  tipo_documento: string; serie: string; numero: string;
  tipo_doc_cliente: string; num_doc_cliente: string; razon_social: string;
  exportacion: string; gravadas: string; igv: string; exoneradas: string;
  inafectas: string; isc: string; otros_cargos: string; total: string;
  moneda: string; tipo_cambio: string; estado: string;
  fecha_original: string | null; tipo_original: string | null;
  serie_original: string | null; numero_original: string | null;
  asiento: string | null; origen_modulo: string | null;
};

/** Las filas del registro de ventas de un periodo. Misma razón que el de compras. */
export async function filasRegistroVentas(
  db: Db,
  periodo: string,
): Promise<FilaRegistroVentas[]> {
  const filas = (await db.execute(sql`
    SELECT c.fecha_emision::text AS fecha_emision,
           c.fecha_vencimiento::text AS fecha_vencimiento,
           c.tipo_documento, c.serie, c.numero,
           t.tipo_documento AS tipo_doc_cliente, t.numero_documento AS num_doc_cliente,
           t.razon_social,
           c.exportacion::text AS exportacion, c.gravadas::text AS gravadas,
           c.igv::text AS igv, c.exoneradas::text AS exoneradas,
           c.inafectas::text AS inafectas, c.isc::text AS isc,
           c.otros_cargos::text AS otros_cargos, c.total::text AS total,
           c.moneda, c.tipo_cambio::text AS tipo_cambio, c.estado,
           o.fecha_emision::text AS fecha_original, o.tipo_documento AS tipo_original,
           o.serie AS serie_original, o.numero AS numero_original,
           a.numero AS asiento, a.origen_modulo
    FROM comprobantes c
    JOIN terceros t ON t.id = c.cliente_id
    LEFT JOIN comprobantes o ON o.id = c.modifica_a
    LEFT JOIN asientos a ON a.id = c.asiento_id
    WHERE c.periodo = ${periodo} AND c.estado <> 'borrador'
      -- Los saldos migrados no entran: esas ventas ya se declararon en el
      -- sistema anterior, y volver a declararlas paga dos veces su IGV.
      AND NOT c.es_apertura
    ORDER BY c.tipo_documento, c.serie, c.numero`)) as unknown as FilaRegistroVentas[];
  return [...filas];
}

export async function registroCompras(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);

  const filas = await filasRegistroCompras(db, periodo);

  const lineas = [...filas].map((f, i) => {
    const cuo = f.asiento ?? String(i + 1).padStart(6, "0");
    // Lo inafecto y lo exonerado comparten la columna 20: SUNAT la define como
    // "valor de las adquisiciones no gravadas", sin distinguir entre ambas.
    const noGravadas = money.add(dec(f.exoneradas), dec(f.inafectas));

    return linea([
      periodoPle(periodo), // 1
      cuo, // 2 código único de la operación
      correlativoAsiento(cuo, f.origen_modulo), // 3
      fechaPle(f.fecha_emision), // 4
      fechaPle(f.fecha_vencimiento), // 5
      f.tipo_documento, // 6
      f.serie, // 7
      "", // 8 año de emisión de la DUA
      f.numero, // 9
      "", // 10 número final, sólo al consolidar operaciones diarias
      f.tipo_doc_proveedor, // 11
      f.num_doc_proveedor, // 12
      f.razon_social, // 13
      importePle(f.gravadas), // 14 base gravada destinada a gravadas
      importePle(f.igv), // 15
      "0.00", // 16 base gravada de destino mixto
      "0.00", // 17
      "0.00", // 18 base gravada destinada a no gravadas
      "0.00", // 19
      money.toString(noGravadas, 2), // 20
      importePle(f.isc), // 21
      "0.00", // 22 impuesto al consumo de bolsas de plástico
      importePle(f.otros_cargos), // 23
      importePle(f.total), // 24
      f.moneda, // 25
      money.toString(dec(f.tipo_cambio), 3), // 26
      "", // 27-31 comprobante que se modifica
      "",
      "",
      "", // 30 código de dependencia aduanera
      "",
      fechaPle(f.detraccion_fecha), // 32
      f.detraccion_constancia ?? "", // 33
      "", // 34 marca de comprobante sujeto a retención
      "", // 35 clasificación de bienes y servicios
      "", // 36 identificación del contrato o proyecto
      "", // 37-40 marcas de error que asigna SUNAT, no el contribuyente
      "",
      "",
      "",
      "", // 41 cancelado con medio de pago
      f.estado === "anulada" ? "9" : estadoCompra(f.fecha_emision, periodo), // 42
    ]);
  });

  return armar({ ruc, periodo, libro: LIBROS.COMPRAS, campos: CAMPOS.COMPRAS, formato: "8.1", lineas });
}

// ─── Formato 8.2: Compras a no domiciliados ───────────────────────────────

/**
 * Registro de compras con sujetos no domiciliados.
 *
 * Va aparte del 8.1 porque una factura del exterior no da crédito fiscal y sí
 * puede generar retención de renta de fuente peruana. Es el libro que sustenta
 * las importaciones de servicios y las compras al exterior.
 */
export async function comprasNoDomiciliados(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);

  const filas = (await db.execute(sql`
    SELECT c.fecha_emision::text AS fecha_emision, c.tipo_documento, c.serie, c.numero,
           c.gravadas::text AS gravadas, c.otros_cargos::text AS otros_cargos,
           c.total::text AS total, c.moneda, c.tipo_cambio::text AS tipo_cambio,
           t.pais, t.razon_social, t.direccion, t.numero_documento,
           a.numero AS asiento, a.origen_modulo
    FROM compras c
    JOIN terceros t ON t.id = c.proveedor_id
    LEFT JOIN asientos a ON a.id = c.asiento_id
    WHERE c.periodo = ${periodo} AND t.es_domiciliado = false
    ORDER BY c.fecha_emision, c.serie, c.numero`)) as unknown as {
    fecha_emision: string; tipo_documento: string; serie: string; numero: string;
    gravadas: string; otros_cargos: string; total: string; moneda: string;
    tipo_cambio: string; pais: string; razon_social: string;
    direccion: string | null; numero_documento: string;
    asiento: string | null; origen_modulo: string | null;
  }[];

  const lineas = [...filas].map((f, i) => {
    const cuo = f.asiento ?? String(i + 1).padStart(6, "0");
    return linea([
      periodoPle(periodo), // 1
      cuo, // 2
      correlativoAsiento(cuo, f.origen_modulo), // 3
      fechaPle(f.fecha_emision), // 4
      // Sólo admite 00, 91, 97 y 98. Una factura del exterior es "91".
      "91", // 5
      f.serie, // 6
      f.numero, // 7
      importePle(f.gravadas), // 8 valor de las adquisiciones
      importePle(f.otros_cargos), // 9
      importePle(f.total), // 10
      "", // 11-14 comprobante que sustenta el crédito fiscal: no lo hay
      "",
      "",
      "",
      "0.00", // 15 retención del IGV
      f.moneda, // 16
      money.toString(dec(f.tipo_cambio), 3), // 17
      f.pais, // 18
      f.razon_social, // 19
      f.direccion ?? "", // 20
      f.numero_documento, // 21
      "", // 22-25 beneficiario efectivo y vínculo: se declaran si los hay
      "",
      "",
      "",
      "0.00", // 26 renta bruta
      "0.00", // 27 deducción
      "0.00", // 28 renta neta
      "0.00", // 29 tasa de retención
      "0.00", // 30 impuesto retenido
      "00", // 31 convenio de doble imposición (tabla 25): sin convenio
      "", // 32 exoneración aplicada
      "", // 33 tipo de renta
      "", // 34 modalidad del servicio
      "", // 35 penúltimo párrafo del art. 76 de la Ley del IR
      // Este formato sólo admite 0 y 9: la anotación es optativa y sin efecto
      // en el IGV, así que del periodo es siempre '0'.
      periodoDe(f.fecha_emision) < periodo ? "9" : "0", // 36
    ]);
  });

  return armar({
    ruc, periodo,
    libro: LIBROS.COMPRAS_NO_DOMICILIADOS,
    campos: CAMPOS.COMPRAS_NO_DOMICILIADOS,
    formato: "8.2",
    lineas,
  });
}

// ─── Formato 14.1: Registro de Ventas ─────────────────────────────────────

/**
 * Registro de ventas e ingresos.
 *
 * Incluye las notas de crédito y débito del periodo, que llevan en los campos
 * 28 al 31 el comprobante que modifican. El importe de una nota de crédito va
 * en positivo: es el estado y el tipo de documento lo que le dan el signo, no
 * la cifra.
 */
export async function registroVentas(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);

  const filas = await filasRegistroVentas(db, periodo);

  const lineas = [...filas].map((f, i) => {
    const cuo = f.asiento ?? String(i + 1).padStart(6, "0");
    return linea([
      periodoPle(periodo), // 1
      cuo, // 2
      correlativoAsiento(cuo, f.origen_modulo), // 3
      fechaPle(f.fecha_emision), // 4
      fechaPle(f.fecha_vencimiento), // 5
      f.tipo_documento, // 6
      f.serie, // 7
      f.numero, // 8
      "", // 9 número final, sólo al consolidar tickets
      f.tipo_doc_cliente, // 10
      f.num_doc_cliente, // 11
      f.razon_social, // 12
      importePle(f.exportacion), // 13
      importePle(f.gravadas), // 14
      "0.00", // 15 descuento de la base imponible
      importePle(f.igv), // 16
      "0.00", // 17 descuento del IGV
      importePle(f.exoneradas), // 18
      importePle(f.inafectas), // 19
      importePle(f.isc), // 20
      "0.00", // 21 base del IVAP: arroz pilado, que este cliente no vende
      "0.00", // 22
      "0.00", // 23 impuesto al consumo de bolsas de plástico
      importePle(f.otros_cargos), // 24
      importePle(f.total), // 25
      f.moneda, // 26
      money.toString(dec(f.tipo_cambio), 3), // 27
      fechaPle(f.fecha_original), // 28
      f.tipo_original ?? "", // 29
      f.serie_original ?? "", // 30
      f.numero_original ?? "", // 31
      "", // 32 identificación del contrato o proyecto
      "", // 33 error tipo 1, que asigna SUNAT
      "", // 34 cancelado con medio de pago
      // Un comprobante anulado antes de entregarse se declara con '2'.
      f.estado === "anulado" ? "2" : estadoAnotacion(f.fecha_emision, periodo), // 35
    ]);
  });

  return armar({ ruc, periodo, libro: LIBROS.VENTAS, campos: CAMPOS.VENTAS, formato: "14.1", lineas });
}

// ─── Formatos 5.1 y 6.1: Libro Diario y Libro Mayor ───────────────────────

type FilaAsiento = {
  numero: string;
  cuenta: string;
  centro_costo: string | null;
  moneda: string;
  tipo_doc_tercero: string | null;
  num_doc_tercero: string | null;
  documento_tipo: string | null;
  documento_serie: string | null;
  documento_numero: string | null;
  fecha: string;
  documento_fecha: string | null;
  glosa_asiento: string;
  glosa: string | null;
  debe: string;
  haber: string;
  origen_modulo: string | null;
};

/**
 * Filas del diario y del mayor.
 *
 * Los dos formatos tienen exactamente los mismos veintiún campos; lo único que
 * cambia es el orden en que se presentan las líneas. Compartir la consulta
 * evita que uno se corrija y el otro se quede atrás.
 */
async function lineasDelLibro(
  db: Db,
  periodo: string,
  orden: "asiento" | "cuenta",
): Promise<string[]> {
  const criterio =
    orden === "cuenta"
      ? sql`l.cuenta, a.numero, l.linea`
      : sql`a.numero, l.linea`;

  const filas = (await db.execute(sql`
    SELECT a.numero, l.cuenta, cc.codigo AS centro_costo, a.moneda,
           t.tipo_documento AS tipo_doc_tercero, t.numero_documento AS num_doc_tercero,
           l.documento_tipo, l.documento_serie, l.documento_numero,
           a.fecha::text AS fecha, l.documento_fecha::text AS documento_fecha,
           a.glosa AS glosa_asiento, l.glosa,
           l.debe_funcional::text AS debe, l.haber_funcional::text AS haber,
           a.origen_modulo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    LEFT JOIN centros_costo cc ON cc.id = l.centro_costo_id
    LEFT JOIN terceros t ON t.id = l.anexo_id
    WHERE a.periodo = ${periodo} AND a.estado <> 'borrador'
    ORDER BY ${criterio}`)) as unknown as FilaAsiento[];

  return [...filas].map((f) =>
    linea([
      periodoPle(periodo), // 1
      f.numero, // 2 código único de la operación
      correlativoAsiento(f.numero, f.origen_modulo), // 3
      f.cuenta, // 4
      "", // 5 unidad de operación
      f.centro_costo ?? "", // 6
      f.moneda, // 7
      f.tipo_doc_tercero ?? "", // 8
      f.num_doc_tercero ?? "", // 9
      f.documento_tipo ?? "", // 10
      f.documento_serie ?? "", // 11
      f.documento_numero ?? "", // 12
      fechaPle(f.fecha), // 13 fecha contable
      "", // 14 fecha de vencimiento
      fechaPle(f.documento_fecha ?? f.fecha), // 15 fecha de la operación
      f.glosa_asiento, // 16
      f.glosa ?? "", // 17
      // El libro se lleva en moneda funcional, que es la que declara: el
      // importe en la moneda de origen ya vive en el propio asiento.
      importePle(f.debe), // 18
      importePle(f.haber), // 19
      "", // 20 dato estructurado que enlaza con el registro de ventas o compras
      estadoAnotacion(f.fecha, periodo), // 21
    ]),
  );
}

/** Libro diario: los asientos del periodo, en orden de asiento y línea. */
export async function libroDiario(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);
  const lineas = await lineasDelLibro(db, periodo, "asiento");
  return armar({ ruc, periodo, libro: LIBROS.DIARIO, campos: CAMPOS.DIARIO, formato: "5.1", lineas });
}

/** Libro mayor: las mismas líneas, agrupadas por cuenta contable. */
export async function libroMayor(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);
  const lineas = await lineasDelLibro(db, periodo, "cuenta");
  return armar({ ruc, periodo, libro: LIBROS.MAYOR, campos: CAMPOS.MAYOR, formato: "6.1", lineas });
}

// ─── Formatos 12.1 y 13.1: Inventario permanente ──────────────────────────

type FilaKardex = {
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
  documento_tipo: string | null;
  documento_serie: string | null;
  documento_numero: string | null;
  asiento: string | null;
  origen_modulo: string | null;
};

/**
 * Movimientos del periodo con el documento que los originó.
 *
 * El documento no es decorativo: la estructura exige serie y número siempre que
 * el tipo de operación sea una compra, una venta o una devolución, que es la
 * mayoría. Sale del módulo de origen del movimiento —una compra, un
 * comprobante—, no de un campo que alguien tenga que llenar a mano.
 */
async function movimientosDelPeriodo(db: Db, periodo: string): Promise<FilaKardex[]> {
  const filas = (await db.execute(sql`
    SELECT m.fecha::text AS fecha, m.sentido, m.tipo_operacion,
           m.cantidad::text AS cantidad,
           m.costo_unitario::text AS costo_unitario,
           m.importe_total::text AS importe,
           p.codigo AS producto, p.descripcion,
           u.codigo AS unidad, suc.codigo_sunat AS establecimiento,
           coalesce(cp.tipo_documento, cv.tipo_documento) AS documento_tipo,
           coalesce(cp.serie, cv.serie) AS documento_serie,
           coalesce(cp.numero, cv.numero) AS documento_numero,
           coalesce(ac.numero, av.numero) AS asiento,
           m.origen_modulo
    FROM movimientos_inventario m
    JOIN productos p ON p.id = m.producto_id
    JOIN unidades_medida u ON u.id = p.unidad_id
    JOIN almacenes al ON al.id = m.almacen_id
    LEFT JOIN sucursales suc ON suc.id = al.sucursal_id
    LEFT JOIN compras cp ON cp.id = m.origen_id AND m.origen_modulo = 'compras'
    LEFT JOIN comprobantes cv ON cv.id = m.origen_id AND m.origen_modulo = 'ventas'
    LEFT JOIN asientos ac ON ac.id = cp.asiento_id
    LEFT JOIN asientos av ON av.id = cv.asiento_id
    WHERE to_char(m.fecha, 'YYYYMM') = ${periodo}
    ORDER BY p.codigo, m.fecha, m.orden`)) as unknown as FilaKardex[];
  return [...filas];
}

/**
 * Código de establecimiento anexo.
 *
 * Los cuatro primeros dígitos son el anexo del RUC; `0000` es el domicilio
 * fiscal, que es donde está el almacén cuando la empresa no ha declarado
 * anexos.
 */
const establecimientoPle = (codigo: string | null): string => codigo ?? "0000";

/**
 * Inventario permanente en unidades físicas.
 *
 * Es el 13.1 sin los importes. Lo llevan quienes superan las 500 UIT de
 * ingresos; por debajo de 1500 UIT basta con éste y no hace falta el
 * valorizado.
 */
export async function inventarioUnidades(
  db: Db,
  empresaId: string,
  periodo: string,
): Promise<LibroPle> {
  const ruc = await rucDe(db, empresaId);
  const filas = await movimientosDelPeriodo(db, periodo);

  const lineas = filas.map((f, i) => {
    const cuo = f.asiento ?? String(i + 1).padStart(6, "0");
    const entrada = f.sentido === "ingreso";
    const cant = dec(f.cantidad);
    return linea([
      periodoPle(periodo), // 1
      cuo, // 2
      correlativoAsiento(cuo, f.origen_modulo), // 3
      establecimientoPle(f.establecimiento), // 4
      "1", // 5 catálogo utilizado: el propio (tabla 13)
      "01", // 6 tipo de existencia: mercadería (tabla 5)
      f.producto, // 7
      "", // 8-9 segundo catálogo, opcional
      "",
      fechaPle(f.fecha), // 10
      f.documento_tipo ?? "00", // 11
      f.documento_serie ?? "", // 12
      f.documento_numero ?? "", // 13
      f.tipo_operacion, // 14
      f.descripcion, // 15
      f.unidad, // 16
      entrada ? money.toString(cant, 2) : "0.00", // 17
      // Las salidas van en negativo: lo dice la estructura, y sumar la columna
      // tiene que dar la variación del stock.
      entrada ? "0.00" : money.toString(money.neg(cant), 2), // 18
      estadoAnotacion(f.fecha, periodo), // 19
    ]);
  });

  return armar({
    ruc, periodo,
    libro: LIBROS.INVENTARIO_UNIDADES,
    campos: CAMPOS.INVENTARIO_UNIDADES,
    formato: "12.1",
    lineas,
  });
}

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
  const ruc = await rucDe(db, empresaId);
  const filas = await movimientosDelPeriodo(db, periodo);

  // El saldo corrido se reconstruye por producto, que es como el formato lo
  // exige: cada línea muestra el saldo después del movimiento.
  const saldos = new Map<string, { cantidad: Dec; valor: Dec }>();

  const lineas = filas.map((f, i) => {
    const saldo = saldos.get(f.producto) ?? { cantidad: money.ZERO, valor: money.ZERO };
    const cant = dec(f.cantidad);
    const importe = dec(f.importe);
    const entrada = f.sentido === "ingreso";

    saldo.cantidad = entrada ? money.add(saldo.cantidad, cant) : money.sub(saldo.cantidad, cant);
    saldo.valor = entrada ? money.add(saldo.valor, importe) : money.sub(saldo.valor, importe);
    if (money.isZero(saldo.cantidad)) saldo.valor = money.ZERO;
    saldos.set(f.producto, saldo);

    const costoSaldo = money.isZero(saldo.cantidad)
      ? money.ZERO
      : money.round(money.div(saldo.valor, saldo.cantidad), 6);
    const cuo = f.asiento ?? String(i + 1).padStart(6, "0");

    return linea([
      periodoPle(periodo), // 1
      cuo, // 2
      correlativoAsiento(cuo, f.origen_modulo), // 3
      establecimientoPle(f.establecimiento), // 4
      "1", // 5 catálogo propio
      "01", // 6 mercadería
      f.producto, // 7
      "", // 8-9 segundo catálogo, opcional
      "",
      fechaPle(f.fecha), // 10
      f.documento_tipo ?? "00", // 11
      f.documento_serie ?? "", // 12
      f.documento_numero ?? "", // 13
      f.tipo_operacion, // 14
      f.descripcion, // 15
      f.unidad, // 16
      "2", // 17 método de valuación: promedio (tabla 14)
      entrada ? money.toString(cant, 2) : "0.00", // 18 entradas: cantidad
      entrada ? money.toString(dec(f.costo_unitario), 2) : "0.00", // 19
      entrada ? money.toString(importe, 2) : "0.00", // 20
      entrada ? "0.00" : money.toString(money.neg(cant), 2), // 21 salidas, en negativo
      entrada ? "0.00" : money.toString(dec(f.costo_unitario), 2), // 22
      entrada ? "0.00" : money.toString(money.neg(importe), 2), // 23
      money.toString(saldo.cantidad, 2), // 24 saldo final: cantidad
      money.toString(costoSaldo, 2), // 25
      money.toString(saldo.valor, 2), // 26
      estadoAnotacion(f.fecha, periodo), // 27
    ]);
  });

  return armar({
    ruc, periodo,
    libro: LIBROS.INVENTARIO_VALORIZADO,
    campos: CAMPOS.INVENTARIO_VALORIZADO,
    formato: "13.1",
    lineas,
  });
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
