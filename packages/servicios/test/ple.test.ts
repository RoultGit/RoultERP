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
  crearEmpresa, registrarCompra, emitirVenta, emitirNota,
  registroCompras, comprasNoDomiciliados, registroVentas,
  libroDiario, libroMayor, inventarioUnidades, inventarioValorizado,
  nombreArchivo, importePle, fechaPle, linea, aLatin1, LIBROS, CAMPOS,
  registroDeCompras, registroDeVentas,
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
    // El importe total es el campo 24 y la moneda el 25, después de que la
    // R.S. 108-2020 insertara el impuesto a las bolsas de plástico en el 22.
    assert.equal(campos[23], "5900.00", "importe total");
    assert.equal(campos[24], "PEN", "moneda");
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
    assert.equal(campos[24], "USD");
    // La estructura exige "1 entero y 3 decimales" en el tipo de cambio, que es
    // la precisión con la que SUNAT publica el suyo.
    assert.equal(campos[25], "3.752", "el tipo de cambio va con tres decimales");
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
    assert.equal(campos[6], "P001", "código de la existencia");
    assert.equal(campos[15], "NIU", "unidad de medida");
    assert.equal(campos[16], "2", "método de valuación: promedio");
    assert.equal(campos[17], "10.00", "cantidad de entrada");
    assert.equal(campos[19], "5000.00", "costo total de entrada");
    assert.equal(campos[20], "0.00", "sin salida");
    assert.equal(campos[23], "10.00", "saldo en cantidad");
    assert.equal(campos[25], "5000.00", "saldo valorizado");
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
    assert.equal(segunda[23], "15.00", "saldo acumulado en cantidad");
    assert.equal(segunda[25], "8000.00", "5000 + 3000");
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

// ─── Estructura de todos los formatos ─────────────────────────────────────

/**
 * Ventas y notas, para los formatos que las necesitan.
 *
 * Se marca el comprobante como aceptado a mano porque la nota exige un
 * documento ya enviado y aquí no hay SUNAT contra la que hablar.
 */
async function ventaConNota() {
  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRÁULICA DEL SUR S.A.C.', true) RETURNING id`;
  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '07', 'FC01', 0)`;

  const venta = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: c!.id,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-20",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "4", valorUnitario: "800" }],
    }),
  );
  await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${venta.comprobanteId}`;

  const nota = await con((db) =>
    emitirNota(db, empresaId, usuarioId, {
      comprobanteId: venta.comprobanteId,
      tipoDocumento: "07",
      serie: "FC01",
      fechaEmision: "2026-09-25",
      motivo: "06",
      descripcionMotivo: "Devolución total",
    }),
  );
  await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${nota.comprobanteId}`;
  return { venta, nota };
}

/** Compra a un proveedor del exterior, para el formato 8.2. */
async function compraDelExterior() {
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado, pais, direccion)
    VALUES (${empresaId}, '0', 'CN-88991', 'NINGBO PUMPS CO. LTD', true, false, 'CN',
            '15 Zhongshan Road, Ningbo')
    RETURNING id`;
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: p!.id,
      tipoDocumento: "91",
      serie: "INV",
      numero: "2026-118",
      fechaEmision: "2026-09-08",
      moneda: "USD",
      tipoCambio: "3.752",
      lineas: [
        { descripcion: "Bombas", cantidad: "1", valorUnitario: "12000", cuenta: "6011", afectacionIgv: "30" },
      ],
    }),
  );
}

/** Número de campos de una línea. La última barra no abre un campo nuevo. */
const campos = (l: string) => l.split("|").length - 1;

