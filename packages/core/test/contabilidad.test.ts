import { test } from "node:test";
import assert from "node:assert/strict";
import { dec, toString, ZERO } from "../src/money.ts";
import {
  validar, esValido, exigirValido, contabilizar, extornar, totales, balance,
  balanceCuadra, diferenciaCambio, mismoEfecto, AsientoInvalido,
  type Asiento, type LineaAsiento,
} from "../src/contabilidad/asiento.ts";

const s2 = (d: Parameters<typeof toString>[0]) => toString(d, 2);

const debe = (cuenta: string, importe: string, tc = "1"): LineaAsiento => ({
  cuenta,
  debe: dec(importe),
  haber: ZERO,
  debeFuncional: dec(String(Number(importe) * Number(tc))),
  haberFuncional: ZERO,
});

const haber = (cuenta: string, importe: string, tc = "1"): LineaAsiento => ({
  cuenta,
  debe: ZERO,
  haber: dec(importe),
  debeFuncional: ZERO,
  haberFuncional: dec(String(Number(importe) * Number(tc))),
});

const asiento = (lineas: LineaAsiento[], over: Partial<Asiento> = {}): Asiento => ({
  id: "a1",
  periodo: "202609",
  fecha: new Date("2026-09-09"),
  subdiario: "08",
  glosa: "Compra de mercadería",
  moneda: "PEN",
  tipoCambio: dec("1"),
  estado: "borrador",
  lineas,
  ...over,
});

// ─── Partida doble ────────────────────────────────────────────────────────

test("un asiento cuadrado es válido", () => {
  // Compra: mercadería 1000 + IGV 180 contra proveedor 1180
  const a = asiento([debe("601111", "1000"), debe("40111", "180"), haber("421201", "1180")]);
  assert.deepEqual(validar(a), []);
  assert.equal(esValido(a), true);
});

test("un asiento descuadrado se rechaza y dice por cuánto", () => {
  const a = asiento([debe("601111", "1000"), haber("421201", "900")]);
  const motivos = validar(a);
  // Descuadra en moneda de operación y también en funcional: dos motivos.
  assert.equal(motivos.length, 2);
  assert.match(motivos.join(), /no cuadra: descuadre de 100\.00/);
});

test("una línea con importe al debe y al haber a la vez se rechaza", () => {
  const mala: LineaAsiento = {
    cuenta: "101", debe: dec("100"), haber: dec("100"),
    debeFuncional: dec("100"), haberFuncional: dec("100"),
  };
  assert.match(validar(asiento([mala, haber("421201", "0")])).join(), /debe y al haber a la vez/);
});

test("una línea en cero por ambos lados se rechaza", () => {
  const vacia: LineaAsiento = {
    cuenta: "101", debe: ZERO, haber: ZERO, debeFuncional: ZERO, haberFuncional: ZERO,
  };
  assert.match(validar(asiento([vacia, debe("101", "1")])).join(), /cero en ambos lados/);
});

test("importes negativos se rechazan: se usa el lado contrario", () => {
  const neg: LineaAsiento = {
    cuenta: "101", debe: dec("-100"), haber: ZERO,
    debeFuncional: dec("-100"), haberFuncional: ZERO,
  };
  assert.match(validar(asiento([neg, haber("421201", "100")])).join(), /no pueden ser negativos/);
});

test("un asiento de una sola línea se rechaza", () => {
  assert.match(validar(asiento([debe("101", "100")])).join(), /al menos dos líneas/);
});

test("se acumulan todos los motivos, no sólo el primero", () => {
  const a = asiento([debe("", "100")], { periodo: "2026", glosa: "  " });
  const motivos = validar(a);
  assert.ok(motivos.length >= 4, `esperaba varios motivos, hubo ${motivos.length}`);
  assert.ok(motivos.some((m) => /dos líneas/.test(m)));
  assert.ok(motivos.some((m) => /AAAAMM/.test(m)));
  assert.ok(motivos.some((m) => /glosa/.test(m)));
  assert.ok(motivos.some((m) => /falta la cuenta/.test(m)));
});

