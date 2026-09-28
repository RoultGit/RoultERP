/**
 * Los dos formatos con los que arranca cada empresa.
 *
 * Reproducen exactamente los estados que el programa traía cableados, para que
 * una empresa que no configura nada vea lo mismo que antes. A partir de ahí el
 * contador los edita, o crea los suyos y deja éstos como referencia.
 *
 * Son un punto de partida, no una jaula: `guardarFormato` acepta cualquier
 * plantilla mientras sus totales sumen renglones anteriores.
 */
import { asc, desc, eq } from "drizzle-orm";
import { schema as s, type Db } from "@roulterp/db";
import { guardarFormato, type DatosFormato } from "./formatos-eeff.ts";

const { formatosEeff, formatoEeffLineas } = s;

export const FORMATOS_BASE: readonly DatosFormato[] = [
  {
    codigo: "EFS",
    nombre: "Estado de situación financiera",
    tipo: "situacion",
    esPredeterminado: true,
    lineas: [
      { concepto: "ACTIVO", clase: "titulo", nivel: 0, columna: "activo" },
      {
        codigo: "efectivo",
        concepto: "Efectivo y equivalentes de efectivo",
        cuentas: "10",
        columna: "activo",
        papel: "efectivo",
      },
      {
        codigo: "cobrar",
        concepto: "Cuentas por cobrar",
        cuentas: "12-18",
        columna: "activo",
        papel: "cuentas_por_cobrar",
      },
      {
        codigo: "existencias",
        concepto: "Existencias",
        cuentas: "20-28",
        columna: "activo",
        papel: "existencias",
      },
      {
        codigo: "act_corriente",
        concepto: "Total activo corriente",
        clase: "total",
        nivel: 0,
        suma: ["efectivo", "cobrar", "existencias"],
        columna: "activo",
        papel: "activo_corriente",
      },
      {
        codigo: "inmovilizado",
        concepto: "Propiedad, planta y equipo",
        cuentas: "30-38",
        columna: "activo",
      },
      // La depreciación es acreedora y se presenta en negativo dentro del
      // activo: restarla es el sentido del renglón, no un error de signo.
      {
        codigo: "depreciacion",
        concepto: "Depreciación acumulada",
        cuentas: "39",
        columna: "activo",
      },
      {
        codigo: "act_no_corriente",
        concepto: "Total activo no corriente",
        clase: "total",
        nivel: 0,
        suma: ["inmovilizado", "depreciacion"],
        columna: "activo",
      },
      {
        codigo: "total_activo",
        concepto: "TOTAL ACTIVO",
        clase: "total",
        nivel: 0,
        suma: ["act_corriente", "act_no_corriente"],
        columna: "activo",
        papel: "activo_total",
      },

      { concepto: "PASIVO Y PATRIMONIO", clase: "titulo", nivel: 0, columna: "pasivo" },
      {
        codigo: "tributos",
        concepto: "Tributos por pagar",
        cuentas: "40",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "remuneraciones",
        concepto: "Remuneraciones por pagar",
        cuentas: "41",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "pagar",
        concepto: "Cuentas por pagar",
        cuentas: "42-49",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "total_pasivo",
        concepto: "Total pasivo",
        clase: "total",
        nivel: 0,
        suma: ["tributos", "remuneraciones", "pagar"],
        columna: "pasivo",
        // Esta plantilla no separa el pasivo no corriente: en una
        // comercializadora prácticamente todo vence dentro del año. Quien tenga
        // deuda a largo plazo parte el renglón y marca cada parte con su papel.
        papel: "pasivo_corriente",
      },
      {
        codigo: "capital",
        concepto: "Capital",
        cuentas: "50-58",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "acumulados",
        concepto: "Resultados acumulados",
        cuentas: "59",
        signo: "acreedor",
        columna: "pasivo",
      },
      // Ingresos menos gastos: el resultado del ejercicio, que todavía no está
      // en la 59 porque el cierre no se ha hecho.
      {
        codigo: "ingresos_ej",
        concepto: "Ingresos del ejercicio",
        // Hasta la 78: la 79 es cuenta de orden del asiento de destino.
        cuentas: "70-78",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "gastos_ej",
        concepto: "Gastos del ejercicio",
        cuentas: "60-69",
        signo: "acreedor",
        columna: "pasivo",
      },
      {
        codigo: "resultado_ej",
        concepto: "Resultado del ejercicio",
        clase: "total",
        nivel: 1,
        suma: ["ingresos_ej", "gastos_ej"],
        columna: "pasivo",
      },
      {
        codigo: "total_patrimonio",
        concepto: "Total patrimonio",
        clase: "total",
        nivel: 0,
        suma: ["capital", "acumulados", "resultado_ej"],
        columna: "pasivo",
        papel: "patrimonio",
      },
      {
        codigo: "total_pas_pat",
        concepto: "TOTAL PASIVO Y PATRIMONIO",
        clase: "total",
        nivel: 0,
        suma: ["total_pasivo", "total_patrimonio"],
        columna: "pasivo",
      },
    ],
  },
  {
    codigo: "ERN",
    nombre: "Estado de resultados por naturaleza",
    tipo: "resultados",
    esPredeterminado: true,
    lineas: [
      {
        codigo: "ventas",
        concepto: "Ventas netas",
        cuentas: "70",
        signo: "acreedor",
        papel: "ventas",
      },
      {
        codigo: "costo",
        concepto: "Costo de ventas",
        cuentas: "69",
        signo: "acreedor",
        papel: "costo_ventas",
      },
      {
        codigo: "bruta",
        concepto: "Utilidad bruta",
        clase: "total",
        nivel: 0,
        suma: ["ventas", "costo"],
        papel: "utilidad_bruta",
      },
      { concepto: "Gastos por naturaleza", clase: "titulo", nivel: 0 },
      { codigo: "g60", concepto: "Compras", cuentas: "60", signo: "acreedor" },
      { codigo: "g61", concepto: "Variación de existencias", cuentas: "61", signo: "acreedor" },
      { codigo: "g62", concepto: "Gastos de personal", cuentas: "62", signo: "acreedor" },
      { codigo: "g63", concepto: "Servicios prestados por terceros", cuentas: "63", signo: "acreedor" },
      { codigo: "g64", concepto: "Gastos por tributos", cuentas: "64", signo: "acreedor" },
      { codigo: "g65", concepto: "Otros gastos de gestión", cuentas: "65", signo: "acreedor" },
      { codigo: "g68", concepto: "Depreciación y amortización", cuentas: "68", signo: "acreedor" },
      {
        codigo: "operativa",
        concepto: "Utilidad operativa",
        clase: "total",
        nivel: 0,
        suma: ["bruta", "g60", "g61", "g62", "g63", "g64", "g65", "g68"],
        papel: "utilidad_operativa",
      },
      { codigo: "i77", concepto: "Ingresos financieros", cuentas: "77", signo: "acreedor" },
      { codigo: "g67", concepto: "Gastos financieros", cuentas: "67", signo: "acreedor" },
      { codigo: "i75", concepto: "Otros ingresos de gestión", cuentas: "75", signo: "acreedor" },
      { codigo: "i76", concepto: "Ganancia por venta de activos", cuentas: "76", signo: "acreedor" },
      { codigo: "g66", concepto: "Pérdida por medición de activos", cuentas: "66", signo: "acreedor" },
      {
        codigo: "resultado",
        concepto: "RESULTADO DEL EJERCICIO",
        clase: "total",
        nivel: 0,
        suma: ["operativa", "i77", "g67", "i75", "i76", "g66"],
        papel: "resultado",
      },
    ],
  },
];

