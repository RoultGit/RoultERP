/**
 * Liquidación de importaciones: reparte todos los gastos del embarque sobre los
 * ítems para obtener el costo real de ingreso al almacén.
 *
 * Es la pieza que justifica el módulo. Sin ella, el importador registra la
 * mercadería al valor de la factura del exterior y descubre su margen real
 * meses después, cuando el contador cierra el ejercicio.
 *
 * Dos reglas que deciden casi todo:
 *
 * 1. **El IGV y el IPM de importación no son costo.** Son crédito fiscal: van a
 *    la cuenta 40111, no a la 20. Sumarlos al costo infla el inventario en un
 *    18 % y arruina el margen. La percepción del IGV tampoco es costo, es un
 *    pago a cuenta. En cambio el ad valorem, el ISC no recuperable y los
 *    derechos antidumping sí lo son (NIC 2, párrafo 11).
 *
 * 2. **El prorrateo tiene que cuadrar al céntimo** con el gasto que se reparte.
 *    Se usa `distribute`, que asigna el sobrante por resto mayor en vez de
 *    dejar diferencias que después nadie sabe de dónde salieron.
 */
import {
  type Dec, add, sub, mul, div, sum, round, distribute, ZERO, isZero, gt, lt,
} from "../money.ts";
import { ErrorDeNegocio } from "../errores.ts";

/** Sobre qué magnitud se reparte un gasto entre los ítems del embarque. */
export type BaseProrrateo = "fob" | "peso" | "volumen" | "cantidad" | "directo";

export type ItemImportacion = {
  id: string;
  productoId: string;
  cantidad: Dec;
  /** Valor FOB unitario en la moneda de la factura del exterior. */
  fobUnitario: Dec;
  /** Peso bruto total de la línea, en kg. Necesario si algún gasto va por peso. */
  peso?: Dec;
  /** Volumen total de la línea, en m³. Necesario si algún gasto va por volumen. */
  volumen?: Dec;
};

export type Gasto = {
  id: string;
  concepto: string;
  /** Importe en la moneda del gasto. */
  importe: Dec;
  moneda: string;
  /**
   * Tipo de cambio a la moneda funcional. 1 si el gasto ya está en ella.
   * Se guarda por gasto y no por liquidación porque el flete se paga a un tipo
   * y el agente de aduanas a otro, con semanas de diferencia.
   */
  tipoCambio: Dec;
  base: BaseProrrateo;
  /**
   * false para el IGV, el IPM y la percepción: se pagan en la importación pero
   * no forman parte del costo de la mercadería.
   */
  afectaCosto: boolean;
  /** Sólo con `base: "directo"`: el ítem al que se carga íntegro. */
  itemId?: string;
};

export type GastoProrrateado = {
  gastoId: string;
  concepto: string;
  /** Importe asignado a este ítem, en moneda funcional. */
  importe: Dec;
};

export type ItemLiquidado = {
  item: ItemImportacion;
  /** FOB de la línea en moneda funcional. */
  fob: Dec;
  gastos: GastoProrrateado[];
  /** Gastos que sí son costo. */
  totalGastosCosto: Dec;
  /** Gastos que no son costo (IGV, percepción): se informan aparte. */
  totalGastosNoCosto: Dec;
  /** FOB + gastos que son costo. Es lo que entra al kardex. */
  costoTotal: Dec;
  costoUnitario: Dec;
};

export type Liquidacion = {
  items: ItemLiquidado[];
  fobTotal: Dec;
  gastosCostoTotal: Dec;
  gastosNoCostoTotal: Dec;
  /** Valor total que ingresa al almacén. Cuadra con el cargo a la cuenta 20. */
  costoTotal: Dec;
  /** Crédito fiscal y pagos a cuenta, por concepto. */
  noCosto: { concepto: string; importe: Dec }[];
};

export class LiquidacionInvalida extends ErrorDeNegocio {
  constructor(motivo: string) {
    super(motivo, "LiquidacionInvalida");
  }
}

