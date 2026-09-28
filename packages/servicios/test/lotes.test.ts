/**
 * Control por lotes y series.
 *
 * Las columnas existían desde el principio y nadie las obligaba: un producto
 * marcado «controla lote» se movía sin lote y la trazabilidad quedaba en una
 * intención. Esto comprueba que ahora sí se exige, y que el saldo de cada lote
 * y cada serie se deriva del kardex en vez de guardarse aparte.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarMovimiento, existencias,
  saldoDeLote, serieEnStock, existenciasPorLote, seriesEnStock,
  guardarLote, listarLotes, InventarioInvalido,
} from "../src/index.ts";
import { TIPO_OPERACION } from "@roulterp/core/inventario";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let almacenDos = "";
let conLote = "";
let conSerie = "";
let libre = "";

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [a] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a!.id;
  const [suc] = await raw<{ id: string }[]>`
    SELECT id FROM sucursales WHERE empresa_id = ${empresaId} LIMIT 1`;
  const [a2] = await raw<{ id: string }[]>`
    INSERT INTO almacenes (empresa_id, sucursal_id, codigo, nombre)
    VALUES (${empresaId}, ${suc!.id}, '002', 'Almacén de obra') RETURNING id`;
  almacenDos = a2!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;

  const [pl] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, control_lote)
    VALUES (${empresaId}, 'MED-01', 'Suero fisiológico 500 ml', ${u!.id}, true) RETURNING id`;
  conLote = pl!.id;

  const [ps] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, control_serie)
    VALUES (${empresaId}, 'MOT-01', 'Motor eléctrico 5HP', ${u!.id}, true) RETURNING id`;
  conSerie = ps!.id;

  const [pn] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'GEN-01', 'Tornillo', ${u!.id}) RETURNING id`;
  libre = pn!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);

const ingresar = (
  productoId: string,
  cantidad: string,
  extra: { lote?: string; serie?: string; almacenId?: string; costo?: string } = {},
) =>
  con((db) =>
    registrarMovimiento(db, empresaId, {
      almacenId: extra.almacenId ?? almacen,
      productoId,
      fecha: "2026-09-10",
      sentido: "ingreso",
      tipoOperacion: TIPO_OPERACION.COMPRA,
      cantidad: d(cantidad),
      costoUnitario: d(extra.costo ?? "10"),
      ...(extra.lote ? { lote: extra.lote } : {}),
      ...(extra.serie ? { serie: extra.serie } : {}),
    }),
  );

const sacar = (
  productoId: string,
  cantidad: string,
  extra: { lote?: string; serie?: string; almacenId?: string } = {},
) =>
  con((db) =>
    registrarMovimiento(db, empresaId, {
      almacenId: extra.almacenId ?? almacen,
      productoId,
      fecha: "2026-09-15",
      sentido: "salida",
      tipoOperacion: TIPO_OPERACION.VENTA,
      cantidad: d(cantidad),
      ...(extra.lote ? { lote: extra.lote } : {}),
      ...(extra.serie ? { serie: extra.serie } : {}),
    }),
  );

// ─── Lotes ────────────────────────────────────────────────────────────────

describe("control por lote", () => {
  test("no deja mover sin lote lo que se controla por lote", async () => {
    await assert.rejects(() => ingresar(conLote, "100"), /indique el lote/);
  });

  test("un producto sin control se mueve sin lote, como siempre", async () => {
    await assert.doesNotReject(() => ingresar(libre, "100"));
  });

  test("el saldo de cada lote sale del kardex", async () => {
    await ingresar(conLote, "100", { lote: "L-2609" });
    await ingresar(conLote, "50", { lote: "L-2610" });
    await sacar(conLote, "30", { lote: "L-2609" });

    assert.equal(
      money.toString(await con((db) => saldoDeLote(db, almacen, conLote, "L-2609")), 2),
      "70.00",
    );
    assert.equal(
      money.toString(await con((db) => saldoDeLote(db, almacen, conLote, "L-2610")), 2),
      "50.00",
    );
    // Y el total del producto sigue siendo la suma.
    const e = await con((db) => existencias(db, almacen));
    assert.equal(money.toString(d(e.find((x) => x.codigo === "MED-01")!.cantidad), 2), "120.00");
  });

  /** Sin esto, el stock total alcanza y el lote concreto no, y nadie se entera. */
  test("no deja sacar de un lote más de lo que ese lote tiene", async () => {
    await ingresar(conLote, "100", { lote: "L-2609" });
    await ingresar(conLote, "50", { lote: "L-2610" });
    await assert.rejects(
      () => sacar(conLote, "80", { lote: "L-2610" }),
      /el lote L-2610 de MED-01 sólo tiene 50/,
    );
  });

  test("el lote de un almacén no cubre la salida de otro", async () => {
    await ingresar(conLote, "100", { lote: "L-2609" });
    await assert.rejects(
      () => sacar(conLote, "10", { lote: "L-2609", almacenId: almacenDos }),
      /sólo tiene 0/,
    );
  });

  test("guarda el vencimiento y lo muestra con las existencias", async () => {
    await ingresar(conLote, "100", { lote: "L-2609" });
    await con((db) =>
      guardarLote(db, empresaId, usuarioId, {
        productoId: conLote,
        codigo: "L-2609",
        fechaFabricacion: "2026-03-01",
        fechaVencimiento: "2027-03-01",
      }),
    );

    const filas = await con((db) => existenciasPorLote(db));
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.lote, "L-2609");
    assert.equal(filas[0]!.fecha_vencimiento, "2027-03-01");
    assert.equal(money.toString(d(filas[0]!.cantidad), 2), "100.00");
  });

  test("filtra los que vencen antes de una fecha", async () => {
    await ingresar(conLote, "10", { lote: "L-PRONTO" });
    await ingresar(conLote, "10", { lote: "L-LEJOS" });
    await con((db) =>
      guardarLote(db, empresaId, usuarioId, {
        productoId: conLote, codigo: "L-PRONTO", fechaVencimiento: "2026-10-15",
      }),
    );
    await con((db) =>
      guardarLote(db, empresaId, usuarioId, {
        productoId: conLote, codigo: "L-LEJOS", fechaVencimiento: "2028-01-01",
      }),
    );

    const porVencer = await con((db) => existenciasPorLote(db, { venceAntesDe: "2026-12-31" }));
    assert.deepEqual(porVencer.map((f) => f.lote), ["L-PRONTO"]);
  });

  test("un lote agotado no figura en existencias", async () => {
    await ingresar(conLote, "10", { lote: "L-X" });
    await sacar(conLote, "10", { lote: "L-X" });
    assert.deepEqual(await con((db) => existenciasPorLote(db)), []);
  });

  test("el vencimiento no puede ser anterior a la fabricación", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarLote(db, empresaId, usuarioId, {
            productoId: conLote,
            codigo: "L-MAL",
            fechaFabricacion: "2026-05-01",
            fechaVencimiento: "2026-04-01",
          }),
        ),
      /anterior a la fabricación/,
    );
  });

  test("guardar dos veces el mismo lote lo actualiza", async () => {
    await con((db) =>
      guardarLote(db, empresaId, usuarioId, {
        productoId: conLote, codigo: "L-1", fechaVencimiento: "2027-01-01",
      }),
    );
    await con((db) =>
      guardarLote(db, empresaId, usuarioId, {
        productoId: conLote, codigo: "L-1", fechaVencimiento: "2027-06-01",
      }),
    );
    const lista = await con((db) => listarLotes(db, conLote));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.fechaVencimiento, "2027-06-01");
  });
});

