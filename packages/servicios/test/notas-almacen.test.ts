/**
 * Notas de almacén.
 *
 * Lo que se comprueba aquí es lo que distingue un ERP de una hoja de cálculo:
 * que mover mercadería de un almacén a otro no cambie su valor, que quien saca
 * no decida cuánto valía, y que el libro cuadre después de cada nota.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, registrarNota, listarNotas, cargarNota,
  existencias, balanceComprobacion, cerrarPeriodo, NotaInvalida, TIPO_NOTA,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let almacenDos = "";
let producto = "";
let proveedor = "";
let centroCosto = "";

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

  const [a1] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a1!.id;
  const [suc] = await raw<{ id: string }[]>`
    SELECT id FROM sucursales WHERE empresa_id = ${empresaId} LIMIT 1`;
  const [a2] = await raw<{ id: string }[]>`
    INSERT INTO almacenes (empresa_id, sucursal_id, codigo, nombre)
    VALUES (${empresaId}, ${suc!.id}, '002', 'Almacén de obra') RETURNING id`;
  almacenDos = a2!.id;

  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
  centroCosto = cc!.id;

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  proveedor = p!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'CEM-42', 'Cemento Portland 42.5 kg', ${u!.id}) RETURNING id`;
  producto = pr!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);
const d = (v: string) => money.dec(v);

/** 200 bolsas a 24.00 en el almacén principal. */
async function stockInicial() {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero: String(Date.now()).slice(-7),
      fechaEmision: "2026-09-02",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: [
        { productoId: producto, descripcion: "Cemento", cantidad: "200", valorUnitario: "24.00" },
      ],
    }),
  );
}

const stockDe = async (almacenId: string) => {
  const e = await con((db) => existencias(db, almacenId));
  const f = e.find((x) => x.codigo === "CEM-42");
  return { cantidad: f ? d(f.cantidad) : money.ZERO, valor: f ? d(f.valor) : money.ZERO };
};

const libroCuadra = async () => {
  const b = await con((db) => balanceComprobacion(db, "202609"));
  return money.toString(
    b.reduce((a, x) => money.add(a, d(x.saldo)), money.ZERO),
    2,
  );
};

// ─── Transferencia ────────────────────────────────────────────────────────

describe("transferencia entre almacenes", () => {
  test("mueve la mercadería sin cambiar su valor", async () => {
    await stockInicial();
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.TRANSFERENCIA,
        fecha: "2026-09-10",
        almacenId: almacen,
        almacenDestinoId: almacenDos,
        glosa: "Envío a la obra de San Miguel",
        lineas: [{ productoId: producto, cantidad: "50" }],
      }),
    );

    const origen = await stockDe(almacen);
    const destino = await stockDe(almacenDos);
    assert.equal(money.toString(origen.cantidad, 2), "150.00");
    assert.equal(money.toString(destino.cantidad, 2), "50.00");
    // 50 × 24.00: la mercadería vale lo mismo esté donde esté.
    assert.equal(money.toString(destino.valor, 2), "1200.00");
    assert.equal(s2(r.importe), "1200.00");
  });

  test("no genera asiento: la mercadería no cambia de cuenta", async () => {
    await stockInicial();
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.TRANSFERENCIA,
        fecha: "2026-09-10",
        almacenId: almacen,
        almacenDestinoId: almacenDos,
        glosa: "Envío a la obra",
        lineas: [{ productoId: producto, cantidad: "50" }],
      }),
    );
    assert.equal(r.asientoId, null);

    // Y el valor contable de las existencias no se movió.
    const b = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(b.find((x) => x.cuenta === "20111")!.saldo), "4800.00");
    assert.equal(await libroCuadra(), "0.00");
  });

  test("el total del almacén no cambia al transferir", async () => {
    await stockInicial();
    const antes = await con((db) => existencias(db));
    const valorAntes = antes.reduce((a, x) => money.add(a, d(x.valor)), money.ZERO);

    await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.TRANSFERENCIA,
        fecha: "2026-09-10",
        almacenId: almacen,
        almacenDestinoId: almacenDos,
        glosa: "Envío",
        lineas: [{ productoId: producto, cantidad: "80" }],
      }),
    );
    const despues = await con((db) => existencias(db));
    const valorDespues = despues.reduce((a, x) => money.add(a, d(x.valor)), money.ZERO);
    assert.equal(money.toString(valorDespues, 2), money.toString(valorAntes, 2));
  });

  test("no se transfiere a sí mismo", async () => {
    await stockInicial();
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.TRANSFERENCIA,
            fecha: "2026-09-10",
            almacenId: almacen,
            almacenDestinoId: almacen,
            glosa: "x",
            lineas: [{ productoId: producto, cantidad: "1" }],
          }),
        ),
      /distinto del de origen/,
    );
  });

  test("no se transfiere más de lo que hay", async () => {
    await stockInicial();
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.TRANSFERENCIA,
            fecha: "2026-09-10",
            almacenId: almacen,
            almacenDestinoId: almacenDos,
            glosa: "x",
            lineas: [{ productoId: producto, cantidad: "9999" }],
          }),
        ),
      /no hay stock suficiente/,
    );
  });
});

