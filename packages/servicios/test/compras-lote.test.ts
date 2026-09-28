/**
 * Carga en serie del registro de compras.
 *
 * Lo que se fija aquí es lo que hace que pegar doscientas líneas sea seguro:
 * que se analice antes de escribir, que una fila mala no arrastre a las buenas,
 * y que volver a pegar la hoja corregida no duplique lo que ya entró.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, analizarLote, registrarLote, LoteInvalido, listarCompras,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  app = conectar({ url: URL, rol: "app", max: 4 });
});

after(async () => {
  await raw?.end();
  await app?.cliente.end();
});

beforeEach(async () => {
  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  const e = await crearEmpresa(
    URL,
    { ruc: "20303051831", razonSocial: "SERVIDIMAR S.A.C." },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  for (const [ruc, razon] of [
    ["20512333338", "AGENCIA DE ADUANAS DEL SUR S.A.C."],
    ["20477771117", "TRANSPORTES MARITIMOS ANDINOS S.A."],
  ] as const) {
    await raw`
      INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                            pais, es_proveedor)
      VALUES (${empresaId}, '6', ${ruc}, ${razon}, 'PE', true)`;
  }
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const tx = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

/** Tres facturas buenas, tal como salen de pegar un Excel peruano. */
const HOJA_BUENA = [
  "Fecha\tTipo\tSerie\tNúmero\tRUC\tMoneda\tT.C.\tBase\tIGV\tCuenta\tC.Costo\tGlosa",
  "01/09/2026\t01\tF001\t1234\t20512333338\tPEN\t1\t1.500,00\t270,00\t639\tGEN\tAgenciamiento de aduana",
  "03/09/2026\t01\tF001\t1235\t20512333338\tPEN\t1\t850,50\t153,09\t639\tGEN\tGastos operativos",
  "2026-09-05\t01\tF200\t77\t20477771117\tPEN\t1\t4200.00\t756.00\t6311\tGEN\tFlete de Callao a Moquegua",
].join("\n");

describe("análisis previo", () => {
  test("entiende el Excel peruano: fechas DD/MM y miles con punto", async () => {
    const a = await con((db) => analizarLote(db, empresaId, HOJA_BUENA));
    assert.equal(a.filas.length, 3, "la fila de títulos se descarta sola");
    assert.equal(a.listas, 3);
    assert.equal(a.conProblemas, 0);
    // 1 770 + 1 003,59 + 4 956. Si «1.500,00» se hubiera leído como uno con
    // cinco, el total saldría en 5 960,59 y nadie lo notaría hasta conciliar.
    assert.equal(a.totalAContabilizar, "7729.59");
    assert.equal(a.filas[0]!.proveedor, "AGENCIA DE ADUANAS DEL SUR S.A.C.");
  });

  test("dice qué falla en cada fila sin escribir nada", async () => {
    const hoja = [
      "01/09/2026\t01\tF001\t1234\t20999999999\tPEN\t1\t100\t18\t639\tGEN\tProveedor desconocido",
      "01/13/2026\t01\tF001\t1235\t20512333338\tPEN\t1\t100\t18\t639\tGEN\tFecha imposible",
      "02/09/2026\t01\tF001\t1236\t20512333338\tPEN\t1\t100\t18\t63\tGEN\tCuenta que no admite movimiento",
      "03/09/2026\t01\tF001\t1237\t20512333338\tUSD\t1\t100\t18\t639\tGEN\tDólares sin tipo de cambio",
    ].join("\n");

    const a = await con((db) => analizarLote(db, empresaId, hoja));
    assert.equal(a.listas, 0);
    assert.equal(a.conProblemas, 4);
    assert.match(a.filas[0]!.problemas.join(" "), /20999999999 no está en el maestro/);
    assert.match(a.filas[1]!.problemas.join(" "), /fecha no se entiende/);
    assert.match(a.filas[2]!.problemas.join(" "), /no admite movimiento/);
    assert.match(a.filas[3]!.problemas.join(" "), /necesita su tipo de cambio/);
    assert.deepEqual(a.proveedoresFaltantes, ["20999999999"]);

    const [{ n }] = await raw<{ n: number }[]>`SELECT count(*)::int AS n FROM compras`;
    assert.equal(n, 0, "analizar no escribe");
  });

  test("una hoja vacía se rechaza en vez de registrar cero facturas en silencio", async () => {
    await assert.rejects(() => con((db) => analizarLote(db, empresaId, "   \n\n")), LoteInvalido);
  });
});

