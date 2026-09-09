import { test } from "node:test";
import assert from "node:assert/strict";
import { dec, toString, sum } from "../src/money.ts";
import {
  liquidar, verificarProrrateo, LiquidacionInvalida, CONCEPTOS_IMPORTACION,
  type ItemImportacion, type Gasto,
} from "../src/importaciones/liquidacion.ts";

const s2 = (d: Parameters<typeof toString>[0]) => toString(d, 2);
const s6 = (d: Parameters<typeof toString>[0]) => toString(d, 6);

// Embarque de referencia: tres productos, FOB en dólares, TC 3.75.
const items: ItemImportacion[] = [
  { id: "i1", productoId: "p1", cantidad: dec("100"), fobUnitario: dec("50"), peso: dec("500"), volumen: dec("2") },
  { id: "i2", productoId: "p2", cantidad: dec("200"), fobUnitario: dec("20"), peso: dec("300"), volumen: dec("3") },
  { id: "i3", productoId: "p3", cantidad: dec("50"), fobUnitario: dec("10"), peso: dec("200"), volumen: dec("1") },
];
// FOB USD: 5000 + 4000 + 500 = 9500 → S/ 35 625.00
const TC = { tipoCambioFob: dec("3.75") };

const g = (o: Partial<Gasto> & Pick<Gasto, "id" | "concepto" | "importe" | "base">): Gasto => ({
  moneda: "PEN",
  tipoCambio: dec("1"),
  afectaCosto: true,
  ...o,
});

test("sin gastos, el costo es el FOB convertido", () => {
  const l = liquidar(items, [], TC);
  assert.equal(s2(l.fobTotal), "35625.00");
  assert.equal(s2(l.costoTotal), "35625.00");
  assert.equal(s6(l.items[0]!.costoUnitario), "187.500000", "50 USD × 3.75");
});

test("el flete se prorratea por peso y cuadra al céntimo", () => {
  const flete = g({ id: "g1", concepto: "Flete internacional", importe: dec("4000.00"), base: "peso" });
  const l = liquidar(items, [flete], TC);
  // Pesos 500/300/200 sobre 1000 → 2000 / 1200 / 800
  assert.equal(s2(l.items[0]!.totalGastosCosto), "2000.00");
  assert.equal(s2(l.items[1]!.totalGastosCosto), "1200.00");
  assert.equal(s2(l.items[2]!.totalGastosCosto), "800.00");
  assert.equal(s2(sum(l.items.map((i) => i.totalGastosCosto))), "4000.00");
  assert.equal(verificarProrrateo([flete], l).ok, true);
});

test("un gasto en dólares se convierte con su propio tipo de cambio", () => {
  // El flete se pagó a 3.80 aunque la factura se valorizó a 3.75.
  const flete = g({
    id: "g1", concepto: "Flete", importe: dec("1000.00"), base: "fob",
    moneda: "USD", tipoCambio: dec("3.80"),
  });
  const l = liquidar(items, [flete], TC);
  assert.equal(s2(sum(l.items.map((i) => i.totalGastosCosto))), "3800.00");
});

test("el IGV de importación no entra al costo", () => {
  const gastos = [
    g({ id: "g1", concepto: "Ad valorem", importe: dec("2137.50"), base: "fob" }),
    g({ id: "g2", concepto: "IGV de importación", importe: dec("6797.25"), base: "fob", afectaCosto: false }),
  ];
  const l = liquidar(items, gastos, TC);
  assert.equal(s2(l.gastosCostoTotal), "2137.50");
  assert.equal(s2(l.gastosNoCostoTotal), "6797.25");
  assert.equal(s2(l.costoTotal), "37762.50", "FOB + ad valorem, sin IGV");
  assert.deepEqual(
    l.noCosto.map((n) => [n.concepto, s2(n.importe)]),
    [["IGV de importación", "6797.25"]],
  );
});

test("la percepción tampoco es costo, es pago a cuenta", () => {
  const perc = g({
    id: "g1", concepto: "Percepción del IGV", importe: dec("1500.00"),
    base: "fob", afectaCosto: false,
  });
  const l = liquidar(items, [perc], TC);
  assert.equal(s2(l.costoTotal), "35625.00");
  assert.equal(s2(l.gastosNoCostoTotal), "1500.00");
});

test("un gasto directo se carga íntegro al ítem que lo generó", () => {
  const inspeccion = g({
    id: "g1", concepto: "Inspección fitosanitaria", importe: dec("900.00"),
    base: "directo", itemId: "i2",
  });
  const l = liquidar(items, [inspeccion], TC);
  assert.equal(s2(l.items[0]!.totalGastosCosto), "0.00");
  assert.equal(s2(l.items[1]!.totalGastosCosto), "900.00");
  assert.equal(s2(l.items[2]!.totalGastosCosto), "0.00");
});

test("un gasto directo a un ítem inexistente se rechaza", () => {
  const malo = g({
    id: "g1", concepto: "X", importe: dec("100"), base: "directo", itemId: "no-existe",
  });
  assert.throws(() => liquidar(items, [malo], TC), LiquidacionInvalida);
});

test("prorratear por peso sin peso en un ítem falla con un mensaje que se entiende", () => {
  const sinPeso = [{ ...items[0]!, peso: undefined }, items[1]!, items[2]!];
  const flete = g({ id: "g1", concepto: "Flete internacional", importe: dec("100"), base: "peso" });
  assert.throws(
    () => liquidar(sinPeso, [flete], TC),
    (e: unknown) => e instanceof LiquidacionInvalida && /peso/.test(e.message) && /i1/.test(e.message),
  );
});