// ─── Salida ───────────────────────────────────────────────────────────────

describe("nota de salida", () => {
  test("el costo lo pone el kardex, no quien captura", async () => {
    await stockInicial();
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA,
        fecha: "2026-09-12",
        almacenId: almacen,
        glosa: "Consumo en obra propia",
        cuentaContrapartida: "6591",
        centroCostoId: centroCosto,
        // Se manda un costo absurdo a propósito: debe ignorarse.
        lineas: [{ productoId: producto, cantidad: "10", costoUnitario: "999.00" }],
      }),
    );
    assert.equal(s2(r.importe), "240.00", "10 × 24.00, el costo real del kardex");

    const b = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(b.find((x) => x.cuenta === "6591")!.saldo), "240.00");
    assert.equal(await libroCuadra(), "0.00");
  });

  test("baja el stock y el valor de la cuenta 20 a la vez", async () => {
    await stockInicial();
    await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA,
        fecha: "2026-09-12",
        almacenId: almacen,
        glosa: "Merma por rotura",
        cuentaContrapartida: "6591",
        centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "25" }],
      }),
    );
    const stock = await stockDe(almacen);
    const b = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(money.toString(stock.cantidad, 2), "175.00");
    assert.equal(
      money.toString(stock.valor, 2),
      s2(b.find((x) => x.cuenta === "20111")!.saldo),
      "el almacén y la cuenta 20 tienen que decir lo mismo",
    );
  });

  test("sin contrapartida no se registra", async () => {
    await stockInicial();
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.SALIDA,
            fecha: "2026-09-12",
            almacenId: almacen,
            glosa: "x",
            lineas: [{ productoId: producto, cantidad: "1" }],
          }),
        ),
      /cuenta contra la que se registra/,
    );
  });
});

// ─── Ingreso y ajuste ─────────────────────────────────────────────────────

describe("nota de ingreso y de ajuste", () => {
  test("un ingreso entra al costo indicado y abona su contrapartida", async () => {
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.INGRESO,
        fecha: "2026-09-01",
        almacenId: almacen,
        glosa: "Saldo inicial de existencias",
        cuentaContrapartida: "5911",
        lineas: [{ productoId: producto, cantidad: "100", costoUnitario: "23.50" }],
      }),
    );
    assert.equal(s2(r.importe), "2350.00");

    const stock = await stockDe(almacen);
    assert.equal(money.toString(stock.cantidad, 2), "100.00");
    assert.equal(await libroCuadra(), "0.00");
  });

  test("un ingreso sin costo no se registra", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.INGRESO,
            fecha: "2026-09-01",
            almacenId: almacen,
            glosa: "x",
            cuentaContrapartida: "5911",
            lineas: [{ productoId: producto, cantidad: "10" }],
          }),
        ),
      /necesita costo unitario/,
    );
  });

  test("el ajuste por faltante es un gasto y baja el stock", async () => {
    await stockInicial();
    await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.AJUSTE,
        sentidoAjuste: "salida",
        fecha: "2026-09-30",
        almacenId: almacen,
        glosa: "Faltante del inventario físico de setiembre",
        cuentaContrapartida: "6592",
        centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "3" }],
      }),
    );
    const stock = await stockDe(almacen);
    assert.equal(money.toString(stock.cantidad, 2), "197.00");
    const b = await con((db) => balanceComprobacion(db, "202609"));
    assert.equal(s2(b.find((x) => x.cuenta === "6592")!.saldo), "72.00");
    assert.equal(await libroCuadra(), "0.00");
  });

  test("el ajuste por sobrante entra y es un ingreso", async () => {
    await stockInicial();
    await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.AJUSTE,
        sentidoAjuste: "ingreso",
        fecha: "2026-09-30",
        almacenId: almacen,
        glosa: "Sobrante del inventario físico",
        cuentaContrapartida: "759",
        lineas: [{ productoId: producto, cantidad: "5", costoUnitario: "24.00" }],
      }),
    );
    const stock = await stockDe(almacen);
    assert.equal(money.toString(stock.cantidad, 2), "205.00");
    assert.equal(await libroCuadra(), "0.00");
  });

  test("la operación se marca con su código del catálogo 12", async () => {
    await stockInicial();
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.AJUSTE,
        sentidoAjuste: "salida",
        fecha: "2026-09-30",
        almacenId: almacen,
        glosa: "Faltante",
        cuentaContrapartida: "6592",
        centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "1" }],
      }),
    );
    const { cabecera } = await con((db) => cargarNota(db, r.notaId));
    // 17 es «ajuste de salida»: es lo que va al PLE 12.1 y 13.1.
    assert.equal(cabecera.tipoOperacion, "17");
  });
});

