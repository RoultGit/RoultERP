/**
 * Kits y conversión de unidades.
 *
 * La regla que se comprueba una y otra vez es la misma: armar, desarmar o
 * convertir no crea ni destruye valor. La mercadería sigue valiendo lo mismo,
 * sólo que ahora está en otra fila del kardex.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, existencias, balanceComprobacion,
  definirComposicion, cargarComposicion, listarComposiciones, armar, desarmar,
  cerrarPeriodo, ComposicionInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let proveedor = "";
const p: Record<string, string> = {};

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

  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = prov!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;

  for (const [codigo, descripcion] of [
    ["KIT-BOT", "Botiquín armado"],
    ["GASA", "Gasa estéril"],
    ["ALCO", "Alcohol 70°"],
    ["SACO-50", "Cemento saco 50 kg"],
    ["BOLSA-1", "Cemento bolsa 1 kg"],
    ["SERV", "Servicio de armado"],
  ] as const) {
    const [fila] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, tipo)
      VALUES (${empresaId}, ${codigo}, ${descripcion}, ${u!.id},
              ${codigo === "SERV" ? "servicio" : "bien"})
      RETURNING id`;
    p[codigo] = fila!.id;
  }
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

/** Compra que deja stock con un costo conocido. */
async function comprar(lineas: { codigo: string; cantidad: string; valor: string }[], numero: string) {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero,
      fechaEmision: "2026-09-01",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: lineas.map((l) => ({
        productoId: p[l.codigo]!,
        descripcion: l.codigo,
        cantidad: l.cantidad,
        valorUnitario: l.valor,
      })),
    }),
  );
}

const stockDe = async (codigo: string) => {
  const e = await con((db) => existencias(db, almacen));
  const f = e.find((x) => x.codigo === codigo);
  return { cantidad: f ? d(f.cantidad) : money.ZERO, valor: f ? d(f.valor) : money.ZERO };
};

const valorDelAlmacen = async () => {
  const e = await con((db) => existencias(db, almacen));
  return e.reduce((a, x) => money.add(a, d(x.valor)), money.ZERO);
};

const libroCuadra = async () => {
  const b = await con((db) => balanceComprobacion(db, "202609"));
  return money.toString(b.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO), 2);
};

/** Botiquín: 2 gasas a 5.00 y 1 alcohol a 12.00 → 22.00 cada uno. */
const receta = () =>
  con((db) =>
    definirComposicion(db, empresaId, usuarioId, p["KIT-BOT"]!, "kit", [
      { componenteId: p["GASA"]!, cantidad: "2" },
      { componenteId: p["ALCO"]!, cantidad: "1" },
    ]),
  );

// ─── Receta ───────────────────────────────────────────────────────────────

describe("composición de un producto", () => {
  test("se define y se lee", async () => {
    await receta();
    const { componentes, tipo } = await con((db) => cargarComposicion(db, p["KIT-BOT"]!));
    assert.equal(tipo, "kit");
    assert.equal(componentes.length, 2);
    assert.equal(s2(componentes.find((c) => c.codigo === "GASA")!.cantidad), "2.00");
  });

  test("redefinirla reemplaza la anterior entera", async () => {
    await receta();
    await con((db) =>
      definirComposicion(db, empresaId, usuarioId, p["KIT-BOT"]!, "kit", [
        { componenteId: p["GASA"]!, cantidad: "3" },
      ]),
    );
    const { componentes } = await con((db) => cargarComposicion(db, p["KIT-BOT"]!));
    assert.equal(componentes.length, 1);
    assert.equal(s2(componentes[0]!.cantidad), "3.00");
  });

  test("un producto no se compone de sí mismo", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          definirComposicion(db, empresaId, usuarioId, p["KIT-BOT"]!, "kit", [
            { componenteId: p["KIT-BOT"]!, cantidad: "1" },
          ]),
        ),
      /de sí mismo/,
    );
  });

  test("un servicio no lleva kardex y no se arma", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          definirComposicion(db, empresaId, usuarioId, p["SERV"]!, "kit", [
            { componenteId: p["GASA"]!, cantidad: "1" },
          ]),
        ),
      /sólo un bien tiene composición/,
    );
  });

  test("una conversión sale de un solo origen", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          definirComposicion(db, empresaId, usuarioId, p["BOLSA-1"]!, "conversion", [
            { componenteId: p["SACO-50"]!, cantidad: "1" },
            { componenteId: p["GASA"]!, cantidad: "1" },
          ]),
        ),
      /un solo producto de origen/,
    );
  });

  test("aparece en el listado de lo que se puede armar", async () => {
    await receta();
    const lista = await con((db) => listarComposiciones(db, "kit"));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.codigo, "KIT-BOT");
    assert.equal(Number(lista[0]!.componentes), 2);
  });
});

// ─── Armado ───────────────────────────────────────────────────────────────

