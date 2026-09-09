import { test } from "node:test";
import assert from "node:assert/strict";
import { dec, toString, sum, add } from "../src/money.ts";
import {
  AFECTACION, TASA_IGV, totalizar, calcularLinea, valorDesdePrecio, cuadra, esGratuita,
} from "../src/tributario/igv.ts";
import {
  DETRACCION_SEED, buscarRegla, calcularDetraccion, calcularRetencion,
  calcularPercepcion, regimenAplicable, PERCEPCION, MINIMO_DETRACCION,
} from "../src/tributario/regimenes.ts";

const s2 = (d: Parameters<typeof toString>[0]) => toString(d, 2);

// ─── IGV ──────────────────────────────────────────────────────────────────

test("factura gravada simple: 10 × 100 = 1000 + 180 IGV", () => {
  const t = totalizar([
    { cantidad: dec("10"), valorUnitario: dec("100"), afectacion: AFECTACION.GRAVADO },
  ]);
  assert.equal(s2(t.gravadas), "1000.00");
  assert.equal(s2(t.igv), "180.00");
  assert.equal(s2(t.total), "1180.00");
});

test("el precio unitario incluye el IGV", () => {
  const l = calcularLinea({
    cantidad: dec("10"), valorUnitario: dec("100"), afectacion: AFECTACION.GRAVADO,
  });
  assert.equal(toString(l.precioUnitario, 2), "118.00");
});

test("factura mixta separa gravado, exonerado, inafecto y exportación", () => {
  const t = totalizar([
    { cantidad: dec("1"), valorUnitario: dec("1000"), afectacion: AFECTACION.GRAVADO },
    { cantidad: dec("1"), valorUnitario: dec("500"), afectacion: AFECTACION.EXONERADO },
    { cantidad: dec("1"), valorUnitario: dec("300"), afectacion: AFECTACION.INAFECTO },
    { cantidad: dec("1"), valorUnitario: dec("200"), afectacion: AFECTACION.EXPORTACION },
  ]);
  assert.equal(s2(t.gravadas), "1000.00");
  assert.equal(s2(t.exoneradas), "500.00");
  assert.equal(s2(t.inafectas), "300.00");
  assert.equal(s2(t.exportacion), "200.00");
  // Sólo lo gravado paga IGV.
  assert.equal(s2(t.igv), "180.00");
  assert.equal(s2(t.total), "2180.00");
});

test("una bonificación gratuita informa IGV pero no suma al total", () => {
  const t = totalizar([
    { cantidad: dec("10"), valorUnitario: dec("100"), afectacion: AFECTACION.GRAVADO },
    { cantidad: dec("1"), valorUnitario: dec("100"), afectacion: AFECTACION.GRAVADO_BONIFICACION },
  ]);
  assert.equal(s2(t.gravadas), "1000.00", "la gratuita no entra a la base gravada");
  assert.equal(s2(t.gratuitas), "100.00");
  assert.equal(s2(t.igv), "180.00", "sólo se cobra el IGV de lo oneroso");
  assert.equal(s2(t.igvGratuitas), "18.00", "pero el de la gratuita se informa");
  assert.equal(s2(t.total), "1180.00");
});

test("el descuento de línea baja la base del IGV", () => {
  const t = totalizar([
    {
      cantidad: dec("10"), valorUnitario: dec("100"),
      afectacion: AFECTACION.GRAVADO, descuento: dec("100"),
    },
  ]);
  assert.equal(s2(t.gravadas), "900.00");
  assert.equal(s2(t.igv), "162.00");
  assert.equal(s2(t.total), "1062.00");
});

test("el ISC entra a la base del IGV", () => {
  const t = totalizar([
    {
      cantidad: dec("1"), valorUnitario: dec("1000"),
      afectacion: AFECTACION.GRAVADO, isc: dec("100"),
    },
  ]);
  assert.equal(s2(t.isc), "100.00");
  assert.equal(s2(t.igv), "198.00", "18 % sobre 1100, no sobre 1000");
  assert.equal(s2(t.total), "1298.00");
});

