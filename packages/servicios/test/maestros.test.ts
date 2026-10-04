import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, guardarProducto, listarProductos, desactivarProducto,
  guardarTercero, listarTerceros, listarUnidades, listarCuentas, sincronizarPlanCuentas,
  guardarSucursal, listarSucursales,
  MaestroInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let unidadNiu = "";

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
  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  unidadNiu = u!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

const productoBase = () => ({
  codigo: "P001",
  descripcion: "Bomba centrífuga 2HP",
  unidadId: unidadNiu,
  tipo: "bien" as const,
  afectacionIgv: "10",
  pesoUnitario: "12.5",
  volumenUnitario: "",
  stockMinimo: "5",
  controlLote: false,
  controlSerie: false,
});

const terceroBase = () => ({
  tipoDocumento: "6" as const,
  numeroDocumento: "20522633721",
  razonSocial: "HIDRAULICA DEL SUR S.A.C.",
  pais: "PE",
  esCliente: true,
  esProveedor: false,
  esDomiciliado: true,
  diasCredito: 30,
  limiteCredito: "50000",
  monedaLimite: "PEN",
});

describe("productos", () => {
  test("se guarda y aparece en la lista", async () => {
    await con((db) => guardarProducto(db, empresaId, productoBase()));
    const lista = await con((db) => listarProductos(db));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.codigo, "P001");
    assert.equal(lista[0]!.unidad, "NIU");
  });

  test("no se admiten dos productos con el mismo código", async () => {
    await con((db) => guardarProducto(db, empresaId, productoBase()));
    await assert.rejects(
      () => con((db) => guardarProducto(db, empresaId, { ...productoBase(), descripcion: "Otra" })),
      (e: unknown) => e instanceof MaestroInvalido && /P001/.test(e.message),
    );
  });

  test("editar el mismo producto no choca consigo mismo", async () => {
    const id = await con((db) => guardarProducto(db, empresaId, productoBase()));
    await con((db) =>
      guardarProducto(db, empresaId, { ...productoBase(), descripcion: "Bomba 2HP corregida" }, id),
    );
    const lista = await con((db) => listarProductos(db));
    assert.equal(lista[0]!.descripcion, "Bomba 2HP corregida");
  });

  test("los campos decimales vacíos se guardan como nulo, no como cero falso", async () => {
    await con((db) =>
      guardarProducto(db, empresaId, { ...productoBase(), pesoUnitario: "", volumenUnitario: "" }),
    );
    const [fila] = await raw<{ peso_unitario: string | null }[]>`
      SELECT peso_unitario FROM productos WHERE codigo = 'P001'`;
    assert.equal(fila!.peso_unitario, null, "sin peso es distinto de pesar cero");
  });

  test("un decimal mal escrito se rechaza", async () => {
    await assert.rejects(() =>
      con((db) => guardarProducto(db, empresaId, { ...productoBase(), pesoUnitario: "12,5" })),
    );
  });

  test("un producto con kardex no puede convertirse en servicio", async () => {
    const id = await con((db) => guardarProducto(db, empresaId, productoBase()));
    const [alm] = await raw<{ id: string }[]>`
      SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
    await raw`
      INSERT INTO movimientos_inventario
        (empresa_id, almacen_id, producto_id, fecha, orden, sentido, tipo_operacion,
         cantidad, costo_unitario, importe_total)
      VALUES (${empresaId}, ${alm!.id}, ${id}, '2026-09-01', 1, 'ingreso', '02', '1', '10', '10')`;

    await assert.rejects(
      () => con((db) => guardarProducto(db, empresaId, { ...productoBase(), tipo: "servicio" }, id)),
      /movimientos de inventario/,
    );
  });

  test("desactivar lo saca de la lista pero no lo borra", async () => {
    const id = await con((db) => guardarProducto(db, empresaId, productoBase()));
    await con((db) => desactivarProducto(db, id));
    assert.equal((await con((db) => listarProductos(db))).length, 0);
    assert.equal((await con((db) => listarProductos(db, { soloActivos: false }))).length, 1);
  });

  test("la búsqueda encuentra por código y por descripción", async () => {
    await con((db) => guardarProducto(db, empresaId, productoBase()));
    await con((db) =>
      guardarProducto(db, empresaId, {
        ...productoBase(), codigo: "V010", descripcion: "Válvula de bronce",
      }),
    );
    assert.equal((await con((db) => listarProductos(db, { busqueda: "P00" }))).length, 1);
    assert.equal((await con((db) => listarProductos(db, { busqueda: "bronce" }))).length, 1);
    assert.equal((await con((db) => listarProductos(db, { busqueda: "zzz" }))).length, 0);
  });

  test("la empresa nueva ya trae sus unidades y su plan de cuentas", async () => {
    assert.ok((await con((db) => listarUnidades(db))).length > 10);
    const cuentas = await con((db) => listarCuentas(db, true));
    assert.ok(cuentas.length > 20);
    assert.ok(cuentas.every((c) => c.esMovimiento), "sólo cuentas que admiten movimiento");
  });
});

describe("terceros", () => {
  test("se guarda un cliente con RUC válido", async () => {
    await con((db) => guardarTercero(db, empresaId, terceroBase()));
    const lista = await con((db) => listarTerceros(db, { rol: "cliente" }));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.razonSocial, "HIDRAULICA DEL SUR S.A.C.");
  });

  test("un RUC con dígito verificador incorrecto se rechaza", async () => {
    await assert.rejects(
      () => con((db) => guardarTercero(db, empresaId, { ...terceroBase(), numeroDocumento: "20522633722" })),
      /dígito verificador/,
    );
  });

  test("un DNI debe tener ocho dígitos", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarTercero(db, empresaId, {
            ...terceroBase(), tipoDocumento: "1", numeroDocumento: "1234567",
          }),
        ),
      /8 dígitos/,
    );
  });

  test("un tercero que no es ni cliente ni proveedor se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarTercero(db, empresaId, { ...terceroBase(), esCliente: false, esProveedor: false }),
        ),
      /cliente o proveedor/,
    );
  });

  test("un proveedor del exterior no puede estar marcado como domiciliado", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarTercero(db, empresaId, {
            ...terceroBase(), tipoDocumento: "0", numeroDocumento: "CN-8891",
            razonSocial: "NINGBO CO", pais: "CN", esProveedor: true, esCliente: false,
            esDomiciliado: true,
          }),
        ),
      /no puede estar marcado como domiciliado/,
    );
  });

  test("un proveedor del exterior sin RUC sí se acepta", async () => {
    await con((db) =>
      guardarTercero(db, empresaId, {
        ...terceroBase(), tipoDocumento: "0", numeroDocumento: "CN-8891",
        razonSocial: "NINGBO PUMP TRADING CO. LTD", pais: "CN",
        esProveedor: true, esCliente: false, esDomiciliado: false,
      }),
    );
    const lista = await con((db) => listarTerceros(db, { rol: "proveedor" }));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.pais, "CN");
  });

  test("el mismo documento no se registra dos veces", async () => {
    await con((db) => guardarTercero(db, empresaId, terceroBase()));
    await assert.rejects(
      () => con((db) => guardarTercero(db, empresaId, { ...terceroBase(), razonSocial: "OTRA SA" })),
      /ya está registrado a nombre de HIDRAULICA DEL SUR/,
    );
  });

  test("un mismo tercero puede ser cliente y proveedor a la vez", async () => {
    await con((db) =>
      guardarTercero(db, empresaId, { ...terceroBase(), esCliente: true, esProveedor: true }),
    );
    assert.equal((await con((db) => listarTerceros(db, { rol: "cliente" }))).length, 1);
    assert.equal((await con((db) => listarTerceros(db, { rol: "proveedor" }))).length, 1);
  });

  test("el correo inválido se rechaza y el vacío se acepta", async () => {
    await assert.rejects(() =>
      con((db) => guardarTercero(db, empresaId, { ...terceroBase(), email: "no-es-correo" })),
    );
    await con((db) => guardarTercero(db, empresaId, { ...terceroBase(), email: "" }));
  });

  test("el país se normaliza a mayúsculas", async () => {
    await con((db) =>
      guardarTercero(db, empresaId, {
        ...terceroBase(), tipoDocumento: "0", numeroDocumento: "X-1",
        pais: "cn", esDomiciliado: false, esProveedor: true, esCliente: false,
      }),
    );
    const lista = await con((db) => listarTerceros(db));
    assert.equal(lista[0]!.pais, "CN");
  });
});

describe("aislamiento de maestros", () => {
  test("los productos de una empresa no se ven desde otra", async () => {
    await con((db) => guardarProducto(db, empresaId, productoBase()));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarProductos(db),
    );
    assert.deepEqual(desdeOtra, []);
  });

  test("dos empresas pueden usar el mismo código de producto sin chocar", async () => {
    await con((db) => guardarProducto(db, empresaId, productoBase()));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const [u] = await raw<{ id: string }[]>`
      SELECT id FROM unidades_medida WHERE empresa_id = ${otra.empresaId} AND codigo = 'NIU'`;

    await enEmpresa(app, { empresaId: otra.empresaId, usuarioId: otra.usuarioId }, (db) =>
      guardarProducto(db, otra.empresaId, { ...productoBase(), unidadId: u!.id }),
    );

    const lista = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarProductos(db),
    );
    assert.equal(lista.length, 1, "cada empresa tiene su propio catálogo");
  });
});

// ─── El plan de cuentas se pone al día ────────────────────────────────────

describe("sincronización del plan de cuentas", () => {
  /**
   * El plan se siembra al crear la empresa y ahí se quedaba. Cuando el catálogo
   * creció —hacían falta las cuentas de planilla— las empresas ya existentes no
   * las recibían, y lo descubrían el día que intentaban asentar la nómina.
   */
  test("devuelve las cuentas que faltaban y las inserta", async () => {
    await raw`
      DELETE FROM plan_cuentas
      WHERE empresa_id = ${empresaId} AND cuenta IN ('6211', '4111', '891')`;

    const r = await con((db) => sincronizarPlanCuentas(db, empresaId));
    assert.ok(r.agregadas.includes("6211"));
    assert.ok(r.agregadas.includes("4111"));

    const cuentas = await con((db) => listarCuentas(db));
    assert.ok(cuentas.some((c) => c.cuenta === "6211"), "la cuenta debe quedar en el plan");
  });

  test("es idempotente: correrla dos veces no duplica nada", async () => {
    await con((db) => sincronizarPlanCuentas(db, empresaId));
    const segunda = await con((db) => sincronizarPlanCuentas(db, empresaId));
    assert.deepEqual(segunda.agregadas, []);
  });

  test("no toca lo que la empresa personalizó", async () => {
    // Una empresa puede renombrar una cuenta o cambiarle lo que exige; la
    // sincronización sólo añade lo que falta.
    await raw`
      UPDATE plan_cuentas SET descripcion = 'Caja principal de la tienda'
      WHERE empresa_id = ${empresaId} AND cuenta = '1011'`;
    await con((db) => sincronizarPlanCuentas(db, empresaId));
    const cuentas = await con((db) => listarCuentas(db));
    assert.equal(
      cuentas.find((c) => c.cuenta === "1011")!.descripcion,
      "Caja principal de la tienda",
    );
  });

  test("la empresa puede asentar su planilla con el plan al día", async () => {
    await con((db) => sincronizarPlanCuentas(db, empresaId));
    const cuentas = await con((db) => listarCuentas(db, true));
    for (const necesaria of ["6211", "6271", "4111", "4031"]) {
      assert.ok(
        cuentas.some((c) => c.cuenta === necesaria),
        `falta la cuenta ${necesaria}, que toda empresa con trabajadores necesita`,
      );
    }
  });
});

// ─── Sucursales ───────────────────────────────────────────────────────────

describe("sucursales", () => {
  const con = <T,>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

  /**
   * El ubigeo es el punto de partida de toda guía de remisión. La empresa nace
   * con su sucursal pero sin él, y hasta que hubo esta pantalla no había forma
   * de completarlo: cada guía obligaba a teclearlo a mano.
   */
  test("se le puede poner el ubigeo a la sucursal que nació con la empresa", async () => {
    const [antes] = await con((db) => listarSucursales(db));
    assert.equal(antes!.ubigeo, null, "la empresa nueva no trae ubigeo");

    await con((db) =>
      guardarSucursal(db, empresaId, usuarioId, {
        id: antes!.id,
        codigo: antes!.codigo,
        nombre: "Oficina principal",
        direccion: "Av. Prolong. Sede secundaria, Ate",
        ubigeo: "150103",
        codigoSunat: "0000",
      }),
    );

    const [despues] = await con((db) => listarSucursales(db));
    assert.equal(despues!.ubigeo, "150103");
    assert.equal(despues!.codigoSunat, "0000");
  });

  test("un ubigeo que no son seis dígitos se rechaza", async () => {
    const [s] = await con((db) => listarSucursales(db));
    await assert.rejects(
      () =>
        con((db) =>
          guardarSucursal(db, empresaId, usuarioId, {
            id: s!.id, codigo: s!.codigo, nombre: s!.nombre, ubigeo: "15010",
          }),
        ),
      /seis dígitos/,
    );
  });

  test("un código de establecimiento que no son cuatro dígitos se rechaza", async () => {
    const [s] = await con((db) => listarSucursales(db));
    await assert.rejects(
      () =>
        con((db) =>
          guardarSucursal(db, empresaId, usuarioId, {
            id: s!.id, codigo: s!.codigo, nombre: s!.nombre, codigoSunat: "00",
          }),
        ),
      /cuatro dígitos/,
    );
  });

  test("no se repite el código de una sucursal", async () => {
    const [s] = await con((db) => listarSucursales(db));
    await assert.rejects(
      () =>
        con((db) =>
          guardarSucursal(db, empresaId, usuarioId, { codigo: s!.codigo, nombre: "Otra" }),
        ),
      /ya existe una sucursal/,
    );
  });

  test("se puede abrir una sucursal nueva", async () => {
    await con((db) =>
      guardarSucursal(db, empresaId, usuarioId, {
        codigo: "002", nombre: "Tienda Ate", ubigeo: "150103", codigoSunat: "0001",
      }),
    );
    const lista = await con((db) => listarSucursales(db));
    assert.equal(lista.length, 2);
    assert.equal(lista[1]!.nombre, "Tienda Ate");
  });
});
