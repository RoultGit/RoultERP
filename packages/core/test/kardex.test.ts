import { test } from "node:test";
import assert from "node:assert/strict";
import { dec, toString } from "../src/money.ts";
import {
  aplicar, construir, cuadra, estadoInicial, costoPromedio, valorTotal,
  StockInsuficiente, MovimientoInvalido, TIPO_OPERACION,
  type Movimiento, type OpcionesKardex,
} from "../src/inventario/kardex.ts";

const s2 = (d: Parameters<typeof toString>[0]) => toString(d, 2);
const s6 = (d: Parameters<typeof toString>[0]) => toString(d, 6);

const PROM: OpcionesKardex = { metodo: "promedio" };
const PEPS: OpcionesKardex = { metodo: "peps" };

let n = 0;
const dia = (d: number) => new Date(Date.UTC(2026, 0, d));

const ent = (cant: string, costo: string, d = ++n): Movimiento => ({
  id: `e${d}-${n}`,
  fecha: dia(d),
  sentido: "ingreso",
  tipoOperacion: TIPO_OPERACION.COMPRA,
  cantidad: dec(cant),
  costoUnitario: dec(costo),
});

const sal = (cant: string, d = ++n): Movimiento => ({
  id: `s${d}-${n}`,
  fecha: dia(d),
  sentido: "salida",
  tipoOperacion: TIPO_OPERACION.VENTA,
  cantidad: dec(cant),
});

// ─── Promedio ponderado móvil ─────────────────────────────────────────────

test("promedio: dos compras a distinto costo dan el promedio ponderado", () => {
  // 100 @ 10 = 1000 ; 100 @ 20 = 2000 ; saldo 200 = 3000 → 15 c/u
  const { estado } = construir([ent("100", "10", 1), ent("100", "20", 2)], PROM);
  assert.equal(s2(estado.cantidad), "200.00");
  assert.equal(s2(estado.valor), "3000.00");
  assert.equal(s6(costoPromedio(estado)), "15.000000");
});

test("promedio: la salida se valoriza al promedio del momento, no al último costo", () => {
  const { lineas, estado } = construir(
    [ent("100", "10", 1), ent("100", "20", 2), sal("50", 3)],
    PROM,
  );
  const salida = lineas[2]!;
  assert.equal(s6(salida.salida!.costoUnitario), "15.000000");
  assert.equal(s2(salida.salida!.importe), "750.00");
  assert.equal(s2(estado.cantidad), "150.00");
  assert.equal(s2(estado.valor), "2250.00");
});

test("promedio: una compra posterior mueve el promedio, la anterior ya salió a su costo", () => {
  const { lineas } = construir(
    [ent("10", "100", 1), sal("5", 2), ent("10", "200", 3), sal("5", 4)],
    PROM,
  );
  assert.equal(s6(lineas[1]!.salida!.costoUnitario), "100.000000");
  // Saldo tras la 1.ª salida: 5 @ 100 = 500. Entra 10 @ 200 = 2000.
  // 15 unidades por 2500 → 166.666667
  assert.equal(s6(lineas[3]!.salida!.costoUnitario), "166.666667");
});

test("promedio: dejar el saldo en cero deja el valor en cero exacto", () => {
  // Un promedio con decimales periódicos deja céntimos residuales si no se fuerza.
  const { estado } = construir(
    [ent("3", "10", 1), ent("3", "20", 2), sal("6", 3)],
    PROM,
  );
  assert.equal(s2(estado.cantidad), "0.00");
  assert.equal(s6(estado.valor), "0.000000", "no debe quedar valor sobre saldo cero");
});

// ─── PEPS ─────────────────────────────────────────────────────────────────

test("PEPS: la salida consume primero la capa más antigua", () => {
  const { lineas, estado } = construir(
    [ent("100", "10", 1), ent("100", "20", 2), sal("50", 3)],
    PEPS,
  );
  const salida = lineas[2]!;
  assert.equal(s6(salida.salida!.costoUnitario), "10.000000");
  assert.equal(s2(salida.salida!.importe), "500.00");
  assert.equal(s2(estado.valor), "2500.00", "quedan 50@10 + 100@20");
});

test("PEPS: una salida que cruza capas se desglosa por costo", () => {
  const { lineas } = construir(
    [ent("100", "10", 1), ent("100", "20", 2), sal("150", 3)],
    PEPS,
  );
  const salida = lineas[2]!;
  assert.equal(salida.consumos.length, 2, "el 13.1 necesita el detalle por capa");
  assert.equal(s2(salida.consumos[0]!.cantidad), "100.00");
  assert.equal(s6(salida.consumos[0]!.costoUnitario), "10.000000");
  assert.equal(s2(salida.consumos[1]!.cantidad), "50.00");
  assert.equal(s6(salida.consumos[1]!.costoUnitario), "20.000000");
  // 100×10 + 50×20 = 2000
  assert.equal(s2(salida.salida!.importe), "2000.00");
});