describe("armar un kit", () => {
  async function conStock() {
    await comprar(
      [
        { codigo: "GASA", cantidad: "100", valor: "5" },
        { codigo: "ALCO", cantidad: "50", valor: "12" },
      ],
      "0000001",
    );
    await receta();
  }

  /*
   * El `productoId` llega de un formulario, así que hay que tratarlo como texto
   * hostil hasta que la consulta lo parametrice.
   *
   * Antes la comprobación de «todos los componentes contra la misma cuenta»
   * armaba su `IN (...)` concatenando cadenas: `ids.map(i => `'${i}'`)`. Con una
   * comilla dentro del identificador eso deja de ser un valor y pasa a ser SQL.
   * Hoy va por `inArray`, que lo manda como parámetro, y la base lo rechaza por
   * no ser un UUID en vez de ejecutarlo.
   */
  test("un identificador con comillas no se ejecuta como SQL", async () => {
    await conStock();
    const antes = await valorDelAlmacen();

    for (const veneno of [
      "' OR '1'='1",
      "'); DROP TABLE productos; --",
      `${"00000000-0000-0000-0000-000000000000"}' UNION SELECT NULL--`,
    ]) {
      await assert.rejects(
        con((db) =>
          armar(db, empresaId, usuarioId, {
            productoId: veneno,
            cantidad: "1",
            fecha: "2026-09-15",
            almacenId: almacen,
          }),
        ),
        "el identificador tiene que ser rechazado, no interpretado",
      );
    }

    // Y lo que importa de verdad: nada se movió ni se borró.
    assert.equal(await valorDelAlmacen(), antes);
    const [{ n }] = (await raw`SELECT count(*)::int AS n FROM productos`) as unknown as [
      { n: number },
    ];
    assert.ok(n > 0, "la tabla productos sigue ahí");
  });

  test("consume los componentes y produce el kit a su costo exacto", async () => {
    await conStock();
    const antes = await valorDelAlmacen();

    const r = await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!,
        cantidad: "10",
        fecha: "2026-09-15",
        almacenId: almacen,
      }),
    );

    // 10 × (2 × 5 + 1 × 12) = 220.00.
    assert.equal(r.importe, "220.00");
    assert.equal(s2(r.costoUnitario), "22.00");
    assert.match(r.numero, /^KA2026-\d{6}$/);

    const kit = await stockDe("KIT-BOT");
    assert.equal(money.toString(kit.cantidad, 2), "10.00");
    assert.equal(money.toString(kit.valor, 2), "220.00");

    // Y los componentes bajaron lo que tocaba.
    assert.equal(money.toString((await stockDe("GASA")).cantidad, 2), "80.00");
    assert.equal(money.toString((await stockDe("ALCO")).cantidad, 2), "40.00");

    // La regla dura: el almacén vale lo mismo antes y después.
    assert.equal(money.toString(await valorDelAlmacen(), 2), money.toString(antes, 2));
  });

  test("no genera asiento: la mercadería no cambia de cuenta", async () => {
    await conStock();
    const antes = await libroCuadra();
    await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!, cantidad: "5", fecha: "2026-09-15", almacenId: almacen,
      }),
    );
    const asientos = await raw<{ n: string }[]>`
      SELECT count(*)::text AS n FROM asientos
      WHERE empresa_id = ${empresaId} AND origen_modulo = 'kits'`;
    assert.equal(asientos[0]!.n, "0");
    assert.equal(await libroCuadra(), antes);
  });

  test("se planta si no hay stock de un componente", async () => {
    await receta();
    await comprar([{ codigo: "GASA", cantidad: "5", valor: "5" }], "0000001");
    await assert.rejects(
      () =>
        con((db) =>
          armar(db, empresaId, usuarioId, {
            productoId: p["KIT-BOT"]!, cantidad: "10", fecha: "2026-09-15", almacenId: almacen,
          }),
        ),
      /no hay stock suficiente/,
    );
  });

  test("sin receta no se arma", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          armar(db, empresaId, usuarioId, {
            productoId: p["KIT-BOT"]!, cantidad: "1", fecha: "2026-09-15", almacenId: almacen,
          }),
        ),
      /no tiene composición definida/,
    );
  });

  test("respeta el cierre de periodo", async () => {
    await conStock();
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609"));
    await assert.rejects(
      () =>
        con((db) =>
          armar(db, empresaId, usuarioId, {
            productoId: p["KIT-BOT"]!, cantidad: "1", fecha: "2026-09-15", almacenId: almacen,
          }),
        ),
      /cerrado/,
    );
  });

  test("rechaza cantidad cero", async () => {
    await conStock();
    await assert.rejects(
      () =>
        con((db) =>
          armar(db, empresaId, usuarioId, {
            productoId: p["KIT-BOT"]!, cantidad: "0", fecha: "2026-09-15", almacenId: almacen,
          }),
        ),
      /debe ser positiva/,
    );
  });
});