describe("registro", () => {
  test("registra las tres con su asiento y su cuenta por pagar", async () => {
    const a = await con((db) => analizarLote(db, empresaId, HOJA_BUENA));
    const r = await registrarLote(tx, empresaId, usuarioId, a);

    assert.equal(r.registradas.length, 3);
    assert.equal(r.rechazadas.length, 0);
    assert.equal(r.total, "7729.59");

    const lista = await con((db) => listarCompras(db));
    assert.equal(lista.length, 3);
    const [{ asientos }] = await raw<{ asientos: number }[]>`
      SELECT count(*)::int AS asientos FROM compras WHERE asiento_id IS NOT NULL`;
    assert.equal(asientos, 3, "cada factura deja su asiento");
    const [{ cxp }] = await raw<{ cxp: number }[]>`
      SELECT count(*)::int AS cxp FROM documentos_cxp`;
    assert.equal(cxp, 3, "y su cuenta por pagar");
  });

  test("una fila mala no arrastra a las buenas", async () => {
    // Es la decisión central del módulo. Con todo en una transacción, la fila
    // del RUC inventado tumbaría las dos correctas y quien pegó doscientas
    // líneas tendría que empezar de cero sin saber cuál falló.
    const hoja = [
      "01/09/2026\t01\tF001\t1234\t20512333338\tPEN\t1\t1500\t270\t639\tGEN\tBuena",
      "02/09/2026\t01\tF001\t1235\t20999999999\tPEN\t1\t900\t162\t639\tGEN\tRUC inventado",
      "03/09/2026\t01\tF200\t77\t20477771117\tPEN\t1\t4200\t756\t6311\tGEN\tBuena",
    ].join("\n");

    const a = await con((db) => analizarLote(db, empresaId, hoja));
    const r = await registrarLote(tx, empresaId, usuarioId, a);

    assert.equal(r.registradas.length, 2);
    assert.equal(r.rechazadas.length, 1);
    assert.equal(r.rechazadas[0]!.linea, 2, "dice qué línea de la hoja hay que corregir");
    assert.equal((await con((db) => listarCompras(db))).length, 2);
  });

  test("volver a pegar la hoja corregida no duplica lo que ya entró", async () => {
    // El flujo real: se pegan doscientas, fallan cuatro, se corrigen y se vuelve
    // a pegar la hoja entera porque separar las cuatro a mano es lo que nadie
    // hace. Las 196 que ya estaban salen omitidas, no repetidas ni en error.
    const primera = await con((db) => analizarLote(db, empresaId, HOJA_BUENA));
    await registrarLote(tx, empresaId, usuarioId, primera);

    const segunda = await con((db) => analizarLote(db, empresaId, HOJA_BUENA));
    assert.equal(segunda.repetidas, 3);
    assert.equal(segunda.listas, 0);
    assert.equal(segunda.totalAContabilizar, "0.00");

    const r = await registrarLote(tx, empresaId, usuarioId, segunda);
    assert.equal(r.registradas.length, 0);
    assert.equal(r.omitidas.length, 3);
    assert.equal(r.rechazadas.length, 0, "ya registrada no es un error, es un no-hacer");
    assert.equal((await con((db) => listarCompras(db))).length, 3);
  });

  test("una factura exonerada no inventa crédito fiscal", async () => {
    // El IGV sale de lo que trae la hoja, no de recalcular el 18 %. Con IGV cero
    // la línea va como exonerada; recalcularla daría un crédito que no existe.
    const hoja =
      "04/09/2026\t01\tF001\t9001\t20512333338\tPEN\t1\t1000\t0\t639\tGEN\tSeguro exonerado";
    const a = await con((db) => analizarLote(db, empresaId, hoja));
    assert.equal(a.listas, 1);
    await registrarLote(tx, empresaId, usuarioId, a);

    const [c] = await raw<{ igv: string; total: string }[]>`
      SELECT igv::text, total::text FROM compras WHERE numero = '9001'`;
    assert.equal(Number(c!.igv), 0);
    assert.equal(Number(c!.total), 1000);
  });
});
