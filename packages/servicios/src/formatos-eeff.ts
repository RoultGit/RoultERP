/**
 * Formatos configurables de estados financieros.
 *
 * El estado de situación y el de resultados que trae el programa agrupan por
 * los primeros dígitos de la cuenta, y eso sirve para revisar. Para presentar,
 * cada contador tiene su plantilla: qué cuentas entran en cada renglón, en qué
 * orden, con qué nombre y qué subtotales.
 *
 * Lo que se configura es la **presentación**, nunca la aritmética. Por eso hay
 * tres clases de renglón y ninguna más —título, detalle y total— en vez de un
 * lenguaje de fórmulas: con fórmulas se puede escribir un estado que no cuadre,
 * y un estado financiero que no cuadra no es un estado financiero.
 *
 * La propiedad que sostiene todo esto es la última función del archivo: un
 * formato **delata lo que deja fuera**. Una cuenta con saldo que ningún renglón
 * recoge aparece en `sinClasificar`, y la pantalla lo avisa. Sin eso, configurar
 * un formato sería la forma más fácil de hacer desaparecer dinero de un balance
 * sin que nadie lo note.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { formatosEeff, formatoEeffLineas } = s;

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");
const txt2 = (v: Dec): string => money.toString(v, 2);

export class FormatoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "FormatoInvalido");
  }
}

export const TIPO_FORMATO = { SITUACION: "situacion", RESULTADOS: "resultados" } as const;
export const CLASE_LINEA = { TITULO: "titulo", DETALLE: "detalle", TOTAL: "total" } as const;

// ─── Selección de cuentas ─────────────────────────────────────────────────

/**
 * Expande la lista de cuentas de un renglón a prefijos concretos.
 *
 * Acepta prefijos sueltos («10», «40111») y rangos del mismo largo («12-18»,
 * que son 12, 13… 18). El rango es lo que hace legible una plantilla: escribir
 * los nueve grupos de las cuentas por pagar uno a uno es donde se olvida el 47.
 */
export function prefijosDe(cuentas: string | null): string[] {
  if (!cuentas?.trim()) return [];
  const salida: string[] = [];

  for (const parte of cuentas.split(",").map((p) => p.trim()).filter(Boolean)) {
    const rango = /^(\d+)\s*-\s*(\d+)$/.exec(parte);
    if (!rango) {
      salida.push(parte);
      continue;
    }
    const [, desde, hasta] = rango;
    if (desde!.length !== hasta!.length) {
      throw new FormatoInvalido([
        `el rango «${parte}» mezcla prefijos de distinto largo: 12-18 sí, 12-1899 no`,
      ]);
    }
    const a = Number(desde);
    const b = Number(hasta);
    if (a > b) throw new FormatoInvalido([`el rango «${parte}» va al revés`]);
    for (let i = a; i <= b; i++) salida.push(String(i).padStart(desde!.length, "0"));
  }
  return salida;
}

const casa = (cuenta: string, prefijos: readonly string[]) =>
  prefijos.some((p) => cuenta.startsWith(p));

// ─── Mantenimiento ────────────────────────────────────────────────────────

/**
 * Papeles que un renglón puede declarar, para que los ratios sepan leerlo.
 *
 * No son una segunda clasificación: son la forma de decirle al programa qué es
 * cada renglón, porque hay cosas que el número de cuenta no dice. Qué parte del
 * pasivo es corriente lo decide el contador al armar la plantilla.
 */
export const PAPELES = [
  "efectivo",
  "cuentas_por_cobrar",
  "existencias",
  "activo_corriente",
  "activo_total",
  "pasivo_corriente",
  "pasivo_total",
  "patrimonio",
  "ventas",
  "costo_ventas",
  "utilidad_bruta",
  "utilidad_operativa",
  "resultado",
] as const;
export type Papel = (typeof PAPELES)[number];

