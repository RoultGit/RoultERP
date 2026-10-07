import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { paginaDe, totalPaginas, rodaja, desplazamiento, POR_PAGINA } from "../lib/paginacion";

describe("paginación", () => {
  test("la página pedida llega de la dirección y hay que desconfiar de ella", () => {
    assert.equal(paginaDe(undefined), 1);
    assert.equal(paginaDe(""), 1);
    assert.equal(paginaDe("1"), 1);
    assert.equal(paginaDe("7"), 7);
    // Todo lo que no es un entero positivo cae en la primera página.
    assert.equal(paginaDe("0"), 1);
    assert.equal(paginaDe("-3"), 1);
    assert.equal(paginaDe("abc"), 1);
    assert.equal(paginaDe("1.5"), 1);
    assert.equal(paginaDe("1e9"), 1);
    assert.equal(paginaDe(" 2"), 1);
    // Y un número absurdamente grande no se convierte en Infinity.
    assert.equal(paginaDe("9999999"), 1);
  });

  test("una lista vacía tiene una página, no cero", () => {
    // Con cero páginas el pie diría «página 1 de 0», que no significa nada.
    assert.equal(totalPaginas(0), 1);
    assert.equal(rodaja([], 1).length, 0);
  });

  test("el total de páginas redondea hacia arriba", () => {
    assert.equal(totalPaginas(50, 50), 1);
    assert.equal(totalPaginas(51, 50), 2);
    assert.equal(totalPaginas(128, 50), 3);
  });

  test("corta la rodaja que toca", () => {
    const filas = Array.from({ length: 128 }, (_, i) => i);
    assert.deepEqual(rodaja(filas, 1, 50).slice(0, 2), [0, 1]);
    assert.equal(rodaja(filas, 1, 50).length, 50);
    assert.equal(rodaja(filas, 2, 50)[0], 50);
    // La última página trae el resto, no cincuenta rellenos.
    assert.equal(rodaja(filas, 3, 50).length, 28);
    assert.equal(rodaja(filas, 3, 50).at(-1), 127);
  });

  test("pedir una página que ya no existe devuelve la última con contenido", () => {
    // Pasa de verdad: se borran filas y el marcador apunta a la página 9.
    const filas = Array.from({ length: 60 }, (_, i) => i);
    assert.deepEqual(rodaja(filas, 99, 50), rodaja(filas, 2, 50));
    assert.equal(rodaja(filas, 99, 50).length, 10);
    // Y nunca devuelve vacío mientras haya filas.
    assert.ok(rodaja(filas, 1000, 50).length > 0);
  });

  test("el desplazamiento corresponde a la página", () => {
    assert.equal(desplazamiento(1, 50), 0);
    assert.equal(desplazamiento(3, 50), 100);
    assert.equal(desplazamiento(0, 50), 0);
  });

  test("ninguna fila se pierde ni se repite al recorrer todas las páginas", () => {
    // La prueba que de verdad importa: paginar no puede ocultar un asiento.
    for (const total of [0, 1, 49, 50, 51, 128, 301]) {
      const filas = Array.from({ length: total }, (_, i) => i);
      const vistas: number[] = [];
      for (let p = 1; p <= totalPaginas(total, POR_PAGINA); p++) {
        vistas.push(...rodaja(filas, p, POR_PAGINA));
      }
      assert.deepEqual(vistas, filas, `con ${total} filas`);
    }
  });
});