test("el total es la suma de las líneas, no el IGV del agregado", () => {
  // Tres líneas cuyo IGV individual redondea distinto que el IGV del total.
  const lineas = Array.from({ length: 3 }, () => ({
    cantidad: dec("1"), valorUnitario: dec("33.33"), afectacion: AFECTACION.GRAVADO,
  }));
  const t = totalizar(lineas);
  assert.equal(s2(t.igv), s2(sum(t.lineas.map((l) => l.igv))));
  assert.equal(s2(t.total), s2(add(t.gravadas, t.igv)));
});

test("cantidades y precios con decimales no arrastran error", () => {
  const t = totalizar([
    { cantidad: dec("3.5"), valorUnitario: dec("12.345678"), afectacion: AFECTACION.GRAVADO },
  ]);
  // 3.5 × 12.345678 = 43.209873 → 43.21
  assert.equal(s2(t.gravadas), "43.21");
  assert.equal(s2(t.igv), "7.78");
  assert.equal(s2(t.total), "50.99");
});

test("valorDesdePrecio invierte el IGV", () => {
  assert.equal(toString(valorDesdePrecio(dec("118.00")), 2), "100.00");
  assert.equal(toString(valorDesdePrecio(dec("1180.00")), 2), "1000.00");
});

test("un comprobante sin líneas totaliza en cero, no en NaN", () => {
  const t = totalizar([]);
  assert.equal(s2(t.total), "0.00");
  assert.equal(s2(t.igv), "0.00");
  assert.deepEqual(t.lineas, []);
});

test("cantidad cero no divide por cero al sacar el precio unitario", () => {
  const l = calcularLinea({
    cantidad: dec("0"), valorUnitario: dec("100"), afectacion: AFECTACION.GRAVADO,
  });
  assert.equal(s2(l.precioUnitario), "0.00");
});

test("cuadra tolera un céntimo de diferencia y no dos", () => {
  assert.equal(cuadra(dec("1180.00"), dec("1180.01")), true);
  assert.equal(cuadra(dec("1180.00"), dec("1179.99")), true);
  assert.equal(cuadra(dec("1180.00"), dec("1180.02")), false);
});

test("la tasa de IGV es la vigente", () => {
  assert.equal(toString(TASA_IGV, 2), "0.18");
});

test("esGratuita reconoce los códigos de retiro y bonificación", () => {
  assert.equal(esGratuita(AFECTACION.GRAVADO_BONIFICACION), true);
  assert.equal(esGratuita(AFECTACION.INAFECTO_RETIRO_MUESTRAS), true);
  assert.equal(esGratuita(AFECTACION.GRAVADO), false);
  assert.equal(esGratuita(AFECTACION.EXPORTACION), false);
});

// ─── Detracción ───────────────────────────────────────────────────────────

const servicios = buscarRegla(DETRACCION_SEED, "037")!;
const carga = buscarRegla(DETRACCION_SEED, "027")!;

test("las reglas semilla traen las tasas de los anexos 2 y 3", () => {
  assert.equal(toString(servicios.tasa, 2), "0.12");
  assert.equal(toString(carga.tasa, 2), "0.04");
  assert.equal(toString(buscarRegla(DETRACCION_SEED, "010")!.tasa, 2), "0.15");
});

test("no se detrae por debajo del mínimo de S/ 700", () => {
  const d = calcularDetraccion(dec("700.00"), servicios);
  assert.equal(d.aplica, false);
  assert.equal(s2(d.monto), "0.00");
  assert.equal(s2(d.neto), "700.00");
});

test("se detrae apenas se supera el mínimo", () => {
  const d = calcularDetraccion(dec("700.01"), servicios);
  assert.equal(d.aplica, true);
});

test("detracción del 12 % sobre 11800 son 1416 soles enteros", () => {
  const d = calcularDetraccion(dec("11800.00"), servicios);
  assert.equal(s2(d.monto), "1416.00");
  assert.equal(s2(d.neto), "10384.00");
});

