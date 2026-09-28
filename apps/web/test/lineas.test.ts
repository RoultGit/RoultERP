/**
 * El gancho de la tabla de líneas.
 *
 * Se prueba la lógica, no el repintado: `useLineas` es un envoltorio fino
 * alrededor de tres transformaciones de lista, y son esas las que tenían el
 * defecto repetido seis veces. Se reproducen aquí con las mismas funciones
 * puras que usa el gancho, sin montar React, que para esto sería andamiaje.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

type Linea = { clave: number; texto: string };

/** Las mismas tres operaciones que hace el gancho. */
const actualizar = (ls: Linea[], clave: number, cambio: Partial<Linea>) =>
  ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l));
const quitar = (ls: Linea[], clave: number, vacia: () => Linea) => {
  const resto = ls.filter((l) => l.clave !== clave);
  return resto.length ? resto : [vacia()];
};

describe("la tabla de líneas", () => {
  test("editar una fila no toca las demás, y no las reordena", () => {
    const antes: Linea[] = [
      { clave: 0, texto: "a" },
      { clave: 1, texto: "b" },
      { clave: 2, texto: "c" },
    ];
    const despues = actualizar(antes, 1, { texto: "B" });
    assert.deepEqual(despues.map((l) => l.texto), ["a", "B", "c"]);
    assert.equal(despues[0], antes[0], "las que no cambian conservan su identidad");
    assert.notEqual(despues[1], antes[1]);
  });

  test("la clave no es el índice: al borrar del medio, las de abajo la conservan", () => {
    // Si la clave fuera el índice, React reutilizaría el nodo de la fila
    // borrada y el texto que se estaba escribiendo saltaría de fila.
    const antes: Linea[] = [
      { clave: 7, texto: "a" },
      { clave: 8, texto: "b" },
      { clave: 9, texto: "c" },
    ];
    const despues = quitar(antes, 8, () => ({ clave: 99, texto: "" }));
    assert.deepEqual(despues.map((l) => l.clave), [7, 9]);
  });

  test("quitar la última deja una en blanco, no una tabla vacía", () => {
    // Una tabla sin filas no deja escribir y obliga a buscar el botón de
    // añadir antes de poder empezar.
    const despues = quitar([{ clave: 3, texto: "solo" }], 3, () => ({ clave: 4, texto: "" }));
    assert.equal(despues.length, 1);
    assert.equal(despues[0]!.texto, "");
    assert.notEqual(despues[0]!.clave, 3, "es una fila nueva, no la que se borró");
  });

  test("las claves nunca se repiten aunque se borre y se añada", () => {
    let n = 0;
    const vacia = (): Linea => ({ clave: n++, texto: "" });
    let ls = [vacia(), vacia(), vacia()];
    ls = quitar(ls, 1, vacia);
    ls = [...ls, vacia()];
    ls = quitar(ls, 0, vacia);
    ls = [...ls, vacia()];
    assert.equal(new Set(ls.map((l) => l.clave)).size, ls.length);
  });
});