describe("estructura de cada formato", () => {
  // Este es el bloque que impide el error más caro del PLE: un campo corrido
  // desplaza todos los siguientes y el validador rebota sin decir cuál.
  const casos: [string, number, () => Promise<{ contenido: string; filas: number }>][] = [
    ["8.1 compras", CAMPOS.COMPRAS, () => con((db) => registroCompras(db, empresaId, "202609"))],
    ["8.2 no domiciliados", CAMPOS.COMPRAS_NO_DOMICILIADOS,
      () => con((db) => comprasNoDomiciliados(db, empresaId, "202609"))],
    ["14.1 ventas", CAMPOS.VENTAS, () => con((db) => registroVentas(db, empresaId, "202609"))],
    ["5.1 diario", CAMPOS.DIARIO, () => con((db) => libroDiario(db, empresaId, "202609"))],
    ["6.1 mayor", CAMPOS.MAYOR, () => con((db) => libroMayor(db, empresaId, "202609"))],
    ["12.1 inventario en unidades", CAMPOS.INVENTARIO_UNIDADES,
      () => con((db) => inventarioUnidades(db, empresaId, "202609"))],
    ["13.1 inventario valorizado", CAMPOS.INVENTARIO_VALORIZADO,
      () => con((db) => inventarioValorizado(db, empresaId, "202609"))],
  ];

  for (const [nombre, esperados, generar] of casos) {
    test(`${nombre}: cada línea tiene ${esperados} campos y termina en barra`, async () => {
      await compraDeEjemplo();
      await compraDelExterior();
      await ventaConNota();
      const libro = await generar();
      assert.ok(libro.filas > 0, "el caso de prueba no generó ninguna línea");
      for (const l of libro.contenido.split("\r\n")) {
        assert.equal(campos(l), esperados, `línea con campos de más o de menos: ${l.slice(0, 60)}…`);
        assert.ok(l.endsWith("|"));
      }
    });
  }
});

// ─── Formato 14.1: Registro de Ventas ─────────────────────────────────────

describe("registro de ventas (14.1)", () => {
  test("la factura lleva la base, el IGV y el total en su posición", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const libro = await con((db) => registroVentas(db, empresaId, "202609"));
    const factura = libro.contenido
      .split("\r\n")
      .map((l) => l.split("|"))
      .find((c) => c[5] === "01")!;

    assert.equal(factura[0], "20260900", "periodo");
    assert.equal(factura[3], "20/09/2026", "fecha de emisión");
    assert.equal(factura[6], "F001", "serie");
    assert.equal(factura[9], "6", "tipo de documento del cliente");
    assert.equal(factura[10], "20522633721", "RUC del cliente");
    assert.equal(factura[13], "3200.00", "base imponible");
    assert.equal(factura[15], "576.00", "IGV");
    assert.equal(factura[24], "3776.00", "importe total");
    assert.equal(factura[25], "PEN", "moneda");
    assert.equal(factura[34], "1", "operación del periodo");
  });

  test("la nota de crédito referencia el comprobante que modifica", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const libro = await con((db) => registroVentas(db, empresaId, "202609"));
    const nota = libro.contenido
      .split("\r\n")
      .map((l) => l.split("|"))
      .find((c) => c[5] === "07")!;

    // Campos 28 al 31: los que hacen que SUNAT sepa qué está anulando.
    assert.equal(nota[27], "20/09/2026", "fecha del comprobante original");
    assert.equal(nota[28], "01", "tipo del original");
    assert.equal(nota[29], "F001", "serie del original");
    assert.equal(nota[30], "00000001", "número del original");
  });

  test("un borrador no entra al registro", async () => {
    const [c] = await raw<{ id: string }[]>`
      INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
      VALUES (${empresaId}, '6', '20522633721', 'HIDRÁULICA', true) RETURNING id`;
    await raw`
      INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
      VALUES (${empresaId}, '01', 'F001', 0)`;
    await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: c!.id, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-20", moneda: "PEN", tipoCambio: "1",
        lineas: [{ descripcion: "Servicio", cantidad: "1", valorUnitario: "100" }],
      }),
    );
    const libro = await con((db) => registroVentas(db, empresaId, "202609"));
    assert.equal(libro.filas, 0, "hasta que no se envía, no es una venta declarada");
  });

  test("el nombre del archivo declara el libro 14.1", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const libro = await con((db) => registroVentas(db, empresaId, "202609"));
    assert.ok(libro.nombre.includes(LIBROS.VENTAS));
  });
});

// ─── Formatos 5.1 y 6.1 ───────────────────────────────────────────────────