// ─── Reglas comunes ───────────────────────────────────────────────────────

describe("reglas de las notas", () => {
  test("cada tipo lleva su propia numeración", async () => {
    await stockInicial();
    const a = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA, fecha: "2026-09-12", almacenId: almacen,
        glosa: "Consumo", cuentaContrapartida: "6591", centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "1" }],
      }),
    );
    const b = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA, fecha: "2026-09-13", almacenId: almacen,
        glosa: "Consumo", cuentaContrapartida: "6591", centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "1" }],
      }),
    );
    const t = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.TRANSFERENCIA, fecha: "2026-09-14", almacenId: almacen,
        almacenDestinoId: almacenDos, glosa: "Envío",
        lineas: [{ productoId: producto, cantidad: "1" }],
      }),
    );
    assert.equal(a.numero, "00000001");
    assert.equal(b.numero, "00000002");
    assert.equal(t.numero, "00000001", "la transferencia numera aparte");
  });

  test("un periodo cerrado no admite ni siquiera una transferencia", async () => {
    // No genera asiento, pero mueve el kardex, y el kardex alimenta el
    // inventario valorizado de un mes que quizá ya se declaró.
    await stockInicial();
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609"));
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.TRANSFERENCIA, fecha: "2026-09-20", almacenId: almacen,
            almacenDestinoId: almacenDos, glosa: "Envío",
            lineas: [{ productoId: producto, cantidad: "1" }],
          }),
        ),
      /cerrado/,
    );
  });

  test("las notas se listan por tipo", async () => {
    await stockInicial();
    await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA, fecha: "2026-09-12", almacenId: almacen,
        glosa: "Consumo", cuentaContrapartida: "6591", centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "1" }],
      }),
    );
    assert.equal((await con((db) => listarNotas(db))).length, 1);
    assert.equal((await con((db) => listarNotas(db, TIPO_NOTA.SALIDA))).length, 1);
    assert.equal((await con((db) => listarNotas(db, TIPO_NOTA.INGRESO))).length, 0);
  });

  test("una nota sin artículos no se registra", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          registrarNota(db, empresaId, usuarioId, {
            tipo: TIPO_NOTA.INGRESO, fecha: "2026-09-01", almacenId: almacen,
            glosa: "x", cuentaContrapartida: "5911", lineas: [],
          }),
        ),
      /al menos un artículo/,
    );
  });

  test("el detalle guarda el costo con el que salió cada línea", async () => {
    await stockInicial();
    const r = await con((db) =>
      registrarNota(db, empresaId, usuarioId, {
        tipo: TIPO_NOTA.SALIDA, fecha: "2026-09-12", almacenId: almacen,
        glosa: "Consumo", cuentaContrapartida: "6591", centroCostoId: centroCosto,
        lineas: [{ productoId: producto, cantidad: "4" }],
      }),
    );
    const { items } = await con((db) => cargarNota(db, r.notaId));
    assert.equal(s2(items[0]!.costoUnitario!), "24.00");
    assert.equal(s2(items[0]!.importeLinea), "96.00");
  });
});