export type LineaFormato = {
  codigo?: string;
  concepto: string;
  clase?: string;
  nivel?: number;
  cuentas?: string;
  signo?: "deudor" | "acreedor";
  /** Códigos de los renglones que suma. Sólo con clase «total». */
  suma?: string[];
  columna?: "activo" | "pasivo";
  /** Qué representa, para los ratios. Ver `PAPELES`. */
  papel?: Papel;
};

export type DatosFormato = {
  codigo: string;
  nombre: string;
  tipo: string;
  esPredeterminado?: boolean;
  lineas: LineaFormato[];
};

/**
 * Crea o reemplaza un formato.
 *
 * Reemplaza los renglones enteros: editarlos uno a uno dejaba plantillas a
 * medio cambiar cuando alguien cerraba la pantalla antes de tiempo.
 */
export async function guardarFormato(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosFormato,
): Promise<string> {
  const motivos: string[] = [];
  if (!datos.codigo.trim()) motivos.push("el formato necesita un código");
  if (!datos.nombre.trim()) motivos.push("el formato necesita un nombre");
  if (datos.tipo !== "situacion" && datos.tipo !== "resultados") {
    motivos.push("el tipo debe ser situacion o resultados");
  }
  if (datos.lineas.length === 0) motivos.push("un formato necesita al menos un renglón");

  const vistos = new Set<string>();
  // Dos renglones que dijeran ser «el activo corriente» harían que el ratio
  // dependiera de cuál se leyera primero.
  const papeles = new Set<string>();
  for (const [i, l] of datos.lineas.entries()) {
    const clase = l.clase ?? "detalle";
    if (!["titulo", "detalle", "total"].includes(clase)) {
      motivos.push(`renglón ${i + 1}: clase desconocida «${clase}»`);
      continue;
    }
    if (!l.concepto.trim()) motivos.push(`renglón ${i + 1}: indique el concepto`);
    if (clase === "detalle" && !l.cuentas?.trim()) {
      motivos.push(`renglón ${i + 1}: un detalle necesita decir qué cuentas recoge`);
    }
    if (clase === "detalle" && l.cuentas) {
      try {
        prefijosDe(l.cuentas);
      } catch (e) {
        motivos.push(`renglón ${i + 1}: ${(e as Error).message}`);
      }
    }
    if (clase === "total") {
      if (!l.suma?.length) {
        motivos.push(`renglón ${i + 1}: un total necesita decir qué renglones suma`);
      }
      // Un total sólo puede sumar lo que ya se calculó: referirse hacia
      // adelante haría que el orden de los renglones cambiara los importes.
      for (const ref of l.suma ?? []) {
        if (!vistos.has(ref)) {
          motivos.push(
            `renglón ${i + 1}: suma «${ref}», que no es ningún renglón anterior`,
          );
        }
      }
    }
    if (l.papel && !PAPELES.includes(l.papel)) {
      motivos.push(`renglón ${i + 1}: papel desconocido «${l.papel}»`);
    }
    if (l.papel && papeles.has(l.papel)) {
      motivos.push(`renglón ${i + 1}: el papel «${l.papel}» ya lo declara otro renglón`);
    }
    if (l.papel) papeles.add(l.papel);
    if (l.codigo?.trim()) {
      if (vistos.has(l.codigo.trim())) {
        motivos.push(`renglón ${i + 1}: el código «${l.codigo.trim()}» está repetido`);
      }
      vistos.add(l.codigo.trim());
    }
  }
  if (motivos.length) throw new FormatoInvalido(motivos);

  const [cab] = await db
    .insert(formatosEeff)
    .values({
      empresaId,
      codigo: datos.codigo.trim(),
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      esPredeterminado: datos.esPredeterminado ?? false,
      creadoPor: usuarioId,
    })
    .onConflictDoUpdate({
      target: [formatosEeff.empresaId, formatosEeff.codigo],
      set: {
        nombre: datos.nombre.trim(),
        tipo: datos.tipo,
        esPredeterminado: datos.esPredeterminado ?? false,
        activo: true,
      },
    })
    .returning({ id: formatosEeff.id });
  const formatoId = cab!.id;

  // Un solo predeterminado por tipo: dos serían una moneda al aire.
  if (datos.esPredeterminado) {
    await db
      .update(formatosEeff)
      .set({ esPredeterminado: false })
      .where(
        and(
          eq(formatosEeff.tipo, datos.tipo),
          sql`${formatosEeff.id} <> ${formatoId}`,
        ),
      );
  }

  await db.delete(formatoEeffLineas).where(eq(formatoEeffLineas.formatoId, formatoId));
  await db.insert(formatoEeffLineas).values(
    datos.lineas.map((l, i) => ({
      empresaId,
      formatoId,
      orden: i + 1,
      codigo: l.codigo?.trim() || null,
      concepto: l.concepto.trim(),
      clase: l.clase ?? "detalle",
      nivel: l.nivel ?? 1,
      cuentas: l.cuentas?.trim() || null,
      signo: l.signo ?? "deudor",
      suma: l.suma?.length ? l.suma.join(",") : null,
      columna: l.columna ?? null,
      papel: l.papel ?? null,
      creadoPor: usuarioId,
    })),
  );

  return formatoId;
}

