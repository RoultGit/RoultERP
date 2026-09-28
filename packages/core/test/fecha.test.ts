/**
 * Qué día es hoy.
 *
 * Todo este archivo existe por un fallo que no se ve programando: en una
 * máquina de Lima, `new Date().toISOString().slice(0, 10)` y la fecha real
 * coinciden hasta las 19:00. A partir de ahí, y siempre en un servidor que
 * corre en UTC, devuelve mañana.
 *
 * Los instantes de abajo son fijos y las comprobaciones no dependen de la zona
 * del proceso: `Intl` recibe la zona por nombre. Así la prueba vale igual en el
 * portátil del programador que en el servidor de despliegue.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hoyEnPeru, horaEnPeru, periodoDeHoy, enDias, ZONA_HORARIA } from "../src/fecha.ts";

describe("la fecha de hoy en Perú", () => {
  test("a las 20:00 de Lima sigue siendo hoy, no mañana", () => {
    // 01:00 UTC del 1 de octubre son las 20:00 del 30 de setiembre en Lima.
    // Es el caso que fechaba las facturas de fin de mes en el mes siguiente:
    // periodo tributario equivocado y correlativo fuera de orden, que es de lo
    // poco que SUNAT rechaza sin discusión.
    const instante = new Date("2026-10-01T01:00:00Z");
    assert.equal(instante.toISOString().slice(0, 10), "2026-10-01", "lo que daba antes");
    assert.equal(hoyEnPeru(instante), "2026-09-30", "lo que tiene que dar");
    assert.equal(periodoDeHoy(instante), "202609");
  });

  test("la hora acompaña a la fecha, en la misma zona", () => {
    // Una hora en UTC junto a una fecha de Lima es la combinación que no cuadra
    // dentro del XML del comprobante.
    const instante = new Date("2026-10-01T01:00:00Z");
    assert.equal(horaEnPeru(instante), "20:00:00");
  });

  test("justo antes y justo después de la medianoche de Lima", () => {
    // 04:59 UTC son las 23:59 del día anterior; 05:00 UTC es medianoche.
    assert.equal(hoyEnPeru(new Date("2026-03-15T04:59:59Z")), "2026-03-14");
    assert.equal(hoyEnPeru(new Date("2026-03-15T05:00:00Z")), "2026-03-15");
  });

  test("Perú no cambia la hora en verano", () => {
    // Si algún día la cambiara, esto se rompe y hay que enterarse. Enero y
    // julio tienen que dar el mismo desfase.
    const enero = new Date("2026-01-15T04:59:00Z");
    const julio = new Date("2026-07-15T04:59:00Z");
    assert.equal(hoyEnPeru(enero), "2026-01-14");
    assert.equal(hoyEnPeru(julio), "2026-07-14");
    assert.equal(ZONA_HORARIA, "America/Lima");
  });

  test("sumar días parte de la fecha local, no del instante", () => {
    // A las 20:00 del 30, «dentro de 30 días» es el 30 de octubre. Sumando
    // milisegundos al instante y formateando después saldría el 31.
    const instante = new Date("2026-10-01T01:00:00Z");
    assert.equal(enDias(30, instante), "2026-10-30");
    assert.equal(enDias(1, instante), "2026-10-01");
    assert.equal(enDias(-1, instante), "2026-09-29");
    assert.equal(enDias(0, instante), hoyEnPeru(instante));
  });

  test("cruza el fin de mes y el fin de año sin saltarse nada", () => {
    assert.equal(enDias(1, new Date("2026-01-31T12:00:00Z")), "2026-02-01");
    assert.equal(enDias(1, new Date("2026-12-31T12:00:00Z")), "2027-01-01");
    // 2028 es bisiesto.
    assert.equal(enDias(1, new Date("2028-02-28T12:00:00Z")), "2028-02-29");
  });
});