/**
 * Deja los formatos base en una empresa que no los tiene.
 *
 * No toca los que ya existen: si el contador editó el suyo, volver a escribirlo
 * le borraría el trabajo. Es la misma regla que sigue la sincronización del
 * plan de cuentas.
 */
export async function sincronizarFormatos(
  db: Db,
  empresaId: string,
  usuarioId: string,
): Promise<{ agregados: string[]; completados: string[] }> {
  const existentes = new Map(
    (await db.select({ id: formatosEeff.id, codigo: formatosEeff.codigo }).from(formatosEeff)).map(
      (f) => [f.codigo, f.id] as const,
    ),
  );

  const agregados: string[] = [];
  const completados: string[] = [];
  for (const formato of FORMATOS_BASE) {
    const id = existentes.get(formato.codigo);
    if (id === undefined) {
      await guardarFormato(db, empresaId, usuarioId, formato);
      agregados.push(formato.codigo);
      continue;
    }
    completados.push(...(await completarPapeles(db, id, formato)));
  }
  return { agregados, completados };
}

/**
 * Pone los papeles que el formato base declara y el existente no tiene.
 *
 * Una empresa creada antes de que el papel existiera tiene el formato de
 * partida sin papeles, y sin ellos no sale ni un ratio: el mismo problema que
 * las cuentas nuevas del plan, que tampoco llegaban solas a las empresas ya
 * creadas.
 *
 * Sólo rellena huecos. Si el renglón ya declara un papel, o si otro renglón se
 * quedó con el que le tocaba, no se toca nada: eso es una decisión del contador
 * y no un hueco que completar.
 */
async function completarPapeles(
  db: Db,
  formatoId: string,
  base: DatosFormato,
): Promise<string[]> {
  const lineas = await db
    .select({
      id: formatoEeffLineas.id,
      codigo: formatoEeffLineas.codigo,
      papel: formatoEeffLineas.papel,
    })
    .from(formatoEeffLineas)
    .where(eq(formatoEeffLineas.formatoId, formatoId));

  const ocupados = new Set(lineas.map((l) => l.papel).filter((x): x is string => x !== null));
  const puestos: string[] = [];

  for (const linea of base.lineas) {
    if (!linea.papel || !linea.codigo || ocupados.has(linea.papel)) continue;
    const destino = lineas.find((l) => l.codigo === linea.codigo && l.papel === null);
    if (!destino) continue;
    await db
      .update(formatoEeffLineas)
      .set({ papel: linea.papel })
      .where(eq(formatoEeffLineas.id, destino.id));
    ocupados.add(linea.papel);
    puestos.push(`${base.codigo}.${linea.papel}`);
  }
  return puestos;
}

/** El formato que se ofrece primero para un tipo, si hay alguno. */
export async function formatoPredeterminado(db: Db, tipo: string): Promise<string | null> {
  const [f] = await db
    .select({ id: formatosEeff.id })
    .from(formatosEeff)
    .where(eq(formatosEeff.tipo, tipo))
    // El predeterminado primero: `true` ordena después de `false` en Postgres,
    // así que hay que pedirlo descendente o saldría siempre el otro.
    .orderBy(desc(formatosEeff.esPredeterminado), asc(formatosEeff.codigo))
    .limit(1);
  return f?.id ?? null;
}