/**
 * Formatos con cuántos renglones tiene cada uno.
 *
 * El conteo va por `LEFT JOIN` y no por subconsulta correlacionada a propósito:
 * sin un join en la consulta exterior, el generador no califica el nombre de la
 * columna, y `formato_id = "id"` dentro de la subconsulta se resolvía contra el
 * `id` de la tabla interna. La consulta era válida, no fallaba, y devolvía cero
 * para todos: el peor tipo de error.
 */
export const listarFormatos = (db: Db, tipo?: string) =>
  db
    .select({
      id: formatosEeff.id,
      codigo: formatosEeff.codigo,
      nombre: formatosEeff.nombre,
      tipo: formatosEeff.tipo,
      esPredeterminado: formatosEeff.esPredeterminado,
      activo: formatosEeff.activo,
      renglones: sql<number>`count(${formatoEeffLineas.id})`,
    })
    .from(formatosEeff)
    .leftJoin(formatoEeffLineas, eq(formatoEeffLineas.formatoId, formatosEeff.id))
    .where(tipo ? eq(formatosEeff.tipo, tipo) : sql`true`)
    .groupBy(
      formatosEeff.id,
      formatosEeff.codigo,
      formatosEeff.nombre,
      formatosEeff.tipo,
      formatosEeff.esPredeterminado,
      formatosEeff.activo,
    )
    .orderBy(asc(formatosEeff.tipo), asc(formatosEeff.codigo));

export async function cargarFormato(db: Db, formatoId: string) {
  const [cabecera] = await db
    .select()
    .from(formatosEeff)
    .where(eq(formatosEeff.id, formatoId))
    .limit(1);
  if (!cabecera) throw new FormatoInvalido(["el formato no existe"]);

  const lineas = await db
    .select()
    .from(formatoEeffLineas)
    .where(eq(formatoEeffLineas.formatoId, formatoId))
    .orderBy(asc(formatoEeffLineas.orden));

  return { cabecera, lineas };
}

export async function eliminarFormato(db: Db, formatoId: string): Promise<void> {
  const [f] = await db
    .select({ esPredeterminado: formatosEeff.esPredeterminado })
    .from(formatosEeff)
    .where(eq(formatosEeff.id, formatoId))
    .limit(1);
  if (!f) throw new FormatoInvalido(["el formato no existe"]);
  if (f.esPredeterminado) {
    throw new FormatoInvalido([
      "es el formato predeterminado: marque otro como predeterminado antes de eliminarlo",
    ]);
  }
  await db.delete(formatosEeff).where(eq(formatosEeff.id, formatoId));
}

// ─── Generación ───────────────────────────────────────────────────────────

export type RenglonEstado = {
  codigo: string | null;
  concepto: string;
  clase: string;
  nivel: number;
  cuentas: string | null;
  columna: string | null;
  papel: string | null;
  importe: string;
};