// ─── Series ───────────────────────────────────────────────────────────────

describe("control por serie", () => {
  test("no deja mover sin serie lo que se controla por serie", async () => {
    await assert.rejects(() => ingresar(conSerie, "1"), /indique la serie/);
  });

  /** Dos unidades con la misma serie no son dos unidades: son un error. */
  test("cada movimiento con serie es de una unidad", async () => {
    await assert.rejects(
      () => ingresar(conSerie, "3", { serie: "MT-0001" }),
      /cada movimiento es de una unidad/,
    );
  });

  test("no deja ingresar dos veces la misma serie", async () => {
    await ingresar(conSerie, "1", { serie: "MT-0001" });
    await assert.rejects(
      () => ingresar(conSerie, "1", { serie: "MT-0001" }),
      /ya está en el almacén/,
    );
  });

  test("no deja sacar una serie que no está", async () => {
    await assert.rejects(
      () => sacar(conSerie, "1", { serie: "MT-9999" }),
      /no está en ningún almacén/,
    );
  });

  test("vendida, la serie se puede volver a ingresar", async () => {
    await ingresar(conSerie, "1", { serie: "MT-0001" });
    await sacar(conSerie, "1", { serie: "MT-0001" });
    assert.equal(await con((db) => serieEnStock(db, conSerie, "MT-0001")), false);
    // Una devolución del cliente vuelve a entrar con la misma serie.
    await assert.doesNotReject(() => ingresar(conSerie, "1", { serie: "MT-0001" }));
  });

  test("dice qué unidad está en qué almacén", async () => {
    await ingresar(conSerie, "1", { serie: "MT-0001" });
    await ingresar(conSerie, "1", { serie: "MT-0002", almacenId: almacenDos });
    const filas = await con((db) => seriesEnStock(db));
    assert.equal(filas.length, 2);
    assert.equal(filas.find((f) => f.serie === "MT-0002")!.almacen, "Almacén de obra");
  });

  test("la vendida desaparece del listado", async () => {
    await ingresar(conSerie, "1", { serie: "MT-0001" });
    await sacar(conSerie, "1", { serie: "MT-0001" });
    assert.deepEqual(await con((db) => seriesEnStock(db)), []);
  });
});
