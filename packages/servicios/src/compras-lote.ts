/**
 * Carga en serie del registro de compras.
 *
 * SERVIDIMAR registra unas 250 facturas de compra al mes (pregunta 15 del
 * cuestionario). A pantalla por factura eso son doce al día, y el grueso son
 * gastos de una sola línea —servicios, fletes, alquileres— que ya vienen en una
 * hoja de cálculo o en la propuesta del registro de compras de SUNAT.
 *
 * Esto pega esa hoja de una vez. Tres decisiones lo gobiernan:
 *
 * **Se analiza antes de escribir.** `analizarLote` no toca la base: devuelve
 * fila por fila lo que entendió y lo que no. Quien pega doscientas líneas tiene
 * que ver el cuadro antes de que se contabilice nada, porque una factura mal
 * registrada ya no se borra: se extorna.
 *
 * **Una factura por transacción, no las doscientas.** Es lo contrario de lo que
 * pide el instinto. Si fueran todas en una, la número 173 con el RUC mal escrito
 * tiraría abajo las 172 buenas y quien pegó la hoja tendría que empezar de cero
 * sin saber cuál falló. Aquí cada factura se registra o se rechaza sola, y al
 * final se dice cuáles entraron y cuáles no. Es **relanzable**: se corrigen las
 * cuatro que fallaron y se vuelve a pegar la hoja entera, porque el índice único
 * de (proveedor, tipo, serie, número) impide duplicar las que ya entraron y esas
 * salen marcadas como repetidas en vez de como error.
 *
 * **El proveedor se busca por RUC, no se crea.** Dar de alta proveedores en masa
 * desde una hoja pegada llenaría el maestro de razones sociales mal escritas y
 * duplicadas. Lo que falta se denuncia con su RUC para que alguien lo dé de alta
 * a conciencia.
 */
import { inArray } from "drizzle-orm";
import { ErrorDeNegocio, money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { registrarCompra, CompraInvalida } from "./compras.ts";

const { terceros, planCuentas, centrosCosto, compras } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class LoteInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "LoteInvalido");
  }
}

/**
 * Las columnas de la hoja, en orden.
 *
 * Es el orden de la propuesta del registro de compras de SUNAT recortada a lo
 * que hace falta, y el mismo que sale de exportar el libro desde Starsoft: la
 * idea es que la hoja que ya existe se pegue sin reordenar columnas.
 */
export const COLUMNAS = [
  "fecha",
  "tipoDocumento",
  "serie",
  "numero",
  "rucProveedor",
  "moneda",
  "tipoCambio",
  "baseImponible",
  "igv",
  "cuenta",
  "centroCosto",
  "glosa",
] as const;

export type FilaLote = {
  /** Número de línea en la hoja pegada, contando la primera como 1. */
  linea: number;
  /** Lo que se leyó, ya recortado. Se devuelve para poder enseñarlo al corregir. */
  crudo: Record<(typeof COLUMNAS)[number], string>;
  proveedorId: string | null;
  proveedor: string | null;
  centroCostoId: string | null;
  total: string;
  /** Vacío si la fila está lista para registrarse. */
  problemas: readonly string[];
  /** Ya registrada antes con el mismo proveedor, tipo, serie y número. */
  repetida: boolean;
};

export type AnalisisLote = {
  filas: readonly FilaLote[];
  listas: number;
  conProblemas: number;
  repetidas: number;
  /** Suma de las que están listas. Es lo que se va a contabilizar. */
  totalAContabilizar: string;
  /** RUC que no está en el maestro, una vez cada uno, para darlos de alta. */
  proveedoresFaltantes: readonly string[];
};

const TIPOS_VALIDOS = new Set(["01", "03", "07", "08", "14", "50", "91"]);