export type EstadoGenerado = {
  formato: { id: string; codigo: string; nombre: string; tipo: string };
  periodo: string;
  renglones: RenglonEstado[];
  /**
   * Cuentas con saldo que ningún renglón de detalle recoge.
   *
   * Es la salvaguarda del módulo: sin ella, configurar un formato sería la
   * forma más fácil de hacer desaparecer dinero de un balance sin que nadie lo
   * note. Una cuenta nueva del plan aparece aquí hasta que alguien decide en
   * qué renglón va.
   */
  sinClasificar: { cuenta: string; saldo: string }[];
  /** Suma de lo no clasificado. Cero es lo que se espera. */
  totalSinClasificar: string;
};

/**
 * Genera un estado financiero con la plantilla indicada.
 *
 * Los saldos son acumulados hasta el periodo, que es lo que corresponde a un
 * balance y también a un estado de resultados del ejercicio. Sólo entran los
 * asientos contabilizados: un borrador no es un hecho.
 */
export async function generarEstado(
  db: Db,
  formatoId: string,
  periodo: string,
): Promise<EstadoGenerado> {
  const { cabecera, lineas } = await cargarFormato(db, formatoId);
  if (lineas.length === 0) {
    throw new FormatoInvalido([`el formato ${cabecera.codigo} no tiene renglones`]);
  }

  /*
   * La clase 9 y la 79 quedan fuera de los estados financieros.
   *
   * Son cuentas de orden: recogen la reclasificación de los gastos por función
   * y se anulan entre sí. No son activo, ni pasivo, ni resultado. Incluirlas
   * duplicaría el gasto en el estado de resultados y, peor, el aviso de cuentas
   * sin clasificar las señalaría como olvidadas cada vez que alguien corre el
   * asiento de destino.
   */
  const saldos = (await db.execute(sql`
    SELECT l.cuenta, sum(l.debe_funcional - l.haber_funcional)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 1) <> '9'
      AND left(l.cuenta, 2) <> '79'
    GROUP BY l.cuenta`)) as unknown as { cuenta: string; saldo: string }[];

  const porCuenta = [...saldos].map((f) => ({ cuenta: f.cuenta, saldo: dec(f.saldo) }));
  const recogidas = new Set<string>();
  const calculado = new Map<string, Dec>();

  const renglones: RenglonEstado[] = lineas.map((l) => {
    let importe = money.ZERO;

    if (l.clase === "detalle") {
      const prefijos = prefijosDe(l.cuentas);
      for (const c of porCuenta) {
        if (!casa(c.cuenta, prefijos)) continue;
        recogidas.add(c.cuenta);
        importe = money.add(importe, c.saldo);
      }
      if (l.signo === "acreedor") importe = money.neg(importe);
    } else if (l.clase === "total") {
      const refs = (l.suma ?? "").split(",").map((r) => r.trim()).filter(Boolean);
      for (const r of refs) importe = money.add(importe, calculado.get(r) ?? money.ZERO);
    }

    if (l.codigo) calculado.set(l.codigo, importe);

    return {
      codigo: l.codigo,
      concepto: l.concepto,
      clase: l.clase,
      nivel: l.nivel,
      cuentas: l.cuentas,
      columna: l.columna,
      papel: l.papel,
      importe: txt2(importe),
    };
  });

  const sinClasificar = porCuenta
    .filter((c) => !recogidas.has(c.cuenta) && !money.isZero(money.round(c.saldo, 2)))
    .map((c) => ({ cuenta: c.cuenta, saldo: txt2(c.saldo) }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  return {
    formato: {
      id: cabecera.id,
      codigo: cabecera.codigo,
      nombre: cabecera.nombre,
      tipo: cabecera.tipo,
    },
    periodo,
    renglones,
    sinClasificar,
    totalSinClasificar: txt2(
      sinClasificar.reduce<Dec>((a, c) => money.add(a, dec(c.saldo)), money.ZERO),
    ),
  };
}
