import { test } from "node:test";
import assert from "node:assert/strict";
import { expediente, DOCUMENTOS_IMPORTACION } from "../src/importaciones/documentos.ts";

test("lo que ya hacía falta y no está se separa de lo que falta más adelante", () => {
  // Embarque salido, nada recibido. El conocimiento de embarque hace falta para
  // la llegada, no para el embarque: todavía no está vencido.
  const e = expediente([], "embarque");
  assert.deepEqual(e.vencidos.map((d) => d.clave), []);
  assert.ok(e.pendientes.some((d) => d.clave === "conocimiento_embarque"));
  assert.equal(e.completo, true, "nada exigible aún; el expediente va al día");

  // Con la DUA numerada sí: factura, packing list y conocimiento debían estar.
  const enAduana = expediente([], "numeracion");
  assert.deepEqual(
    enAduana.vencidos.map((d) => d.clave).sort(),
    ["conocimiento_embarque", "factura_exterior", "packing_list"],
  );
  assert.equal(enAduana.completo, false);
});

test("un documento marcado como no aplicable deja de faltar para siempre", () => {
  // Un certificado de origen sin acuerdo comercial. Si siguiera en rojo, el
  // cuadro quedaría siempre en rojo y nadie volvería a mirarlo.
  const con = expediente(
    [{ tipo: "certificado_origen", recibidoEn: null, noAplica: true }],
    "liquidacion",
  );
  assert.ok(!con.vencidos.some((d) => d.clave === "certificado_origen"));
  assert.ok(!con.pendientes.some((d) => d.clave === "certificado_origen"));
});

test("un documento opcional registrado sí se sigue esperando", () => {
  // Quien anota que hay póliza de seguro en camino quiere que el cuadro se lo
  // recuerde; los opcionales que nadie mencionó no ensucian la lista.
  const sin = expediente([], "liquidacion");
  assert.ok(!sin.pendientes.some((d) => d.clave === "poliza_seguro"));

  const anotada = expediente(
    [{ tipo: "poliza_seguro", recibidoEn: null, noAplica: false }],
    "llegada",
  );
  assert.ok(anotada.vencidos.some((d) => d.clave === "poliza_seguro"));
});

test("cada documento del catálogo declara antes de qué hito hace falta", () => {
  // Sin el hito la lista sería un inventario y no un aviso: diría qué falta
  // pero no si eso ya es un problema.
  for (const d of DOCUMENTOS_IMPORTACION) {
    assert.ok(d.clave && d.nombre && d.antesDe, `documento incompleto: ${d.clave}`);
  }
  const claves = DOCUMENTOS_IMPORTACION.map((d) => d.clave);
  assert.equal(new Set(claves).size, claves.length, "no puede haber claves repetidas");
});