/** Parte la hoja pegada en celdas. Acepta tabulaciones (Excel) o punto y coma. */
function celdas(linea: string): string[] {
  const sep = linea.includes("\t") ? "\t" : ";";
  return linea.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
}

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
  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  if (ultimaComa === -1 && ultimoPunto === -1) return t;
  const decimal = ultimaComa > ultimoPunto ? "," : ".";
  const miles = decimal === "," ? "." : ",";
  return t.split(miles).join("").replace(decimal, ".");
}

/**
 * Acepta AAAA-MM-DD y DD/MM/AAAA, que es como lo escribe un Excel peruano.
 *
 * Comprueba que la fecha **exista**, no sólo que tenga la forma. Un `01/13/2026`
 * —una hoja exportada en formato de Estados Unidos— encaja en el patrón y da el
 * mes trece; sin esta comprobación la fila pasaría el análisis en verde y
 * reventaría en Postgres al registrarla, que es justo lo que este módulo
 * promete que no va a pasar.
 */
function fechaIso(v: string): string | null {
  const t = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) ?? null;
  const iso = m
    ? t
    : (() => {
        const d = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
        return d ? `${d[3]}-${d[2]!.padStart(2, "0")}-${d[1]!.padStart(2, "0")}` : null;
      })();
  if (!iso) return null;
  // `new Date` corrige en silencio: el 31 de febrero se vuelve 3 de marzo. Se
  // compara de vuelta para cazar justo eso.
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const esDecimal = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

/**
 * Lee la hoja y dice, fila por fila, qué entendió y qué no. No escribe nada.
 *
 * Se resuelven en dos consultas los proveedores y las cuentas de todas las
 * filas: preguntarlos uno a uno serían quinientas idas a la base para una hoja
 * de doscientas líneas.
 */