test("el depósito va sin céntimos, redondeando al entero más cercano", () => {
  // 12 % de 1180.50 = 141.66 → 142
  const d = calcularDetraccion(dec("1180.50"), servicios);
  assert.equal(s2(d.monto), "142.00");
});

test("el redondeo hacia arriba es opcional y no baja nunca del cercano", () => {
  // 4 % de 1000.10 = 40.004 → cercano 40, arriba 41
  assert.equal(s2(calcularDetraccion(dec("1000.10"), carga).monto), "40.00");
  assert.equal(s2(calcularDetraccion(dec("1000.10"), carga, { redondeo: "arriba" }).monto), "41.00");
});

test("un importe que ya es entero no sube con el redondeo hacia arriba", () => {
  // 4 % de 1000 = 40 exacto
  assert.equal(s2(calcularDetraccion(dec("1000.00"), carga, { redondeo: "arriba" }).monto), "40.00");
});

test("una regla sin mínimo detrae desde el primer sol", () => {
  const sinMinimo = { ...servicios, aplicaMinimo: false };
  const d = calcularDetraccion(dec("100.00"), sinMinimo);
  assert.equal(d.aplica, true);
  assert.equal(s2(d.monto), "12.00");
});

test("el mínimo es parametrizable por si SUNAT lo cambia", () => {
  const d = calcularDetraccion(dec("800.00"), servicios, { minimo: dec("1000.00") });
  assert.equal(d.aplica, false);
  assert.equal(s2(MINIMO_DETRACCION), "700.00");
});

// ─── Retención ────────────────────────────────────────────────────────────

test("retención del 3 % sobre el importe pagado", () => {
  const r = calcularRetencion(dec("11800.00"));
  assert.equal(r.aplica, true);
  assert.equal(s2(r.monto), "354.00");
  assert.equal(s2(r.neto), "11446.00");
});

test("no se retiene si la operación no pasa de S/ 700", () => {
  const r = calcularRetencion(dec("700.00"));
  assert.equal(r.aplica, false);
  assert.equal(s2(r.neto), "700.00");
});

test("en un pago parcial se retiene sobre lo pagado, no sobre la factura", () => {
  const r = calcularRetencion(dec("5000.00"), { totalOperacion: dec("11800.00") });
  assert.equal(r.aplica, true);
  assert.equal(s2(r.monto), "150.00", "3 % de 5000");
});

test("un pago parcial pequeño de una factura grande sí retiene", () => {
  // El mínimo se mide contra la operación, no contra el pago.
  const r = calcularRetencion(dec("100.00"), { totalOperacion: dec("11800.00") });
  assert.equal(r.aplica, true);
  assert.equal(s2(r.monto), "3.00");
});

// ─── Percepción ───────────────────────────────────────────────────────────

test("la percepción se suma al total, no se descuenta", () => {
  const p = calcularPercepcion(dec("11800.00"));
  assert.equal(s2(p.monto), "236.00", "2 % de 11800");
  assert.equal(s2(p.totalConPercepcion), "12036.00");
});

test("la percepción de combustible usa el 1 %", () => {
  const p = calcularPercepcion(dec("10000.00"), PERCEPCION.COMBUSTIBLE.tasa);
  assert.equal(s2(p.monto), "100.00");
});

// ─── Exclusión entre regímenes ────────────────────────────────────────────

test("la detracción tiene prioridad sobre los demás regímenes", () => {
  assert.equal(
    regimenAplicable({ sujetoDetraccion: true, sujetoPercepcion: true, sujetoRetencion: true }),
    "detraccion",
  );
  assert.equal(
    regimenAplicable({ sujetoDetraccion: false, sujetoPercepcion: true, sujetoRetencion: true }),
    "percepcion",
  );
  assert.equal(
    regimenAplicable({ sujetoDetraccion: false, sujetoPercepcion: false, sujetoRetencion: true }),
    "retencion",
  );
  assert.equal(
    regimenAplicable({ sujetoDetraccion: false, sujetoPercepcion: false, sujetoRetencion: false }),
    "ninguno",
  );
});
