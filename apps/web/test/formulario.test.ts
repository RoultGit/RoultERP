import { test } from "node:test";
import assert from "node:assert/strict";
import { filas, leerLineasAsiento } from "../lib/formulario";

const form = (pares: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of pares) f.append(k, v);
  return f;
};

test("lee las líneas en el orden del formulario, no en el de las claves", () => {
  // El navegador manda los campos agrupados por fila, pero nada lo garantiza:
  // aquí llegan mezclados a propósito.
  const lineas = leerLineasAsiento(
    form([
      ["glosa", "cabecera que no es una línea"],
      ["linea[1][cuenta]", "4212"],
      ["linea[0][cuenta]", "6011"],
      ["linea[1][haber]", "1180.00"],
      ["linea[0][debe]", "1000.00"],
      ["linea[0][glosa]", " compra de mercadería "],
    ]),
  );

  assert.deepEqual(lineas, [
    { cuenta: "6011", debe: "1000.00", haber: "0", glosa: "compra de mercadería" },
    { cuenta: "4212", debe: "0", haber: "1180.00" },
  ]);
});

test("descarta las filas sin cuenta y conserva anexo y centro de costo", () => {
  const lineas = leerLineasAsiento(
    form([
      ["linea[0][cuenta]", "6391"],
      ["linea[0][debe]", "800.00"],
      ["linea[0][centroCostoId]", "cc-1"],
      ["linea[1][cuenta]", ""],
      ["linea[1][debe]", "999.00"],
      ["linea[2][cuenta]", "4699"],
      ["linea[2][haber]", "800.00"],
      ["linea[2][anexoId]", "t-1"],
    ]),
  );

  assert.equal(lineas.length, 2, "la fila vacía no cuenta");
  assert.deepEqual(lineas[0], { cuenta: "6391", debe: "800.00", haber: "0", centroCostoId: "cc-1" });
  assert.deepEqual(lineas[1], { cuenta: "4699", debe: "0", haber: "800.00", anexoId: "t-1" });
});

test("un índice de dos cifras no se ordena como texto", () => {
  // Con orden lexicográfico la línea 10 se colaría delante de la 2, y un
  // asiento de doce líneas saldría desordenado en los libros.
  const pares: [string, string][] = [];
  for (let i = 0; i < 12; i++) pares.push([`linea[${i}][cuenta]`, `c${i}`]);
  const lineas = leerLineasAsiento(form(pares.reverse()));
  assert.deepEqual(
    lineas.map((l) => l.cuenta),
    Array.from({ length: 12 }, (_, i) => `c${i}`),
  );
});

// ─── filas(): el iterador que sustituyó a ocho bucles con el índice a mano ───

test("filas recorre las líneas hasta que el formulario deja de mandarlas", () => {
  const f = form([
    ["lineas[0].cantidad", " 2 "],
    ["lineas[0].descripcion", "tubo de 2 pulgadas"],
    ["lineas[1].cantidad", "5"],
    ["lineas[1].descripcion", "codo"],
    // la fila 3 existe pero la 2 no: el recorrido se corta en la 2, que es lo
    // que hace el navegador cuando la tabla se envía completa.
    ["lineas[3].cantidad", "9"],
  ]);

  const leidas = [...filas(f, "cantidad")].map((campo) => [
    campo("cantidad"),
    campo("descripcion"),
  ]);

  assert.deepEqual(leidas, [
    ["2", "tubo de 2 pulgadas"],
    ["5", "codo"],
  ]);
});

test("cada fila lee sus propios campos y no los de la siguiente", () => {
  // El generador captura el índice al emitir el lector. Sin esa copia, todos
  // los lectores compartirían el índice final y cada línea saldría con los
  // datos de la última: el defecto clásico del cierre sobre la variable del
  // bucle, y el que haría facturar doce veces el mismo artículo.
  const f = form([
    ["lineas[0].productoId", "p-1"],
    ["lineas[1].productoId", "p-2"],
    ["lineas[2].productoId", "p-3"],
  ]);
  const lectores = [...filas(f, "productoId")];
  assert.deepEqual(lectores.map((c) => c("productoId")), ["p-1", "p-2", "p-3"]);
});

test("un campo que no viene es cadena vacía, no undefined", () => {
  const f = form([["lineas[0].cantidad", "1"]]);
  const [campo] = [...filas(f, "cantidad")];
  assert.equal(campo!("descuento"), "");
});