export async function analizarLote(
  db: Db,
  _empresaId: string,
  texto: string,
): Promise<AnalisisLote> {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lineas.length === 0) throw new LoteInvalido(["pegue al menos una fila"]);

  // Una cabecera pegada por error se descarta sola: su primera celda no es fecha.
  const sinCabecera = fechaIso(celdas(lineas[0]!)[0] ?? "") === null ? lineas.slice(1) : lineas;
  if (sinCabecera.length === 0) throw new LoteInvalido(["la hoja sólo trae la fila de títulos"]);

  const crudas = sinCabecera.map((l, i) => {
    const c = celdas(l);
    const campos = {} as Record<(typeof COLUMNAS)[number], string>;
    COLUMNAS.forEach((nombre, j) => {
      campos[nombre] = c[j] ?? "";
    });
    return { linea: i + 1, campos };
  });

  const rucs = [...new Set(crudas.map((f) => f.campos.rucProveedor).filter(Boolean))];
  const cuentas = [...new Set(crudas.map((f) => f.campos.cuenta).filter(Boolean))];

  const proveedores = rucs.length
    ? await db
        .select({ id: terceros.id, doc: terceros.numeroDocumento, razon: terceros.razonSocial,
                  esProveedor: terceros.esProveedor })
        .from(terceros)
        .where(inArray(terceros.numeroDocumento, rucs))
    : [];
  const porRuc = new Map(proveedores.map((p) => [p.doc, p]));

  const existentes = cuentas.length
    ? await db
        .select({
          codigo: planCuentas.cuenta,
          esMovimiento: planCuentas.esMovimiento,
          exigeCentroCosto: planCuentas.exigeCentroCosto,
        })
        .from(planCuentas)
        .where(inArray(planCuentas.cuenta, cuentas))
    : [];
  const porCuenta = new Map(existentes.map((c) => [c.codigo, c]));

  const codigosCentro = [...new Set(crudas.map((f) => f.campos.centroCosto).filter(Boolean))];
  const centros = codigosCentro.length
    ? await db
        .select({ id: centrosCosto.id, codigo: centrosCosto.codigo })
        .from(centrosCosto)
        .where(inArray(centrosCosto.codigo, codigosCentro))
    : [];
  const porCentro = new Map(centros.map((c) => [c.codigo, c.id]));

  // Lo ya registrado: se marca como repetido, no como error. Es lo que hace que
  // volver a pegar la hoja corregida sea seguro.
  const yaRegistradas = new Set(
    (
      await db
        .select({
          proveedorId: compras.proveedorId,
          tipo: compras.tipoDocumento,
          serie: compras.serie,
          numero: compras.numero,
        })
        .from(compras)
    ).map((c) => `${c.proveedorId}|${c.tipo}|${c.serie}|${c.numero}`),
  );

  const filas: FilaLote[] = crudas.map(({ linea, campos }) => {
    const problemas: string[] = [];

    const fecha = fechaIso(campos.fecha);
    if (!fecha) problemas.push("la fecha no se entiende (use AAAA-MM-DD o DD/MM/AAAA)");

    const tipo = campos.tipoDocumento.padStart(2, "0");
    if (!TIPOS_VALIDOS.has(tipo)) problemas.push(`tipo de documento «${campos.tipoDocumento}»`);
    if (!campos.serie) problemas.push("falta la serie");
    if (!campos.numero) problemas.push("falta el número");

    const prov = porRuc.get(campos.rucProveedor);
    if (!campos.rucProveedor) problemas.push("falta el RUC del proveedor");
    else if (!prov) problemas.push(`el RUC ${campos.rucProveedor} no está en el maestro`);
    else if (!prov.esProveedor) problemas.push(`${prov.razon} no está marcado como proveedor`);

    const moneda = (campos.moneda || "PEN").toUpperCase();
    const tc = cifra(campos.tipoCambio || "1");
    if (!esDecimal(tc) || money.lte(dec(tc), money.ZERO)) problemas.push("tipo de cambio inválido");
    if (moneda !== "PEN" && tc === "1") {
      // Un dólar a 1.00 registra la factura por la sexta parte de lo que vale y
      // el descuadre aparece al conciliar, no aquí.
      problemas.push("una factura en moneda extranjera necesita su tipo de cambio");
    }

    const base = cifra(campos.baseImponible);
    const igv = cifra(campos.igv);
    if (!esDecimal(base)) problemas.push("la base imponible no es un número");
    if (!esDecimal(igv)) problemas.push("el IGV no es un número");

    const cuenta = campos.cuenta;
    const ficha = porCuenta.get(cuenta);
    if (!cuenta) problemas.push("indique la cuenta de gasto o de existencia");
    else if (!ficha) problemas.push(`la cuenta ${cuenta} no existe en el plan`);
    else if (!ficha.esMovimiento) problemas.push(`la cuenta ${cuenta} no admite movimiento`);

    // El centro de costo se exige aquí y no al registrar: si el plan lo pide y
    // la hoja no lo trae, doscientas filas fallarían una por una después de que
    // el cuadro las hubiera dado por buenas.
    const centroId = campos.centroCosto ? porCentro.get(campos.centroCosto) : undefined;
    if (campos.centroCosto && !centroId) {
      problemas.push(`el centro de costo ${campos.centroCosto} no existe`);
    }
    if (ficha?.exigeCentroCosto && !centroId) {
      problemas.push(`la cuenta ${cuenta} exige centro de costo`);
    }

    const total = esDecimal(base) && esDecimal(igv) ? money.add(dec(base), dec(igv)) : money.ZERO;
    const clave = prov ? `${prov.id}|${tipo}|${campos.serie}|${campos.numero}` : "";
    const repetida = clave !== "" && yaRegistradas.has(clave);

    return {
      linea,
      crudo: campos,
      proveedorId: prov?.id ?? null,
      proveedor: prov?.razon ?? null,
      centroCostoId: centroId ?? null,
      total: txt2(total),
      problemas,
      repetida,
    };
  });

  const listas = filas.filter((f) => f.problemas.length === 0 && !f.repetida);
  return {
    filas,
    listas: listas.length,
    conProblemas: filas.filter((f) => f.problemas.length > 0).length,
    repetidas: filas.filter((f) => f.repetida).length,
    totalAContabilizar: txt2(money.sum(listas.map((f) => dec(f.total)))),
    proveedoresFaltantes: [
      ...new Set(
        filas
          .filter((f) => f.crudo.rucProveedor && !porRuc.has(f.crudo.rucProveedor))
          .map((f) => f.crudo.rucProveedor),
      ),
    ],
  };
}

