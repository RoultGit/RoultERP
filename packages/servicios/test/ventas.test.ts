/**
 * Ventas y emisión electrónica, contra Postgres real.
 *
 * La prueba que más importa aquí es la última: que una caída de SUNAT no impida
 * facturar. Un mostrador que deja de vender porque un servicio ajeno no
 * responde es un sistema inservible, por muy correcto que sea su XML.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money, cpe } from "@roulterp/core";
import { sellar } from "@roulterp/core/auth";
import { certificadoDePrueba, pfxDePrueba } from "@roulterp/core/cpe";
import {
  crearEmpresa, registrarCompra, emitirVenta, enviarASunat, listarVentas,
  cargarComprobante, pendientesDeEnvio, enLetras, existencias,
  balanceComprobacion, VentaInvalida,
} from "../src/index.ts";
import { zipSync } from "fflate";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(23);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let cliente = "";
let clienteSinRuc = "";
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

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_cliente, dias_credito)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR S.A.C.', true, 30)
    RETURNING id`;
  cliente = c!.id;

  const [cs] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '1', '45678912', 'JUAN PEREZ', true) RETURNING id`;
  clienteSinRuc = cs!.id;

  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true, 30) RETURNING id`;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga 2HP', ${u!.id}) RETURNING id`;
  producto = p!.id;

  // Series de facturación.
  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '03', 'B001', 0)`;

  // Stock para poder vender: se compra antes de vender, como en la vida real.
  await enEmpresa(app, { empresaId, usuarioId }, (db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: prov!.id,
      tipoDocumento: "01",
      serie: "F001",
      numero: "0000001",
      fechaEmision: "2026-09-01",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [
        { productoId: producto, descripcion: "Bomba", cantidad: "100", valorUnitario: "300" },
      ],
    }),
  );
});

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);
const enviar = (id: string, fetchImpl: typeof fetch, kek = KEK) =>
  enviarASunat(app, ctx(), id, kek, { fetchImpl });
const s2 = (v: string) => money.toString(money.dec(v), 2);

const ventaBase = () => ({
  clienteId: cliente,
  tipoDocumento: "01",
  serie: "F001",
  fechaEmision: "2026-09-10",
  moneda: "PEN",
  tipoCambio: "1",
  almacenId,
  lineas: [{ productoId: producto, cantidad: "10", valorUnitario: "500" }],
});

// ─── Emisión ──────────────────────────────────────────────────────────────

describe("emisión de la venta", () => {
  test("numera, totaliza y deja el comprobante", async () => {
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    assert.equal(r.numero, "00000001");
    assert.equal(r.total, "5900.00");

    const lista = await con((db) => listarVentas(db, "202609"));
    assert.equal(lista.length, 1);
    assert.equal(s2(lista[0]!.igv), "900.00");
  });

  test("el correlativo avanza y no se repite", async () => {
    const a = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    const b = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    assert.equal(a.numero, "00000001");
    assert.equal(b.numero, "00000002");
  });

  test("una serie que no existe se rechaza con un mensaje claro", async () => {
    await assert.rejects(
      () => con((db) => emitirVenta(db, empresaId, usuarioId, { ...ventaBase(), serie: "F999" })),
      /la serie F999 no está registrada/,
    );
  });

  test("no se factura a quien no tiene RUC", async () => {
    // Es la regla que más facturas rebota en SUNAT.
    await assert.rejects(
      () =>
        con((db) =>
          emitirVenta(db, empresaId, usuarioId, { ...ventaBase(), clienteId: clienteSinRuc }),
        ),
      /no tiene RUC: emita una boleta/,
    );
  });

  test("a quien tiene DNI sí se le emite boleta", async () => {
    const r = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        ...ventaBase(),
        clienteId: clienteSinRuc,
        tipoDocumento: "03",
        serie: "B001",
      }),
    );
    assert.equal(r.numero, "00000001");
  });

  test("la mercadería sale del almacén al costo del kardex", async () => {
    const antes = await con((db) => existencias(db, almacenId));
    assert.equal(s2(antes[0]!.cantidad), "100.00");

    await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const despues = await con((db) => existencias(db, almacenId));
    assert.equal(s2(despues[0]!.cantidad), "90.00");
    assert.equal(s2(despues[0]!.valor), "27000.00", "quedan 90 a 300");
  });

  test("no se vende más de lo que hay", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirVenta(db, empresaId, usuarioId, {
            ...ventaBase(),
            lineas: [{ productoId: producto, cantidad: "500", valorUnitario: "500" }],
          }),
        ),
      /stock insuficiente/i,
    );
  });

  test("el asiento registra la venta y su costo, y cuadra", async () => {
    await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    const balance = await con((db) => balanceComprobacion(db, "202609"));

    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00");

    assert.equal(s2(balance.find((b) => b.cuenta === "1212")!.saldo), "5900.00", "cliente");
    assert.equal(s2(balance.find((b) => b.cuenta === "70111")!.saldo), "-5000.00", "ingreso");
    assert.equal(s2(balance.find((b) => b.cuenta === "69111")!.saldo), "3000.00", "costo de ventas");
  });

  test("sin el asiento de costo, el margen aparecería disparado", async () => {
    await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const ingreso = money.neg(money.dec(balance.find((b) => b.cuenta === "70111")!.saldo));
    const costo = money.dec(balance.find((b) => b.cuenta === "69111")!.saldo);
    // Margen real: 5000 − 3000 = 2000, no 5000.
    assert.equal(money.toString(money.sub(ingreso, costo), 2), "2000.00");
  });

  test("un servicio sin producto se vende sin tocar inventario", async () => {
    await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        ...ventaBase(),
        lineas: [
          { descripcion: "Instalación y puesta en marcha", cantidad: "1", valorUnitario: "800" },
        ],
      }),
    );
    const saldos = await con((db) => existencias(db, almacenId));
    assert.equal(s2(saldos[0]!.cantidad), "100.00", "el stock no se movió");
  });

  test("una línea sin producto ni descripción se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirVenta(db, empresaId, usuarioId, {
            ...ventaBase(),
            lineas: [{ cantidad: "1", valorUnitario: "100" }],
          }),
        ),
      /indique un producto o una descripción/,
    );
  });

  test("la detracción se calcula y marca el tipo de operación", async () => {
    const r = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, { ...ventaBase(), detraccionCodigo: "037" }),
    );
    const { cabecera } = await con((db) => cargarComprobante(db, r.comprobanteId));
    assert.equal(s2(cabecera.detraccionMonto), "708.00", "12 % de 5900");
    assert.equal(cabecera.tipoOperacion, cpe.TIPO_OPERACION.DETRACCION);
  });

  test("el comprobante nace en borrador, sin haber tocado SUNAT", async () => {
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    const { cabecera } = await con((db) => cargarComprobante(db, r.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.BORRADOR);
    assert.equal(cabecera.xmlFirmado, null);
  });
});

// ─── Importe en letras ────────────────────────────────────────────────────

describe("importe en letras", () => {
  const l = (v: string, m = "PEN") => enLetras(money.dec(v), m);

  test("los casos que exige la representación impresa", () => {
    assert.equal(l("5900.00"), "CINCO MIL NOVECIENTOS CON 00/100 SOLES");
    assert.equal(l("1.50"), "UN CON 50/100 SOLES");
    assert.equal(l("100.00"), "CIEN CON 00/100 SOLES");
    assert.equal(l("101.00"), "CIENTO UN CON 00/100 SOLES");
    assert.equal(l("1000.00"), "MIL CON 00/100 SOLES");
    assert.equal(l("0.99"), "CERO CON 99/100 SOLES");
  });

  test("un millón se dice en singular y dos en plural", () => {
    assert.match(l("1000000.00"), /^UN MILLÓN/);
    assert.match(l("2000000.00"), /^DOS MILLONES/);
  });

  test("la moneda cambia el texto final", () => {
    assert.match(l("100.00", "USD"), /DÓLARES AMERICANOS$/);
    assert.match(l("100.00", "EUR"), /EUROS$/);
  });

  test("los céntimos van sobre cien, no redondeados a soles", () => {
    assert.match(l("1234.56"), /CON 56\/100/);
  });
});

// ─── Envío a SUNAT ────────────────────────────────────────────────────────

describe("envío a SUNAT", () => {
  async function configurarCertificado() {
    const cert = certificadoDePrueba("20303051831");
    const pfx = pfxDePrueba(cert, "clave-pfx");
    const contexto = `empresa:${empresaId}:certificado`;

    await raw`
      INSERT INTO certificados_digitales (empresa_id, pfx_cifrado, password_cifrado, ruc, activo)
      VALUES (${empresaId},
              ${JSON.stringify(sellar(KEK, "test", pfx, contexto))}::jsonb,
              ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("clave-pfx"), contexto))}::jsonb,
              '20303051831', true)`;
    await raw`
      INSERT INTO credenciales_sunat (empresa_id, usuario_sol, clave_cifrada, entorno)
      VALUES (${empresaId}, 'MODDATOS',
              ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("MODDATOS"), `empresa:${empresaId}:sol`))}::jsonb,
              'beta')`;
  }

  const cdrFalso = (codigo: string, descripcion: string) => {
    const xml = `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x"><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>${descripcion}</cbc:Description></ApplicationResponse>`;
    return Buffer.from(zipSync({ "R-1.xml": new TextEncoder().encode(xml) })).toString("base64");
  };

  const fetchAcepta = (async () =>
    new Response(
      `<soap:Envelope xmlns:soap="http://x"><soap:Body><applicationResponse>${cdrFalso("0", "La Factura ha sido aceptada")}</applicationResponse></soap:Body></soap:Envelope>`,
      { status: 200 },
    )) as unknown as typeof fetch;

  test("firma, envía y guarda el CDR", async () => {
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const envio = await enviar(r.comprobanteId, fetchAcepta);
    assert.equal(envio.estado, cpe.ESTADO_CPE.ACEPTADO);

    const { cabecera } = await con((db) => cargarComprobante(db, r.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.ACEPTADO);
    assert.ok(cabecera.xmlFirmado?.includes("SignatureValue"), "el XML firmado se conserva");
    assert.ok(cabecera.cdrBase64, "el CDR se conserva: es la constancia ante SUNAT");
    assert.match(cabecera.hashXml!, /^[0-9a-f]{64}$/);
  });

  test("una caída de SUNAT no borra la venta", async () => {
    // Es la razón de que emitir y enviar sean dos actos separados: el mostrador
    // no puede dejar de vender porque un servicio ajeno no responde.
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const fetchCaido = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await assert.rejects(() => enviar(r.comprobanteId, fetchCaido));

    const { cabecera } = await con((db) => cargarComprobante(db, r.comprobanteId));
    assert.equal(s2(cabecera.total), "5900.00", "la venta sigue existiendo");
    assert.notEqual(cabecera.estado, cpe.ESTADO_CPE.RECHAZADO, "un fallo de red no es un rechazo");

    const pendientes = await con((db) => pendientesDeEnvio(db));
    assert.equal(pendientes.length, 1, "queda en la cola para reintentar");
  });

  test("un rechazo de SUNAT sí se guarda como tal", async () => {
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const fetchRechaza = (async () =>
      new Response(
        `<soap:Envelope xmlns:soap="http://x"><soap:Body><applicationResponse>${cdrFalso("2335", "El comprobante contiene un valor no permitido")}</applicationResponse></soap:Body></soap:Envelope>`,
        { status: 200 },
      )) as unknown as typeof fetch;

    // Un rechazo no se lanza: es un resultado legítimo que hay que registrar.
    const envio = await enviar(r.comprobanteId, fetchRechaza);
    assert.equal(envio.estado, cpe.ESTADO_CPE.RECHAZADO);
    assert.equal(envio.codigo, 2335);

    const { cabecera } = await con((db) => cargarComprobante(db, r.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.RECHAZADO);
    assert.equal(cabecera.codigoSunat, 2335);
    assert.match(cabecera.mensajeSunat!, /valor no permitido/);
  });

  test("reenviar un comprobante ya aceptado no lo reenvía", async () => {
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    await enviar(r.comprobanteId, fetchAcepta);

    let llamadas = 0;
    const contador = (async () => {
      llamadas++;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const segundo = await enviar(r.comprobanteId, contador);
    assert.equal(llamadas, 0, "no debe volver a llamar a SUNAT");
    assert.equal(segundo.estado, cpe.ESTADO_CPE.ACEPTADO);
  });

  test("el código 1033 —ya registrado— se trata como aceptación", async () => {
    // Pasa al reintentar un envío cuyo resultado se perdió. El comprobante está
    // bien; insistir sólo lo dejaría en cola para siempre.
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const fetchYaExiste = (async () =>
      new Response(
        `<soap:Envelope xmlns:soap="http://x"><soap:Body><soap:Fault><faultcode>soap-env:Client.1033</faultcode><faultstring>El comprobante fue registrado previamente</faultstring></soap:Fault></soap:Body></soap:Envelope>`,
        { status: 500 },
      )) as unknown as typeof fetch;

    const envio = await enviar(r.comprobanteId, fetchYaExiste);
    assert.equal(envio.estado, cpe.ESTADO_CPE.ACEPTADO);
    assert.equal(envio.codigo, 1033);
  });

  test("sin certificado cargado, el envío avisa en vez de fallar de forma críptica", async () => {
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    await assert.rejects(
      () => enviar(r.comprobanteId, fetchAcepta),
      /no tiene un certificado digital cargado/,
    );
  });

  test("el certificado se guarda cifrado, nunca en claro", async () => {
    await configurarCertificado();
    const [fila] = await raw<{ pfx_cifrado: unknown; password_cifrado: unknown }[]>`
      SELECT pfx_cifrado, password_cifrado FROM certificados_digitales`;
    const texto = JSON.stringify(fila);
    assert.ok(!texto.includes("clave-pfx"), "la contraseña del PFX no puede estar en claro");
    assert.ok(!texto.includes("PRIVATE KEY"), "la clave privada tampoco");
  });

  test("con una clave maestra distinta el certificado no se abre", async () => {
    await configurarCertificado();
    const r = await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));
    await assert.rejects(
      () => enviar(r.comprobanteId, fetchAcepta, new Uint8Array(32).fill(99)),
      "sin la clave maestra correcta, el certificado es inservible",
    );
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("las ventas y los certificados de una empresa no se ven desde otra", async () => {
    await con((db) => emitirVenta(db, empresaId, usuarioId, ventaBase()));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarVentas(db),
    );
    assert.deepEqual(desdeOtra, []);
  });
});