test("totales suma ambos lados y expone el descuadre", () => {
  const t = totales([debe("601111", "1000"), haber("421201", "1000")]);
  assert.equal(s2(t.debe), "1000.00");
  assert.equal(s2(t.haber), "1000.00");
  assert.equal(s2(t.diferencia), "0.00");
});

// ─── Multi-moneda ─────────────────────────────────────────────────────────

test("un asiento en dólares debe cuadrar en dólares y en soles", () => {
  const a = asiento(
    [debe("601111", "1000", "3.75"), haber("421201", "1000", "3.75")],
    { moneda: "USD", tipoCambio: dec("3.75") },
  );
  assert.deepEqual(validar(a), []);
  const t = totales(a.lineas);
  assert.equal(s2(t.debeFuncional), "3750.00");
  assert.equal(s2(t.haberFuncional), "3750.00");
});

test("un asiento que cuadra en dólares pero no en soles se rechaza", () => {
  // Alguien convirtió una línea con un tipo de cambio distinto.
  const a = asiento(
    [debe("601111", "1000", "3.75"), haber("421201", "1000", "3.80")],
    { moneda: "USD", tipoCambio: dec("3.75") },
  );
  assert.match(validar(a).join(), /no cuadra en moneda funcional/);
});

test("un importe sin su equivalente funcional se rechaza", () => {
  const sinFuncional: LineaAsiento = {
    cuenta: "601111", debe: dec("100"), haber: ZERO,
    debeFuncional: ZERO, haberFuncional: ZERO,
  };
  assert.match(validar(asiento([sinFuncional, haber("421201", "100")])).join(), /falta el importe funcional/);
});

// ─── Ciclo de vida ────────────────────────────────────────────────────────

test("contabilizar valida y cambia el estado", () => {
  const a = asiento([debe("601111", "1000"), haber("421201", "1000")]);
  assert.equal(contabilizar(a).estado, "contabilizado");
});

test("no se contabiliza dos veces", () => {
  const a = contabilizar(asiento([debe("601111", "1000"), haber("421201", "1000")]));
  assert.throws(() => contabilizar(a), AsientoInvalido);
});

test("no se contabiliza un asiento descuadrado", () => {
  const a = asiento([debe("601111", "1000"), haber("421201", "999")]);
  assert.throws(() => contabilizar(a), AsientoInvalido);
});

test("exigirValido lanza con todos los motivos en el mensaje", () => {
  assert.throws(
    () => exigirValido(asiento([debe("601111", "1000")])),
    (e: unknown) => e instanceof AsientoInvalido && e.motivos.length > 0,
  );
});

// ─── Extorno ──────────────────────────────────────────────────────────────

test("el extorno invierte los lados y deja el original marcado", () => {
  const a = contabilizar(asiento([debe("601111", "1000"), haber("421201", "1000")]));
  const { original, extorno } = extornar(a, {
    id: "a2", fecha: new Date("2026-09-10"), periodo: "202609",
  });

  assert.equal(original.estado, "extornado");
  assert.equal(extorno.extornaA, "a1");
  assert.equal(s2(extorno.lineas[0]!.haber), "1000.00", "el debe original pasa al haber");
  assert.equal(s2(extorno.lineas[0]!.debe), "0.00");
  assert.equal(s2(extorno.lineas[1]!.debe), "1000.00");
  assert.match(extorno.glosa, /^Extorno de:/);
});

test("original y extorno juntos dejan saldo cero en todas las cuentas", () => {
  const a = contabilizar(
    asiento([debe("601111", "1000"), debe("40111", "180"), haber("421201", "1180")]),
  );
  const { original, extorno } = extornar(a, {
    id: "a2", fecha: new Date("2026-09-10"), periodo: "202609",
  });
  const saldos = balance([original, extorno]);
  assert.ok(
    saldos.every((s) => s2(s.saldo) === "0.00"),
    saldos.map((s) => `${s.cuenta}=${s2(s.saldo)}`).join(" "),
  );
  assert.equal(balanceCuadra(saldos), true);
});