export type ResultadoLote = {
  registradas: readonly { linea: number; compraId: string; total: string }[];
  /** Lo que no entró, con el porqué. Se corrige y se vuelve a pegar la hoja. */
  rechazadas: readonly { linea: number; motivo: string }[];
  omitidas: readonly { linea: number; motivo: string }[];
  total: string;
};

/**
 * Registra las filas que están listas.
 *
 * **Cada factura en su propia transacción.** Es deliberado: lo contrario —las
 * doscientas en una— haría que la 173 con la cuenta equivocada tirase abajo las
 * 172 buenas. Aquí lo que entra queda contabilizado con su asiento y su cuenta
 * por pagar, y lo que falla se devuelve con su número de línea.
 *
 * Quien llama es responsable de haber enseñado antes el análisis: contabilizar
 * doscientas facturas sin que nadie mire el cuadro es exactamente lo que este
 * módulo existe para evitar.
 */
export async function registrarLote(
  abrirTransaccion: <T>(trabajo: (db: Db) => Promise<T>) => Promise<T>,
  empresaId: string,
  usuarioId: string,
  analisis: AnalisisLote,
): Promise<ResultadoLote> {
  const registradas: { linea: number; compraId: string; total: string }[] = [];
  const rechazadas: { linea: number; motivo: string }[] = [];
  const omitidas: { linea: number; motivo: string }[] = [];

  for (const f of analisis.filas) {
    if (f.repetida) {
      omitidas.push({ linea: f.linea, motivo: "ya estaba registrada" });
      continue;
    }
    if (f.problemas.length > 0) {
      rechazadas.push({ linea: f.linea, motivo: f.problemas.join("; ") });
      continue;
    }

    const base = dec(cifra(f.crudo.baseImponible));
    const igv = dec(cifra(f.crudo.igv));
    // El IGV se deduce de lo que trae la hoja, no se recalcula: una factura
    // exonerada viene con IGV cero y recalcularla al 18 % inventaría crédito
    // fiscal. La afectación sale del propio importe.
    const afectacionIgv = money.isZero(igv) ? "20" : "10";

    try {
      const r = await abrirTransaccion((db) =>
        registrarCompra(db, empresaId, usuarioId, {
          proveedorId: f.proveedorId!,
          tipoDocumento: f.crudo.tipoDocumento.padStart(2, "0"),
          serie: f.crudo.serie,
          numero: f.crudo.numero,
          fechaEmision: fechaIso(f.crudo.fecha)!,
          moneda: (f.crudo.moneda || "PEN").toUpperCase(),
          tipoCambio: cifra(f.crudo.tipoCambio || "1"),
          lineas: [
            {
              descripcion: f.crudo.glosa || "Compra registrada en serie",
              cantidad: "1",
              valorUnitario: txt2(base),
              afectacionIgv,
              cuenta: f.crudo.cuenta,
              ...(f.centroCostoId ? { centroCostoId: f.centroCostoId } : {}),
            },
          ],
        }),
      );
      registradas.push({ linea: f.linea, compraId: r.compraId, total: r.total });
    } catch (e) {
      rechazadas.push({
        linea: f.linea,
        motivo:
          e instanceof CompraInvalida || e instanceof ErrorDeNegocio
            ? e.message
            : "no se pudo registrar; revise los datos de la fila",
      });
      if (!(e instanceof ErrorDeNegocio)) {
        console.error(`carga en serie: fila ${f.linea}`, e);
      }
    }
  }

  return {
    registradas,
    rechazadas,
    omitidas,
    total: txt2(money.sum(registradas.map((r) => dec(r.total)))),
  };
}
