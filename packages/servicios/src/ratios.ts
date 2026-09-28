/**
 * Ratios financieros, calculados sobre los formatos.
 *
 * Se leen de la plantilla y no de rangos de cuentas porque hay cosas que el
 * número de cuenta no dice. Qué parte del pasivo vence dentro del año lo decide
 * el contador al armar el formato, y de ahí salen todos los ratios de liquidez.
 * Un programa que lo adivinara daría una cifra convincente y equivocada.
 *
 * Dos reglas que sostienen el módulo:
 *
 * - **Un ratio sin sus insumos no se calcula.** No se estima, no se pone cero:
 *   sale marcado como no calculable y diciendo qué papel falta en el formato.
 *   Un ratio inventado es peor que un hueco, porque nadie lo cuestiona.
 * - **Los de actividad usan saldos medios.** Dividir un flujo de todo el año
 *   entre el saldo del último día castiga o premia según cómo estuviera el
 *   almacén ese día, que es una foto y no una película.
 */
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { type Db } from "@roulterp/db";
import { generarEstado, type EstadoGenerado } from "./formatos-eeff.ts";

type Dec = money.Dec;
const dec = (v: string | null | undefined): Dec => money.dec(v ?? "0");

export type Ratio = {
  codigo: string;
  nombre: string;
  /** Qué significa, para quien no lo use todos los días. */
  explicacion: string;
  grupo: "liquidez" | "solvencia" | "actividad" | "rentabilidad";
  /** Null cuando faltan insumos. */
  valor: string | null;
  /** veces, dias o porcentaje. */
  unidad: "veces" | "dias" | "porcentaje" | "moneda";
  /** Qué falta para poder calcularlo. */
  falta?: string;
};

export type AnalisisRatios = {
  periodo: string;
  ratios: Ratio[];
  avisos: string[];
};

/** Divide diciendo que no se puede en vez de dar infinito o cero. */
function dividir(a: Dec | null, b: Dec | null): Dec | null {
  if (a === null || b === null) return null;
  if (money.isZero(money.round(b, 2))) return null;
  return money.round(money.div(a, b), 4);
}

const porcentaje = (v: Dec | null): Dec | null =>
  v === null ? null : money.round(money.mul(v, money.dec("100")), 2);

const dias = (v: Dec | null): Dec | null =>
  v === null || money.isZero(v) ? null : money.round(money.div(money.dec("365"), v), 1);

/**
 * Ratios de un periodo.
 *
 * Toma el estado de situación y el de resultados de los formatos indicados, y
 * los saldos de apertura del ejercicio para las medias. Si un formato no
 * declara algún papel, los ratios que dependían de él salen sin calcular y con
 * la explicación de qué falta.
 */