test("el extorno conserva el anexo, para que el saldo por tercero se revierta", () => {
  const conAnexo: LineaAsiento = { ...haber("421201", "1180"), anexoId: "prov-1" };
  const a = contabilizar(asiento([debe("601111", "1000"), debe("40111", "180"), conAnexo]));
  const { extorno } = extornar(a, { id: "a2", fecha: new Date(), periodo: "202609" });
  assert.equal(extorno.lineas[2]!.anexoId, "prov-1");
});

test("no se extorna un borrador ni un asiento ya extornado", () => {
  const borrador = asiento([debe("601111", "1000"), haber("421201", "1000")]);
  assert.throws(() => extornar(borrador, { id: "x", fecha: new Date(), periodo: "202609" }), AsientoInvalido);

  const a = contabilizar(borrador);
  const { original } = extornar(a, { id: "a2", fecha: new Date(), periodo: "202609" });
  assert.throws(() => extornar(original, { id: "a3", fecha: new Date(), periodo: "202609" }), AsientoInvalido);
});

// ─── Balance ──────────────────────────────────────────────────────────────

test("el balance de comprobación suma cero", () => {
  const asientos = [
    contabilizar(asiento([debe("601111", "1000"), debe("40111", "180"), haber("421201", "1180")])),
    contabilizar(asiento([debe("421201", "1180"), haber("104101", "1180")], { id: "a2" })),
  ];
  const saldos = balance(asientos);
  assert.equal(balanceCuadra(saldos), true);
  assert.equal(s2(saldos.find((s) => s.cuenta === "421201")!.saldo), "0.00", "el proveedor quedó pagado");
  assert.equal(s2(saldos.find((s) => s.cuenta === "104101")!.saldo), "-1180.00", "el banco es acreedor");
});

test("los borradores no entran al balance", () => {
  const borrador = asiento([debe("601111", "9999"), haber("421201", "9999")]);
  assert.deepEqual(balance([borrador]), []);
});

// ─── Diferencia de cambio ─────────────────────────────────────────────────

test("una subida del dólar es ganancia sobre una cuenta por cobrar", () => {
  const d = diferenciaCambio(dec("1000"), dec("3.75"), dec("3.80"), "activo");
  assert.equal(s2(d.importe), "50.00");
  assert.equal(d.cuenta, "77");
});

test("la misma subida es pérdida sobre una cuenta por pagar", () => {
  const d = diferenciaCambio(dec("1000"), dec("3.75"), dec("3.80"), "pasivo");
  assert.equal(s2(d.importe), "-50.00");
  assert.equal(d.cuenta, "67");
});

test("una bajada del dólar invierte los signos", () => {
  assert.equal(s2(diferenciaCambio(dec("1000"), dec("3.80"), dec("3.75"), "activo").importe), "-50.00");
  assert.equal(s2(diferenciaCambio(dec("1000"), dec("3.80"), dec("3.75"), "pasivo").importe), "50.00");
});

// ─── Recálculo ────────────────────────────────────────────────────────────

test("mismoEfecto reconoce dos asientos equivalentes con líneas en otro orden", () => {
  const a = contabilizar(asiento([debe("601111", "1000"), haber("421201", "1000")]));
  const b = contabilizar(asiento([haber("421201", "1000"), debe("601111", "1000")], { id: "b" }));
  assert.equal(mismoEfecto(a, b), true);
});

test("mismoEfecto distingue asientos con distinto importe", () => {
  const a = contabilizar(asiento([debe("601111", "1000"), haber("421201", "1000")]));
  const b = contabilizar(asiento([debe("601111", "1001"), haber("421201", "1001")], { id: "b" }));
  assert.equal(mismoEfecto(a, b), false);
});