/**
 * Tipo de cambio de la factura del exterior a la moneda funcional.
 * Se aplica al FOB; cada gasto trae el suyo.
 */
export type OpcionesLiquidacion = { tipoCambioFob: Dec };

export function liquidar(
  items: readonly ItemImportacion[],
  gastos: readonly Gasto[],
  opts: OpcionesLiquidacion,
): Liquidacion {
  if (items.length === 0) {
    throw new LiquidacionInvalida("una liquidación necesita al menos un ítem");
  }
  for (const it of items) {
    if (!gt(it.cantidad, ZERO)) {
      throw new LiquidacionInvalida(`el ítem ${it.id} tiene cantidad no positiva`);
    }
    if (lt(it.fobUnitario, ZERO)) {
      throw new LiquidacionInvalida(`el ítem ${it.id} tiene FOB negativo`);
    }
  }
  if (!gt(opts.tipoCambioFob, ZERO)) {
    throw new LiquidacionInvalida("el tipo de cambio del FOB debe ser positivo");
  }

  const fobs = items.map((it) => round(mul(mul(it.cantidad, it.fobUnitario), opts.tipoCambioFob), 2));

  // Acumulador por ítem, en el mismo orden que `items`.
  const asignado: GastoProrrateado[][] = items.map(() => []);

  for (const g of gastos) {
    if (!gt(g.tipoCambio, ZERO)) {
      throw new LiquidacionInvalida(`el gasto ${g.concepto} no tiene tipo de cambio válido`);
    }
    const enFuncional = round(mul(g.importe, g.tipoCambio), 2);

    if (g.base === "directo") {
      const idx = items.findIndex((it) => it.id === g.itemId);
      if (idx === -1) {
        throw new LiquidacionInvalida(
          `el gasto directo ${g.concepto} apunta a un ítem que no está en el embarque`,
        );
      }
      asignado[idx]!.push({ gastoId: g.id, concepto: g.concepto, importe: enFuncional });
      continue;
    }

    const pesos = pesosDe(items, g.base, fobs, g.concepto);
    const partes = distribute(enFuncional, pesos, 2);
    partes.forEach((importe, i) => {
      asignado[i]!.push({ gastoId: g.id, concepto: g.concepto, importe });
    });
  }

  const porGasto = new Map(gastos.map((g) => [g.id, g]));

  const liquidados: ItemLiquidado[] = items.map((item, i) => {
    const propios = asignado[i]!;
    const esCosto = (p: GastoProrrateado) => porGasto.get(p.gastoId)?.afectaCosto ?? true;

    const totalGastosCosto = round(sum(propios.filter(esCosto).map((p) => p.importe)), 2);
    const totalGastosNoCosto = round(sum(propios.filter((p) => !esCosto(p)).map((p) => p.importe)), 2);
    const fob = fobs[i]!;
    const costoTotal = add(fob, totalGastosCosto);

    return {
      item,
      fob,
      gastos: propios,
      totalGastosCosto,
      totalGastosNoCosto,
      costoTotal,
      // Seis decimales: es el costo que entra al kardex y lo que admite el
      // formato 13.1. Redondear a dos aquí perdería céntimos en lotes grandes.
      costoUnitario: isZero(item.cantidad) ? ZERO : round(div(costoTotal, item.cantidad), 6),
    };
  });

  const noCosto = agruparNoCosto(gastos, liquidados);

  return {
    items: liquidados,
    fobTotal: round(sum(fobs), 2),
    gastosCostoTotal: round(sum(liquidados.map((l) => l.totalGastosCosto)), 2),
    gastosNoCostoTotal: round(sum(liquidados.map((l) => l.totalGastosNoCosto)), 2),
    costoTotal: round(sum(liquidados.map((l) => l.costoTotal)), 2),
    noCosto,
  };
}