// ─── Desarmado ────────────────────────────────────────────────────────────

describe("desarmar un kit", () => {
  async function conKits() {
    await comprar(
      [
        { codigo: "GASA", cantidad: "100", valor: "5" },
        { codigo: "ALCO", cantidad: "50", valor: "12" },
      ],
      "0000001",
    );
    await receta();
    await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!, cantidad: "10", fecha: "2026-09-15", almacenId: almacen,
      }),
    );
  }

  test("devuelve los componentes conservando el valor", async () => {
    await conKits();
    const antes = await valorDelAlmacen();

    const r = await con((db) =>
      desarmar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!, cantidad: "4", fecha: "2026-09-20", almacenId: almacen,
      }),
    );
    assert.equal(r.importe, "88.00");
    assert.match(r.numero, /^KD2026-\d{6}$/);

    assert.equal(money.toString((await stockDe("KIT-BOT")).cantidad, 2), "6.00");
    // Vuelven 8 gasas y 4 alcoholes.
    assert.equal(money.toString((await stockDe("GASA")).cantidad, 2), "88.00");
    assert.equal(money.toString((await stockDe("ALCO")).cantidad, 2), "44.00");

    assert.equal(money.toString(await valorDelAlmacen(), 2), money.toString(antes, 2));
    assert.equal(await libroCuadra(), "0.00");
  });

  test("armar y desarmar todo deja el almacén como estaba", async () => {
    await comprar(
      [
        { codigo: "GASA", cantidad: "100", valor: "5" },
        { codigo: "ALCO", cantidad: "50", valor: "12" },
      ],
      "0000001",
    );
    await receta();
    const inicial = await valorDelAlmacen();

    await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!, cantidad: "10", fecha: "2026-09-15", almacenId: almacen,
      }),
    );
    await con((db) =>
      desarmar(db, empresaId, usuarioId, {
        productoId: p["KIT-BOT"]!, cantidad: "10", fecha: "2026-09-16", almacenId: almacen,
      }),
    );

    assert.equal(money.toString(await valorDelAlmacen(), 2), money.toString(inicial, 2));
    assert.equal(money.toString((await stockDe("GASA")).cantidad, 2), "100.00");
    assert.equal(money.toString((await stockDe("ALCO")).cantidad, 2), "50.00");
    assert.equal(money.toString((await stockDe("KIT-BOT")).cantidad, 2), "0.00");
  });

  test("no se desarma lo que no hay", async () => {
    await conKits();
    await assert.rejects(
      () =>
        con((db) =>
          desarmar(db, empresaId, usuarioId, {
            productoId: p["KIT-BOT"]!, cantidad: "99", fecha: "2026-09-20", almacenId: almacen,
          }),
        ),
      /no hay stock suficiente/,
    );
  });
});

// ─── Conversión de unidades ───────────────────────────────────────────────

describe("conversión de unidades", () => {
  /** Un saco de 50 kg a 25.00 pasa a ser 50 bolsas de 1 kg. */
  async function conSacos() {
    await comprar([{ codigo: "SACO-50", cantidad: "10", valor: "25" }], "0000001");
    await con((db) =>
      definirComposicion(db, empresaId, usuarioId, p["BOLSA-1"]!, "conversion", [
        { componenteId: p["SACO-50"]!, cantidad: "0.02" },
      ]),
    );
  }

  test("convierte sin cambiar el valor del almacén", async () => {
    await conSacos();
    const antes = await valorDelAlmacen();

    const r = await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["BOLSA-1"]!, cantidad: "250", fecha: "2026-09-15", almacenId: almacen,
      }),
    );
    // 250 bolsas × 0.02 = 5 sacos × 25.00 = 125.00.
    assert.equal(r.importe, "125.00");
    assert.equal(s2(r.costoUnitario), "0.50");
    assert.match(r.numero, /^CV2026-\d{6}$/);

    assert.equal(money.toString((await stockDe("SACO-50")).cantidad, 2), "5.00");
    assert.equal(money.toString((await stockDe("BOLSA-1")).cantidad, 2), "250.00");
    assert.equal(money.toString(await valorDelAlmacen(), 2), money.toString(antes, 2));
  });

  test("la vuelta atrás también conserva el valor", async () => {
    await conSacos();
    const inicial = await valorDelAlmacen();
    await con((db) =>
      armar(db, empresaId, usuarioId, {
        productoId: p["BOLSA-1"]!, cantidad: "250", fecha: "2026-09-15", almacenId: almacen,
      }),
    );
    await con((db) =>
      desarmar(db, empresaId, usuarioId, {
        productoId: p["BOLSA-1"]!, cantidad: "250", fecha: "2026-09-16", almacenId: almacen,
      }),
    );
    assert.equal(money.toString(await valorDelAlmacen(), 2), money.toString(inicial, 2));
    assert.equal(money.toString((await stockDe("SACO-50")).cantidad, 2), "10.00");
  });
});