test("prorratear por volumen usa el volumen, no el peso", () => {
  const consolidado = g({ id: "g1", concepto: "Consolidado", importe: dec("600.00"), base: "volumen" });
  const l = liquidar(items, [consolidado], TC);
  // Volúmenes 2/3/1 sobre 6 → 200 / 300 / 100
  assert.equal(s2(l.items[0]!.totalGastosCosto), "200.00");
  assert.equal(s2(l.items[1]!.totalGastosCosto), "300.00");
  assert.equal(s2(l.items[2]!.totalGastosCosto), "100.00");
});

test("prorratear por cantidad ignora el valor de cada ítem", () => {
  const etiquetado = g({ id: "g1", concepto: "Etiquetado", importe: dec("350.00"), base: "cantidad" });
  const l = liquidar(items, [etiquetado], TC);
  // Cantidades 100/200/50 sobre 350 → 100 / 200 / 50
  assert.equal(s2(l.items[0]!.totalGastosCosto), "100.00");
  assert.equal(s2(l.items[1]!.totalGastosCosto), "200.00");
  assert.equal(s2(l.items[2]!.totalGastosCosto), "50.00");
});

test("un gasto que no divide exacto no pierde ni un céntimo", () => {
  const g1 = g({ id: "g1", concepto: "Almacenaje", importe: dec("1000.00"), base: "cantidad" });
  const l = liquidar(items, [g1], TC);
  assert.equal(s2(sum(l.items.map((i) => i.totalGastosCosto))), "1000.00");
  assert.equal(verificarProrrateo([g1], l).ok, true);
});

test("una liquidación completa realista cuadra en todos sus gastos", () => {
  const gastos: Gasto[] = [
    g({ id: "g1", concepto: "Flete internacional", importe: dec("2800.00"), base: "peso", moneda: "USD", tipoCambio: dec("3.78") }),
    g({ id: "g2", concepto: "Seguro de transporte", importe: dec("142.50"), base: "fob", moneda: "USD", tipoCambio: dec("3.78") }),
    g({ id: "g3", concepto: "Ad valorem", importe: dec("2493.75"), base: "fob" }),
    g({ id: "g4", concepto: "IGV de importación", importe: dec("7929.11"), base: "fob", afectaCosto: false }),
    g({ id: "g5", concepto: "Percepción del IGV", importe: dec("1762.02"), base: "fob", afectaCosto: false }),
    g({ id: "g6", concepto: "Agente de aduanas", importe: dec("1180.00"), base: "fob" }),
    g({ id: "g7", concepto: "Almacenaje", importe: dec("637.20"), base: "peso" }),
    g({ id: "g8", concepto: "Transporte interno", importe: dec("450.00"), base: "peso" }),
  ];
  const l = liquidar(items, gastos, TC);

  const v = verificarProrrateo(gastos, l);
  assert.equal(v.ok, true, JSON.stringify(v.diferencias));

  // El costo total es FOB + sólo los gastos que son costo.
  assert.equal(s2(l.gastosNoCostoTotal), "9691.13", "IGV + percepción quedan fuera del costo");
  assert.equal(s2(l.costoTotal), s2(sum([l.fobTotal, l.gastosCostoTotal])));

  // Y la suma de costos por ítem reconstruye el total.
  assert.equal(s2(sum(l.items.map((i) => i.costoTotal))), s2(l.costoTotal));
});

test("el costo unitario conserva seis decimales para el kardex", () => {
  const gasto = g({ id: "g1", concepto: "Flete", importe: dec("1000.00"), base: "cantidad" });
  const l = liquidar([items[0]!], [gasto], TC);
  // (100 × 50 × 3.75 + 1000) / 100 = 197.50
  assert.equal(s6(l.items[0]!.costoUnitario), "197.500000");
});

test("una liquidación sin ítems se rechaza", () => {
  assert.throws(() => liquidar([], [], TC), LiquidacionInvalida);
});

test("cantidad cero o FOB negativo se rechazan antes de calcular", () => {
  assert.throws(
    () => liquidar([{ ...items[0]!, cantidad: dec("0") }], [], TC),
    LiquidacionInvalida,
  );
  assert.throws(
    () => liquidar([{ ...items[0]!, fobUnitario: dec("-1") }], [], TC),
    LiquidacionInvalida,
  );
});

test("un tipo de cambio no positivo se rechaza", () => {
  assert.throws(() => liquidar(items, [], { tipoCambioFob: dec("0") }), LiquidacionInvalida);
  const malo = g({ id: "g1", concepto: "X", importe: dec("10"), base: "fob", tipoCambio: dec("0") });
  assert.throws(() => liquidar(items, [malo], TC), LiquidacionInvalida);
});

test("verificarProrrateo detecta una diferencia si la hubiera", () => {
  const gasto = g({ id: "g1", concepto: "Flete", importe: dec("1000.00"), base: "fob" });
  const l = liquidar(items, [gasto], TC);
  const inflado = { ...gasto, importe: dec("1000.01") };
  const v = verificarProrrateo([inflado], l);
  assert.equal(v.ok, false);
  assert.equal(v.diferencias[0]!.concepto, "Flete");
});

test("la plantilla de conceptos marca correctamente lo que no es costo", () => {
  const noCosto = CONCEPTOS_IMPORTACION.filter((c) => !c.afectaCosto).map((c) => c.concepto);
  assert.deepEqual(noCosto, ["IGV de importación", "IPM", "Percepción del IGV"]);
  const advalorem = CONCEPTOS_IMPORTACION.find((c) => c.concepto === "Ad valorem")!;
  assert.equal(advalorem.afectaCosto, true);
});
