import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dec, add, sub, mul, div, sum, round, trunc, distribute, toString, ZERO, eq,
} from "../src/money.ts";

test("suma exacta donde el float falla", () => {
  assert.equal(toString(add(dec("0.1"), dec("0.2")), 2), "0.30");
});

test("parseo y formato conservan seis decimales", () => {
  assert.equal(toString(dec("1234.567891")), "1234.567891");
  assert.equal(toString(dec("-0.000001")), "-0.000001");
  assert.equal(toString(ZERO, 2), "0.00");
});

test("parseo trunca más allá de la escala en vez de redondear", () => {
  assert.equal(toString(dec("0.1234569")), "0.123456");
});

test("parseo rechaza basura", () => {
  assert.throws(() => dec("1,5"));
  assert.throws(() => dec("abc"));
  assert.throws(() => dec(""));
  assert.throws(() => dec(Number.NaN));
});

test("multiplicación redondea medio arriba", () => {
  // 0.0000005 redondea a 0.000001
  assert.equal(toString(mul(dec("0.001"), dec("0.0005"))), "0.000001");
  assert.equal(toString(mul(dec("100"), dec("0.18")), 2), "18.00");
});

test("negativos redondean medio arriba en valor absoluto", () => {
  assert.equal(toString(round(dec("-2.345"), 2), 2), "-2.35");
  assert.equal(toString(round(dec("2.345"), 2), 2), "2.35");
});

test("división por cero es un error, no un infinito", () => {
  assert.throws(() => div(dec("1"), ZERO), RangeError);
});

test("trunc corta hacia cero en ambos signos", () => {
  assert.equal(toString(trunc(dec("2.999"), 2), 2), "2.99");
  assert.equal(toString(trunc(dec("-2.999"), 2), 2), "-2.99");
});

test("IGV de una factura típica", () => {
  const base = dec("1250.00");
  const igv = round(mul(base, dec("0.18")), 2);
  assert.equal(toString(igv, 2), "225.00");
  assert.equal(toString(add(base, igv), 2), "1475.00");
});

test("distribute reparte sin perder ni inventar céntimos", () => {
  // El caso clásico: 100 entre 3 no es exacto.
  const partes = distribute(dec("100.00"), [dec("1"), dec("1"), dec("1")], 2);
  assert.equal(toString(sum(partes), 2), "100.00");
  assert.deepEqual(partes.map((p) => toString(p, 2)), ["33.34", "33.33", "33.33"]);
});

test("distribute prorratea flete de importación por valor FOB", () => {
  const flete = dec("1500.00");
  const fob = [dec("12000.00"), dec("7500.00"), dec("3300.50")];
  const partes = distribute(flete, fob, 2);
  assert.equal(toString(sum(partes), 2), "1500.00", "el prorrateo debe cuadrar al céntimo");
  // El ítem de mayor FOB recibe la mayor porción.
  assert.ok(partes[0]! > partes[1]! && partes[1]! > partes[2]!);
});

test("distribute con importe negativo (nota de crédito sobre gastos)", () => {
  const partes = distribute(dec("-100.00"), [dec("1"), dec("1"), dec("1")], 2);
  assert.equal(toString(sum(partes), 2), "-100.00");
});

test("distribute sin base reparte en partes iguales", () => {
  const partes = distribute(dec("10.00"), [ZERO, ZERO, ZERO, ZERO], 2);
  assert.equal(toString(sum(partes), 2), "10.00");
  assert.ok(partes.every((p) => eq(p, dec("2.50"))));
});

test("distribute es determinista al reprocesar", () => {
  const w = [dec("3"), dec("3"), dec("3"), dec("1")];
  const a = distribute(dec("1000.01"), w, 2).map((x) => toString(x, 2));
  const b = distribute(dec("1000.01"), w, 2).map((x) => toString(x, 2));
  assert.deepEqual(a, b);
});

test("distribute rechaza un total con más decimales de los que puede repartir", () => {
  assert.throws(() => distribute(dec("10.005"), [dec("1")], 2), RangeError);
});

test("distribute de lista vacía no explota", () => {
  assert.deepEqual(distribute(dec("10.00"), [], 2), []);
});

test("sum de lista vacía es cero", () => {
  assert.equal(toString(sum([]), 2), "0.00");
});

test("resta cruzando cero", () => {
  assert.equal(toString(sub(dec("1.00"), dec("1.000001")), 6), "-0.000001");
});