describe("libro diario (5.1) y libro mayor (6.1)", () => {
  test("el diario lleva una línea por línea de asiento, con debe y haber", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => libroDiario(db, empresaId, "202609"));
    const lineas = libro.contenido.split("\r\n").map((l) => l.split("|"));

    assert.ok(lineas.length >= 3, "una compra genera al menos tres líneas");
    const igv = lineas.find((c) => c[3] === "40111")!;
    assert.equal(igv[17], "900.00", "el IGV va al debe");
    assert.equal(igv[18], "0.00");
    const proveedorLinea = lineas.find((c) => c[3] === "4212")!;
    assert.equal(proveedorLinea[18], "5900.00", "el proveedor va al haber");
    assert.equal(proveedorLinea[8], "20100047218", "documento del tercero imputado");
  });

  test("el correlativo del asiento empieza por M", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => libroDiario(db, empresaId, "202609"));
    for (const l of libro.contenido.split("\r\n")) {
      // SUNAT exige A, M o C como primer dígito del campo 3.
      assert.match(l.split("|")[2]!, /^[AMC]/);
    }
  });

  test("el diario cuadra: el debe iguala al haber", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const lineas = (await con((db) => libroDiario(db, empresaId, "202609"))).contenido
      .split("\r\n")
      .map((l) => l.split("|"));
    const suma = (i: number) => lineas.reduce((a, c) => a + Number(c[i]), 0);
    assert.ok(Math.abs(suma(17) - suma(18)) < 0.005, "el libro diario no cuadra");
  });

  test("el mayor lleva las mismas líneas, ordenadas por cuenta", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const diario = await con((db) => libroDiario(db, empresaId, "202609"));
    const mayor = await con((db) => libroMayor(db, empresaId, "202609"));
    assert.equal(mayor.filas, diario.filas, "el mayor es el diario reordenado");

    const cuentas = mayor.contenido.split("\r\n").map((l) => l.split("|")[3]!);
    assert.deepEqual(cuentas, [...cuentas].sort(), "las cuentas no vienen ordenadas");
  });

  test("un borrador no llega a los libros", async () => {
    // Un asiento sin contabilizar no es contabilidad: si entrara al diario,
    // el libro declararía operaciones que el contador todavía está revisando.
    const [a] = await raw<{ id: string }[]>`
      INSERT INTO asientos (empresa_id, periodo, numero, fecha, subdiario, glosa, moneda, estado)
      VALUES (${empresaId}, '202610', '000001', '2026-10-05', '08', 'En revisión', 'PEN', 'borrador')
      RETURNING id`;
    await raw`
      INSERT INTO asiento_lineas (empresa_id, asiento_id, linea, cuenta, debe, debe_funcional)
      VALUES (${empresaId}, ${a!.id}, 1, '6431', 100, 100)`;

    const libro = await con((db) => libroDiario(db, empresaId, "202610"));
    assert.equal(libro.filas, 0);
  });
});

// ─── Formato 12.1 ─────────────────────────────────────────────────────────

describe("inventario permanente en unidades (12.1)", () => {
  test("las entradas van en positivo y las salidas en negativo", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const lineas = (await con((db) => inventarioUnidades(db, empresaId, "202609"))).contenido
      .split("\r\n")
      .map((l) => l.split("|"));

    const entrada = lineas.find((c) => Number(c[16]) > 0)!;
    assert.equal(entrada[16], "10.00", "las diez unidades compradas");
    assert.equal(entrada[17], "0.00");

    // La salida en negativo es lo que hace que la columna sume la variación
    // del stock; en positivo, el validador la rechaza.
    const salida = lineas.find((c) => Number(c[17]) !== 0)!;
    assert.equal(salida[17], "-4.00");
    assert.equal(salida[16], "0.00");
  });

  test("cada movimiento lleva el documento que lo originó", async () => {
    // SUNAT exige serie y número siempre que el tipo de operación sea una
    // compra o una venta; sin ellos el validador rechaza la línea.
    await compraDeEjemplo();
    const c = (await con((db) => inventarioUnidades(db, empresaId, "202609"))).contenido
      .split("\r\n")[0]!
      .split("|");
    assert.equal(c[10], "01", "tipo del documento");
    assert.equal(c[11], "F001", "serie");
    assert.equal(c[12], "0001234", "número");
  });

  test("no lleva importes: para eso está el 13.1", async () => {
    await compraDeEjemplo();
    const libro = await con((db) => inventarioUnidades(db, empresaId, "202609"));
    assert.equal(campos(libro.contenido.split("\r\n")[0]!), CAMPOS.INVENTARIO_UNIDADES);
    assert.ok(!libro.contenido.includes("5000.00"), "el costo no debe aparecer");
  });
});

// ─── Formato 8.2 ──────────────────────────────────────────────────────────