function pesosDe(
  items: readonly ItemImportacion[],
  base: Exclude<BaseProrrateo, "directo">,
  fobs: readonly Dec[],
  concepto: string,
): Dec[] {
  switch (base) {
    case "fob":
      return [...fobs];
    case "cantidad":
      return items.map((it) => it.cantidad);
    case "peso":
      return items.map((it) => {
        if (it.peso === undefined) {
          throw new LiquidacionInvalida(
            `el gasto «${concepto}» se prorratea por peso y el ítem ${it.id} no lo tiene`,
          );
        }
        return it.peso;
      });
    case "volumen":
      return items.map((it) => {
        if (it.volumen === undefined) {
          throw new LiquidacionInvalida(
            `el gasto «${concepto}» se prorratea por volumen y el ítem ${it.id} no lo tiene`,
          );
        }
        return it.volumen;
      });
  }
}

function agruparNoCosto(
  gastos: readonly Gasto[],
  liquidados: readonly ItemLiquidado[],
): { concepto: string; importe: Dec }[] {
  const noCosto = new Set(gastos.filter((g) => !g.afectaCosto).map((g) => g.id));
  const acc = new Map<string, Dec>();
  for (const l of liquidados) {
    for (const p of l.gastos) {
      if (!noCosto.has(p.gastoId)) continue;
      acc.set(p.concepto, add(acc.get(p.concepto) ?? ZERO, p.importe));
    }
  }
  return [...acc].map(([concepto, importe]) => ({ concepto, importe: round(importe, 2) }));
}

/**
 * Comprueba que no se perdió ni se inventó dinero al prorratear: cada gasto,
 * convertido a moneda funcional, tiene que ser exactamente igual a la suma de
 * lo que se repartió entre los ítems.
 *
 * Se corre antes de contabilizar la liquidación. Si falla, el asiento no
 * cuadraría y es mejor enterarse aquí.
 */
export function verificarProrrateo(
  gastos: readonly Gasto[],
  liq: Liquidacion,
): { ok: boolean; diferencias: { concepto: string; esperado: Dec; repartido: Dec }[] } {
  const diferencias: { concepto: string; esperado: Dec; repartido: Dec }[] = [];
  for (const g of gastos) {
    const esperado = round(mul(g.importe, g.tipoCambio), 2);
    const repartido = round(
      sum(liq.items.flatMap((l) => l.gastos.filter((p) => p.gastoId === g.id).map((p) => p.importe))),
      2,
    );
    if (!isZero(sub(esperado, repartido))) {
      diferencias.push({ concepto: g.concepto, esperado, repartido });
    }
  }
  return { ok: diferencias.length === 0, diferencias };
}

/**
 * Conceptos habituales de una importación peruana, con el tratamiento que le
 * corresponde a cada uno. Es la plantilla que se ofrece al registrar gastos,
 * para que nadie marque el IGV como costo por descuido.
 */
export const CONCEPTOS_IMPORTACION: readonly {
  concepto: string;
  base: BaseProrrateo;
  afectaCosto: boolean;
  nota?: string;
}[] = [
  { concepto: "Flete internacional", base: "peso", afectaCosto: true },
  { concepto: "Seguro de transporte", base: "fob", afectaCosto: true },
  { concepto: "Ad valorem", base: "fob", afectaCosto: true },
  { concepto: "Derechos antidumping", base: "fob", afectaCosto: true },
  { concepto: "ISC", base: "fob", afectaCosto: true, nota: "salvo que sea recuperable" },
  {
    concepto: "IGV de importación",
    base: "fob",
    afectaCosto: false,
    nota: "crédito fiscal, cuenta 40111",
  },
  { concepto: "IPM", base: "fob", afectaCosto: false, nota: "crédito fiscal" },
  {
    concepto: "Percepción del IGV",
    base: "fob",
    afectaCosto: false,
    nota: "pago a cuenta, cuenta 40113",
  },
  { concepto: "Agente de aduanas", base: "fob", afectaCosto: true },
  { concepto: "Almacenaje", base: "peso", afectaCosto: true },
  { concepto: "Gastos portuarios", base: "peso", afectaCosto: true },
  { concepto: "Transporte interno", base: "peso", afectaCosto: true },
  { concepto: "Gastos bancarios / carta de crédito", base: "fob", afectaCosto: true },
];