test("PEPS y promedio difieren en el costo de venta, como debe ser", () => {
  const movs = [ent("100", "10", 1), ent("100", "20", 2), sal("100", 3)];
  const p = construir(movs, PROM);
  const f = construir(movs, PEPS);
  assert.equal(s2(p.lineas[2]!.salida!.importe), "1500.00");
  assert.equal(s2(f.lineas[2]!.salida!.importe), "1000.00");
});

test("PEPS: la capa agotada desaparece y la parcial conserva el resto", () => {
  const { estado } = construir(
    [ent("100", "10", 1), ent("100", "20", 2), sal("120", 3)],
    PEPS,
  );
  assert.equal(estado.capas.length, 1);
  assert.equal(s2(estado.capas[0]!.cantidad), "80.00");
  assert.equal(s6(estado.capas[0]!.costoUnitario), "20.000000");
});

test("PEPS: dos ingresos del mismo día se consumen en el orden en que se registraron", () => {
  const a: Movimiento = { ...ent("10", "5", 1), id: "a" };
  const b: Movimiento = { ...ent("10", "9", 1), id: "b" };
  const { lineas } = construir([a, b, { ...sal("10", 1), id: "s" }], PEPS);
  assert.equal(s6(lineas[2]!.salida!.costoUnitario), "5.000000");
});

test("PEPS: el kardex se reconstruye igual desde los mismos movimientos", () => {
  const movs = [ent("50", "7.35", 1), ent("30", "8.10", 2), sal("60", 3), ent("20", "9", 4), sal("10", 5)];
  const a = construir(movs, PEPS);
  const b = construir([...movs].reverse(), PEPS); // se reordena por fecha
  assert.equal(s6(a.estado.valor), s6(b.estado.valor));
  assert.equal(s6(a.estado.cantidad), s6(b.estado.cantidad));
});

// ─── Reglas duras ─────────────────────────────────────────────────────────

test("no se puede sacar más de lo que hay", () => {
  const { estado } = construir([ent("10", "5", 1)], PROM);
  assert.throws(() => aplicar(estado, sal("11", 2), PROM), StockInsuficiente);
});

test("el stock negativo se permite sólo si se pide explícitamente", () => {
  const { estado } = construir([ent("10", "5", 1)], PROM);
  const r = aplicar(estado, sal("15", 2), { ...PROM, permitirNegativo: true });
  assert.equal(s2(r.estado.cantidad), "-5.00");
});

test("PEPS sin capas suficientes valoriza el faltante al último costo conocido", () => {
  const { estado } = construir([ent("10", "5", 1)], PEPS);
  const r = aplicar(estado, sal("15", 2), { ...PEPS, permitirNegativo: true });
  // 10 @ 5 de la capa + 5 @ 5 al último costo conocido
  assert.equal(s2(r.linea.salida!.importe), "75.00");
});

test("un ingreso sin costo unitario se rechaza", () => {
  const sinCosto: Movimiento = { ...ent("10", "5", 1) };
  delete (sinCosto as { costoUnitario?: unknown }).costoUnitario;
  assert.throws(() => aplicar(estadoInicial(), sinCosto, PROM), MovimientoInvalido);
});

test("un costo unitario negativo se rechaza", () => {
  const malo: Movimiento = { ...ent("10", "5", 1), costoUnitario: dec("-1") };
  assert.throws(() => aplicar(estadoInicial(), malo, PROM), MovimientoInvalido);
});

test("una cantidad negativa o cero se rechaza; el sentido lo da el movimiento", () => {
  assert.throws(
    () => aplicar(estadoInicial(), { ...ent("10", "5", 1), cantidad: dec("-5") }, PROM),
    MovimientoInvalido,
  );
  assert.throws(
    () => aplicar(estadoInicial(), { ...ent("10", "5", 1), cantidad: dec("0") }, PROM),
    MovimientoInvalido,
  );
});

test("un ingreso a costo cero es válido (muestras, donaciones recibidas)", () => {
  const { estado } = construir([ent("10", "0", 1)], PROM);
  assert.equal(s2(estado.cantidad), "10.00");
  assert.equal(s2(estado.valor), "0.00");
});

// ─── Cuadre ───────────────────────────────────────────────────────────────

test("el kardex cuadra en cantidad y valor en ambos métodos", () => {
  const movs = [ent("100", "12.5", 1), sal("30", 2), ent("50", "13.75", 3), sal("70", 4)];
  for (const opts of [PROM, PEPS]) {
    const { lineas } = construir(movs, opts);
    assert.equal(cuadra(lineas), true, opts.metodo);
  }
});

test("un kardex sin movimientos cuadra trivialmente", () => {
  assert.equal(cuadra([]), true);
});

test("valorTotal suma la valorización de varios productos", () => {
  const a = construir([ent("10", "100", 1)], PROM).estado;
  const b = construir([ent("5", "40", 2)], PROM).estado;
  assert.equal(s2(valorTotal([a, b])), "1200.00");
});

test("costos con seis decimales no se pierden al acumular", () => {
  const { estado } = construir(
    [ent("3", "10.333333", 1), ent("3", "10.666667", 2)],
    PROM,
  );
  // (3×10.333333 + 3×10.666667) / 6 = 10.5
  assert.equal(s6(costoPromedio(estado)), "10.500000");
});