describe("compras a no domiciliados (8.2)", () => {
  test("sólo entran los proveedores del exterior", async () => {
    await compraDeEjemplo();
    await compraDelExterior();
    const libro = await con((db) => comprasNoDomiciliados(db, empresaId, "202609"));
    assert.equal(libro.filas, 1, "la compra nacional va al 8.1, no aquí");

    const c = libro.contenido.split("|");
    assert.equal(c[4], "91", "tipo de comprobante del no domiciliado");
    assert.equal(c[17], "CN", "país de residencia");
    assert.match(c[18]!, /NINGBO/, "razón social");
    assert.equal(c[20], "CN-88991", "número de identificación");
    assert.equal(c[15], "USD");
    assert.equal(c[16], "3.752");
  });

  test("el estado sólo admite 0 y 9", async () => {
    await compraDelExterior();
    const libro = await con((db) => comprasNoDomiciliados(db, empresaId, "202609"));
    assert.equal(libro.contenido.split("|")[35], "0", "operación del periodo");
  });

  test("el nombre del archivo declara el libro 8.2", async () => {
    await compraDelExterior();
    const libro = await con((db) => comprasNoDomiciliados(db, empresaId, "202609"));
    assert.ok(libro.nombre.includes(LIBROS.COMPRAS_NO_DOMICILIADOS));
  });
});

// ─── El mismo libro, en pantalla ──────────────────────────────────────────

/**
 * El registro que se mira y el archivo que se entrega salen de la misma
 * consulta. Si fueran dos, el contador tendría dos registros del mismo mes y
 * ninguna forma de saber cuál vale.
 */
describe("registro de compras y de ventas en pantalla", () => {
  test("el registro de compras suma lo mismo que declara el libro", async () => {
    await compraDeEjemplo();
    const r = await con((db) => registroDeCompras(db, "202609"));

    assert.equal(r.renglones.length, 1);
    assert.equal(r.totales.gravadas, "5000.00");
    assert.equal(r.totales.igv, "900.00");
    assert.equal(r.totales.total, "5900.00");
    assert.equal(r.renglones[0]!.tercero, "FERRETERÍA SAN MARTÍN S.A.C.");
    assert.equal(r.renglones[0]!.numeroDocTercero, "20100047218");
  });

  /** En la base todo está en positivo; el signo lo da el tipo de documento. */
  test("la nota de crédito resta en el registro de ventas", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    const r = await con((db) => registroDeVentas(db, "202609"));

    const factura = r.renglones.find((x) => x.tipoDocumento === "01")!;
    const nota = r.renglones.find((x) => x.tipoDocumento === "07")!;
    assert.equal(factura.total, "3776.00");
    assert.equal(nota.total, "-3776.00", "la nota no puede sumar");
    assert.equal(nota.modificaA, "F001-00000001");
    // Devolución total: el mes queda en cero.
    assert.equal(r.totales.total, "0.00");
    assert.equal(r.totales.igv, "0.00");
  });

  test("un comprobante anulado figura con importe cero y se avisa", async () => {
    await compraDeEjemplo();
    await ventaConNota();
    await raw`
      UPDATE comprobantes SET estado = 'anulado'
      WHERE empresa_id = ${empresaId} AND tipo_documento = '01'`;

    const r = await con((db) => registroDeVentas(db, "202609"));
    const factura = r.renglones.find((x) => x.tipoDocumento === "01")!;
    assert.equal(factura.total, "0.00", "el correlativo figura, la venta no");
    assert.ok(r.avisos.some((a) => /anulado/.test(a)), r.avisos.join(" | "));
  });

  test("el total en soles usa el tipo de cambio de cada documento", async () => {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor,
        tipoDocumento: "01",
        serie: "F002",
        numero: "0000009",
        fechaEmision: "2026-09-06",
        moneda: "USD",
        tipoCambio: "3.80",
        almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "1", valorUnitario: "100" }],
      }),
    );
    const r = await con((db) => registroDeCompras(db, "202609"));
    // 118 dólares × 3.80.
    assert.equal(r.totales.totalSoles, "448.40");
    assert.ok(r.avisos.some((a) => /moneda\s+extranjera/.test(a)), r.avisos.join(" | "));
  });

  test("el registro en pantalla trae las mismas filas que el archivo del PLE", async () => {
    await compraDeEjemplo();
    await ventaConNota();

    const archivo = await con((db) => registroVentas(db, empresaId, "202609"));
    const pantalla = await con((db) => registroDeVentas(db, "202609"));
    assert.equal(pantalla.renglones.length, archivo.filas);
  });
});