export async function ratiosFinancieros(
  db: Db,
  opciones: { situacionId: string; resultadosId: string; periodo: string },
): Promise<AnalisisRatios> {
  const { situacionId, resultadosId, periodo } = opciones;

  const [situacion, resultados] = await Promise.all([
    generarEstado(db, situacionId, periodo),
    generarEstado(db, resultadosId, periodo),
  ]);

  const valorDe = (estado: EstadoGenerado, papel: string): Dec | null => {
    const r = estado.renglones.find((x) => x.papel === papel);
    return r ? dec(r.importe) : null;
  };

  const cobrar = valorDe(situacion, "cuentas_por_cobrar");
  const existencias = valorDe(situacion, "existencias");
  const activoCorriente = valorDe(situacion, "activo_corriente");
  const activoTotal = valorDe(situacion, "activo_total");
  const pasivoCorriente = valorDe(situacion, "pasivo_corriente");
  const pasivoTotalDeclarado = valorDe(situacion, "pasivo_total");
  const patrimonio = valorDe(situacion, "patrimonio");

  const ventas = valorDe(resultados, "ventas");
  /*
   * El costo, en magnitud.
   *
   * El formato lo presenta en negativo porque en el estado de resultados resta,
   * y eso es una decisión de presentación. Un ratio de rotación necesita cuánto
   * costó lo vendido, no con qué signo se imprime: sin esta vuelta salían
   * rotaciones y días de inventario negativos, que no significan nada.
   */
  const costoPresentado = valorDe(resultados, "costo_ventas");
  const costoVentas = costoPresentado === null ? null : money.abs(costoPresentado);
  const bruta = valorDe(resultados, "utilidad_bruta");
  const operativa = valorDe(resultados, "utilidad_operativa");
  const resultado = valorDe(resultados, "resultado");

  const avisos: string[] = [];

  /*
   * Cuando el formato no separa el pasivo no corriente, se toma el corriente
   * como el total. Es lo que ocurre en una comercializadora, donde casi todo
   * vence dentro del año, pero conviene decirlo: quien tenga deuda a largo
   * plazo y no la haya separado estará leyendo un endeudamiento distorsionado.
   */
  const pasivoTotal = pasivoTotalDeclarado ?? pasivoCorriente;
  if (pasivoTotalDeclarado === null && pasivoCorriente !== null) {
    avisos.push(
      "El formato no separa el pasivo no corriente: los ratios tratan todo el pasivo como corriente.",
    );
  }

  // Saldos de apertura del ejercicio, para las medias de los ratios de
  // actividad. Un flujo del año dividido entre el saldo del último día premia o
  // castiga según cómo estuviera el almacén ese día.
  const inicio = `${periodo.slice(0, 4)}00`;
  const [apertura] = (await db.execute(sql`
    SELECT
      coalesce(sum(CASE WHEN left(l.cuenta, 2) BETWEEN '20' AND '28'
                        THEN l.debe_funcional - l.haber_funcional ELSE 0 END), 0)::text
        AS existencias,
      coalesce(sum(CASE WHEN left(l.cuenta, 2) BETWEEN '12' AND '18'
                        THEN l.debe_funcional - l.haber_funcional ELSE 0 END), 0)::text
        AS cobrar,
      coalesce(sum(CASE WHEN left(l.cuenta, 2) BETWEEN '42' AND '49'
                        THEN l.haber_funcional - l.debe_funcional ELSE 0 END), 0)::text
        AS pagar
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo < ${inicio}
      AND a.estado IN ('contabilizado', 'extornado')`)) as unknown as [
    { existencias: string; cobrar: string; pagar: string },
  ];

  // Saldo actual de cuentas por pagar comerciales, para el periodo medio de pago.
  const [hoy] = (await db.execute(sql`
    SELECT coalesce(sum(l.haber_funcional - l.debe_funcional), 0)::text AS pagar
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND left(l.cuenta, 2) BETWEEN '42' AND '49'`)) as unknown as [{ pagar: string }];

  const media = (inicial: Dec, final: Dec | null): Dec | null =>
    final === null ? null : money.round(money.div(money.add(inicial, final), money.dec("2")), 2);

  const existenciasMedias = media(dec(apertura?.existencias), existencias);
  const cobrarMedias = media(dec(apertura?.cobrar), cobrar);
  const pagarMedias = media(dec(apertura?.pagar), dec(hoy?.pagar));

  const pruebaAcida =
    activoCorriente !== null && existencias !== null
      ? money.sub(activoCorriente, existencias)
      : null;

  const rotacionExistencias = dividir(costoVentas, existenciasMedias);
  const rotacionCobros = dividir(ventas, cobrarMedias);
  const rotacionPagos = dividir(costoVentas, pagarMedias);

  const diasInventario = dias(rotacionExistencias);
  const diasCobro = dias(rotacionCobros);
  const diasPago = dias(rotacionPagos);

  const ciclo =
    diasInventario !== null && diasCobro !== null && diasPago !== null
      ? money.sub(money.add(diasInventario, diasCobro), diasPago)
      : null;

  const faltaDe = (...pares: [Dec | null, string][]): string | undefined => {
    const ausentes = pares.filter(([v]) => v === null).map(([, n]) => n);
    return ausentes.length
      ? `el formato no declara ${ausentes.join(" ni ")}`
      : undefined;
  };

  const r = (
    codigo: string,
    nombre: string,
    explicacion: string,
    grupo: Ratio["grupo"],
    valor: Dec | null,
    unidad: Ratio["unidad"],
    falta?: string,
  ): Ratio => ({
    codigo,
    nombre,
    explicacion,
    grupo,
    valor: valor === null ? null : money.toString(valor, unidad === "dias" ? 1 : 2),
    unidad,
    ...(valor === null && falta ? { falta } : {}),
  });

  return {
    periodo,
    ratios: [
      // ── Liquidez ───────────────────────────────────────────────────────
      r(
        "corriente",
        "Razón corriente",
        "Cuántos soles de activo corriente hay por cada sol que vence dentro del año. Por debajo de 1 la empresa no puede pagar lo que debe a corto plazo con lo que tiene a corto plazo.",
        "liquidez",
        dividir(activoCorriente, pasivoCorriente),
        "veces",
        faltaDe([activoCorriente, "el activo corriente"], [pasivoCorriente, "el pasivo corriente"]),
      ),
      r(
        "acida",
        "Prueba ácida",
        "Lo mismo sin contar las existencias, que son lo más lento de convertir en efectivo. Es la pregunta de si se puede pagar sin tener que vender el almacén a la fuerza.",
        "liquidez",
        dividir(pruebaAcida, pasivoCorriente),
        "veces",
        faltaDe(
          [activoCorriente, "el activo corriente"],
          [existencias, "las existencias"],
          [pasivoCorriente, "el pasivo corriente"],
        ),
      ),
      r(
        "capital_trabajo",
        "Capital de trabajo",
        "Activo corriente menos pasivo corriente. Lo que queda para operar después de cubrir lo que vence este año.",
        "liquidez",
        activoCorriente !== null && pasivoCorriente !== null
          ? money.sub(activoCorriente, pasivoCorriente)
          : null,
        "moneda",
        faltaDe([activoCorriente, "el activo corriente"], [pasivoCorriente, "el pasivo corriente"]),
      ),

      // ── Solvencia ──────────────────────────────────────────────────────
      r(
        "endeudamiento",
        "Endeudamiento del activo",
        "Qué parte del activo está financiada con deuda. Cuanto más alto, menos margen ante un mal trimestre.",
        "solvencia",
        porcentaje(dividir(pasivoTotal, activoTotal)),
        "porcentaje",
        faltaDe([pasivoTotal, "el pasivo"], [activoTotal, "el activo total"]),
      ),
      r(
        "apalancamiento",
        "Deuda sobre patrimonio",
        "Cuántos soles de deuda hay por cada sol de los dueños. Es el ratio que mira un banco antes de prestar.",
        "solvencia",
        dividir(pasivoTotal, patrimonio),
        "veces",
        faltaDe([pasivoTotal, "el pasivo"], [patrimonio, "el patrimonio"]),
      ),

      // ── Actividad ──────────────────────────────────────────────────────
      r(
        "rotacion_existencias",
        "Rotación de existencias",
        "Cuántas veces se renovó el almacén en el año, medida sobre costos. Baja significa capital dormido.",
        "actividad",
        rotacionExistencias,
        "veces",
        faltaDe([costoVentas, "el costo de ventas"], [existencias, "las existencias"]),
      ),
      r(
        "dias_inventario",
        "Días de inventario",
        "Cuántos días tarda en venderse lo que hay en el almacén.",
        "actividad",
        diasInventario,
        "dias",
        faltaDe([costoVentas, "el costo de ventas"], [existencias, "las existencias"]),
      ),
      r(
        "dias_cobro",
        "Periodo medio de cobro",
        "Cuántos días pasan entre facturar y cobrar. Comparado con el crédito que se concede, dice si los clientes pagan a tiempo.",
        "actividad",
        diasCobro,
        "dias",
        faltaDe([ventas, "las ventas"], [cobrar, "las cuentas por cobrar"]),
      ),
      r(
        "dias_pago",
        "Periodo medio de pago",
        "Cuántos días se tarda en pagar a los proveedores.",
        "actividad",
        diasPago,
        "dias",
        faltaDe([costoVentas, "el costo de ventas"]),
      ),
      r(
        "ciclo_efectivo",
        "Ciclo de conversión de efectivo",
        "Días de inventario más días de cobro menos días de pago: cuánto tiempo está el dinero fuera de la caja. Es el que decide cuánta caja hace falta para crecer.",
        "actividad",
        ciclo,
        "dias",
        faltaDe(
          [costoVentas, "el costo de ventas"],
          [existencias, "las existencias"],
          [cobrar, "las cuentas por cobrar"],
        ),
      ),

      // ── Rentabilidad ───────────────────────────────────────────────────
      r(
        "margen_bruto",
        "Margen bruto",
        "Qué parte de cada venta queda después del costo de la mercadería.",
        "rentabilidad",
        porcentaje(dividir(bruta, ventas)),
        "porcentaje",
        faltaDe([bruta, "la utilidad bruta"], [ventas, "las ventas"]),
      ),
      r(
        "margen_operativo",
        "Margen operativo",
        "Lo que queda después de los gastos de operar. Es el margen del negocio, sin financiación ni extraordinarios.",
        "rentabilidad",
        porcentaje(dividir(operativa, ventas)),
        "porcentaje",
        faltaDe([operativa, "la utilidad operativa"], [ventas, "las ventas"]),
      ),
      r(
        "margen_neto",
        "Margen neto",
        "Lo que queda al final, sobre cada sol vendido.",
        "rentabilidad",
        porcentaje(dividir(resultado, ventas)),
        "porcentaje",
        faltaDe([resultado, "el resultado"], [ventas, "las ventas"]),
      ),
      r(
        "roa",
        "Rentabilidad del activo",
        "Cuánto gana la empresa por cada sol invertido en activos.",
        "rentabilidad",
        porcentaje(dividir(resultado, activoTotal)),
        "porcentaje",
        faltaDe([resultado, "el resultado"], [activoTotal, "el activo total"]),
      ),
      r(
        "roe",
        "Rentabilidad del patrimonio",
        "Cuánto gana el dueño por cada sol puesto. Es el ratio con el que se compara contra dejar el dinero en otro sitio.",
        "rentabilidad",
        porcentaje(dividir(resultado, patrimonio)),
        "porcentaje",
        faltaDe([resultado, "el resultado"], [patrimonio, "el patrimonio"]),
      ),
    ],
    avisos: [
      ...avisos,
      ...(situacion.sinClasificar.length > 0
        ? [
            `El formato de situación deja ${situacion.sinClasificar.length} cuentas fuera: los ratios que dependan de ellas están incompletos.`,
          ]
        : []),
      ...(money.isZero(dec(apertura?.existencias)) && money.isZero(dec(apertura?.cobrar))
        ? [
            "No hay saldos de apertura del ejercicio: los ratios de actividad usan la media entre cero y el saldo actual, así que salen optimistas el primer año.",
          ]
        : []),
    ],
  };
}
