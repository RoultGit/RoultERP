/**
 * Libros electrónicos.
 *
 * El validador de SUNAT revisa campo por campo y rebota el archivo entero por
 * un separador de más o un decimal de menos. Estas pruebas fijan el formato
 * antes de que lo descubra el contador un día 12 con el plazo encima.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, registrarCompra, registroCompras, inventarioValorizado,
  nombreArchivo, importePle, fechaPle, linea, aLatin1, LIBROS,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let proveedor = "";
let producto = "";

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

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERÍA SAN MARTÍN S.A.C.', true, 30)
    RETURNING id`;
  proveedor = p!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [prod] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga 2HP', ${u!.id}) RETURNING id`;
  producto = prod!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

async function compraDeEjemplo() {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero: "0001234",
      fechaEmision: "2026-09-05",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [
        { productoId: producto, descripcion: "Bomba centrífuga 2HP", cantidad: "10", valorUnitario: "500" },
      ],
    }),
  );
}

// ─── Piezas del formato ───────────────────────────────────────────────────

describe("formato de los campos", () => {
  test("los importes van con punto decimal, dos decimales y sin separador de miles", () => {
    assert.equal(importePle("1234567.891"), "1234567.89");
    assert.equal(importePle("1000"), "1000.00");
    assert.equal(importePle("0"), "0.00");
    assert.equal(importePle(null), "0.00");
  });

  test("un importe negativo lleva el signo delante", () => {
    assert.equal(importePle("-500.5"), "-500.50");
  });

  test("las fechas van en DD/MM/AAAA", () => {
    assert.equal(fechaPle("2026-09-05"), "05/09/2026");
    assert.equal(fechaPle(null), "", "una fecha ausente es un campo vacío, no una fecha inventada");
  });

  test("cada línea termina en barra vertical, incluida la última", () => {
    const l = linea(["a", "b", "c"]);
    assert.equal(l, "a|b|c|");
    assert.ok(l.endsWith("|"));
  });

  test("los campos vacíos ocupan su posición", () => {
    assert.equal(linea(["a", null, undefined, "d"]), "a|||d|");
  });

  test("una barra vertical dentro de un dato no rompe la estructura", () => {
    // Una razón social con barra correría todos los campos siguientes y el
    // error aparecería treinta líneas más abajo, sin relación aparente.
    assert.equal(linea(["EMPRESA | RARA S.A.", "x"]), "EMPRESA   RARA S.A.|x|");
  });

  test("un salto de línea dentro de un dato tampoco", () => {
    assert.equal(linea(["línea1\nlínea2"]), "línea1 línea2|");
  });
});

describe("nombre del archivo", () => {
  test("tiene exactamente 33 caracteres antes de la extensión", () => {
    // El aplicativo del PLE rechaza el archivo por el nombre antes de mirar el
    // contenido, y un componente corrido es imposible de diagnosticar.
    const n = nombreArchivo({
      ruc: "20303051831", periodo: "202609", libro: LIBROS.COMPRAS, conInformacion: true,
    });
    assert.equal(n.replace(".TXT", "").length, 33);
    assert.ok(n.endsWith(".TXT"));
  });

  test("cada componente ocupa su posición", () => {
    const n = nombreArchivo({
      ruc: "20303051831", periodo: "202609", libro: LIBROS.COMPRAS, conInformacion: true,
    }).replace(".TXT", "");

    assert.equal(n.slice(0, 2), "LE", "prefijo");
    assert.equal(n.slice(2, 13), "20303051831", "RUC");
    assert.equal(n.slice(13, 21), "20260900", "periodo con día en 00");
    assert.equal(n.slice(21, 27), "080100", "código de libro");
    assert.equal(n.slice(27, 29), "00", "código de oportunidad");
    assert.equal(n.slice(29, 30), "1", "indicador de operaciones");
    assert.equal(n.slice(30, 31), "1", "indicador de contenido");
    assert.equal(n.slice(31, 32), "1", "moneda nacional");
    assert.equal(n.slice(32, 33), "1", "generado por el PLE");
  });

  test("un libro sin información lleva los indicadores en cero", () => {
    const n = nombreArchivo({
      ruc: "20303051831", periodo: "202609", libro: LIBROS.COMPRAS, conInformacion: false,
    }).replace(".TXT", "");
    assert.equal(n.slice(29, 31), "00");
  });

  test("un libro en dólares lleva el indicador de moneda en 2", () => {
    const n = nombreArchivo({
      ruc: "20303051831", periodo: "202609", libro: LIBROS.COMPRAS,
      conInformacion: true, monedaNacional: false,
    }).replace(".TXT", "");
    assert.equal(n.slice(31, 32), "2");
  });

  test("el código de cada libro es el de la tabla 8 de SUNAT", () => {
    assert.equal(LIBROS.COMPRAS, "080100");
    assert.equal(LIBROS.VENTAS, "140100");
    assert.equal(LIBROS.INVENTARIO_VALORIZADO, "130100");
    assert.equal(LIBROS.DIARIO, "050100");
  });

  test("un RUC o un periodo mal formados se rechazan al construir el nombre", () => {
    assert.throws(() =>
      nombreArchivo({ ruc: "123", periodo: "202609", libro: LIBROS.COMPRAS, conInformacion: true }),
    );
    assert.throws(() =>
      nombreArchivo({ ruc: "20303051831", periodo: "2026", libro: LIBROS.COMPRAS, conInformacion: true }),
    );
    assert.throws(() =>
      nombreArchivo({ ruc: "20303051831", periodo: "202609", libro: "0801", conInformacion: true }),
    );
  });
});

describe("codificación", () => {
  test("se codifica en Latin-1, que es lo que lee el validador de SUNAT", () => {
    const buf = aLatin1("FERRETERÍA SAN MARTÍN S.A.C.");
    // En Latin-1 la Í ocupa un byte; en UTF-8 ocuparía dos.
    assert.equal(buf.length, "FERRETERÍA SAN MARTÍN S.A.C.".length);
    assert.equal(buf.toString("latin1"), "FERRETERÍA SAN MARTÍN S.A.C.");
  });

  test("un carácter que Latin-1 no tiene se degrada sin romper el archivo", () => {
    const buf = aLatin1("PRODUCTO Ω ESPECIAL");
    assert.ok(buf.length > 0);
    assert.ok(!buf.toString("latin1").includes("�"));
  });
});

// ─── Formato 8.1 ──────────────────────────────────────────────────────────

describe("registro de compras (8.1)", () => {
  test("genera una línea por comprobante del periodo", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => registroCompras(db, empresaId, "202609"));
    assert.equal(libro.filas, 1);
    assert.equal(libro.contenido.split("\r\n").length, 1);
  });

  test("la línea lleva el proveedor, la base y el IGV en su posición", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => registroCompras(db, empresaId, "202609"));
    const campos = libro.contenido.split("|");

    assert.equal(campos[0], "20260900", "periodo");
    assert.equal(campos[3], "05/09/2026", "fecha de emisión");
    assert.equal(campos[5], "01", "tipo de comprobante");
    assert.equal(campos[6], "F001", "serie");
    assert.equal(campos[8], "0001234", "número");
    assert.equal(campos[10], "6", "tipo de documento del proveedor");
    assert.equal(campos[11], "20100047218", "RUC del proveedor");
    assert.match(campos[12]!, /FERRETER/, "razón social");
    assert.equal(campos[13], "5000.00", "base imponible");
    assert.equal(campos[14], "900.00", "IGV");
    assert.equal(campos[22], "5900.00", "importe total");
    assert.equal(campos[23], "PEN", "moneda");
  });

  test("un periodo sin compras produce un libro vacío marcado como tal", async () => {
    const libro = await con((db) => registroCompras(db, empresaId, "202601"));
    assert.equal(libro.filas, 0);
    assert.equal(libro.contenido, "");
    assert.equal(
      libro.nombre.replace(".TXT", "").slice(29, 31),
      "00",
      "el nombre debe declarar que no hay información",
    );
  });

  test("sólo entran las compras del periodo pedido", async () => {
    await compraDeEjemplo();
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor,
        tipoDocumento: "01",
        serie: "F001",
        numero: "0009999",
        fechaEmision: "2026-08-10",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario: "100", cuenta: "6431" }],
      }),
    );
    assert.equal((await con((db) => registroCompras(db, empresaId, "202609"))).filas, 1);
    assert.equal((await con((db) => registroCompras(db, empresaId, "202608"))).filas, 1);
  });

  test("una compra en dólares informa su moneda y su tipo de cambio", async () => {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor,
        tipoDocumento: "01",
        serie: "F002",
        numero: "0000001",
        fechaEmision: "2026-09-10",
        moneda: "USD",
        tipoCambio: "3.752",
        lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario: "1000", cuenta: "6431" }],
      }),
    );
    const libro = await con((db) => registroCompras(db, empresaId, "202609"));
    const campos = libro.contenido.split("|");
    assert.equal(campos[23], "USD");
    assert.equal(campos[24], "3.75", "el tipo de cambio va con dos decimales");
  });

  test("cada línea del archivo termina en barra vertical", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => registroCompras(db, empresaId, "202609"));
    for (const l of libro.contenido.split("\r\n")) {
      assert.ok(l.endsWith("|"), `la línea no termina en barra: ${l.slice(-20)}`);
    }
  });

  test("todas las líneas tienen el mismo número de campos", async () => {
    await compraDeEjemplo();
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0005555",
        fechaEmision: "2026-09-20", moneda: "PEN", tipoCambio: "1",
        lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario: "200", cuenta: "6431" }],
      }),
    );
    const libro = await con((db) => registroCompras(db, empresaId, "202609"));
    const anchos = new Set(libro.contenido.split("\r\n").map((l) => l.split("|").length));
    assert.equal(anchos.size, 1, "un ancho distinto corre los campos y rebota el archivo");
  });
});

// ─── Formato 13.1 ─────────────────────────────────────────────────────────

describe("inventario permanente valorizado (13.1)", () => {
  test("registra el ingreso con su costo y su saldo", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => inventarioValorizado(db, empresaId, "202609"));
    assert.equal(libro.filas, 1);

    const campos = libro.contenido.split("|");
    assert.equal(campos[4], "P001", "código de la existencia");
    assert.equal(campos[7], "NIU", "unidad de medida");
    assert.equal(campos[14], "10.00", "cantidad de entrada");
    assert.equal(campos[16], "5000.00", "costo total de entrada");
    assert.equal(campos[17], "0.00", "sin salida");
    assert.equal(campos[20], "10.00", "saldo en cantidad");
    assert.equal(campos[22], "5000.00", "saldo valorizado");
  });

  test("el saldo se acumula movimiento a movimiento", async () => {
    await compraDeEjemplo();
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0007777",
        fechaEmision: "2026-09-15", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "5", valorUnitario: "600" }],
      }),
    );
    const libro = await con((db) => inventarioValorizado(db, empresaId, "202609"));
    const lineas = libro.contenido.split("\r\n");
    assert.equal(lineas.length, 2);

    const segunda = lineas[1]!.split("|");
    assert.equal(segunda[20], "15.00", "saldo acumulado en cantidad");
    assert.equal(segunda[22], "8000.00", "5000 + 3000");
  });

  test("un periodo sin movimientos produce un libro vacío", async () => {
    const libro = await con((db) => inventarioValorizado(db, empresaId, "202601"));
    assert.equal(libro.filas, 0);
  });

  test("el nombre del archivo declara el libro 13.1", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => inventarioValorizado(db, empresaId, "202609"));
    assert.ok(libro.nombre.includes("130100"));
    assert.ok(libro.nombre.startsWith("LE20303051831"));
  });

  test("todas las líneas tienen el mismo ancho", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => inventarioValorizado(db, empresaId, "202609"));
    const anchos = new Set(libro.contenido.split("\r\n").map((l) => l.split("|").length));
    assert.equal(anchos.size, 1);
  });
});
