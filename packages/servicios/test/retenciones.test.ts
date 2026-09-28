/**
 * Comprobantes de retención y de percepción.
 *
 * Lo que más importa aquí es que el importe declarado sea el que realmente se
 * retuvo o percibió, no uno recalculado: el proveedor tiene en la mano un
 * comprobante con una cifra, y si la declarada no coincide, la diferencia
 * aparece en su declaración y no en la nuestra.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money, cpe } from "@roulterp/core";
import { sellar } from "@roulterp/core/auth";
import { certificadoDePrueba, pfxDePrueba, verificarFirma } from "@roulterp/core/cpe";
import {
  crearEmpresa, registrarCompra, registrarPago, emitirVenta, registrarCobranza,
  emitirRetencionDePago, emitirPercepcionDeCobranza, enviarRetencionASunat,
  listarRetenciones, cargarRetencion, pagosSinRetencion, cobranzasSinPercepcion,
  documentosPorPagar, RetencionInvalida,
} from "../src/index.ts";
import { zipSync } from "fflate";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(23);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let proveedor = "";
let cliente = "";
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

  // Sin esto no se retiene: la retención la practica un agente designado.
  await raw`UPDATE empresas SET es_agente_retencion = true WHERE id = ${empresaId}`;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [p] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERÍA SAN MARTÍN S.A.C.', true, 30)
    RETURNING id`;
  proveedor = p!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRÁULICA DEL SUR S.A.C.', true) RETURNING id`;
  cliente = c!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = pr!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0),
           (${empresaId}, '20', 'R001', 0),
           (${empresaId}, '40', 'P001', 0)`;

  const cert = certificadoDePrueba("20303051831");
  const contexto = `empresa:${empresaId}:certificado`;
  await raw`
    INSERT INTO certificados_digitales (empresa_id, pfx_cifrado, password_cifrado, ruc, activo)
    VALUES (${empresaId},
            ${JSON.stringify(sellar(KEK, "test", pfxDePrueba(cert, "clave-pfx"), contexto))}::jsonb,
            ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("clave-pfx"), contexto))}::jsonb,
            '20303051831', true)`;
  await raw`
    INSERT INTO credenciales_sunat (empresa_id, usuario_sol, clave_cifrada, entorno)
    VALUES (${empresaId}, 'MODDATOS',
            ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("clavesol"), `empresa:${empresaId}:sol`))}::jsonb,
            'beta')`;
});

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

/** Compra por 5 900 y pago con retención del 3 %. */
async function compraYPago(opciones: { moneda?: string; tipoCambio?: string } = {}) {
  const moneda = opciones.moneda ?? "PEN";
  const tipoCambio = opciones.tipoCambio ?? "1";

  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0001234",
      fechaEmision: "2026-09-01", moneda, tipoCambio, almacenId,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "10", valorUnitario: "500" }],
    }),
  );
  const docs = await con((db) => documentosPorPagar(db, proveedor));

  return con((db) =>
    registrarPago(db, empresaId, usuarioId, {
      numero: "PG-0001",
      proveedorId: proveedor,
      fecha: "2026-09-15",
      moneda,
      tipoCambio,
      medioPago: "transferencia",
      cuentaOrigen: "1041",
      retenerIgv: true,
      aplicaciones: [{ documentoId: docs[0]!.id, importe: docs[0]!.saldo }],
    }),
  );
}

// ─── Dobles de SUNAT ──────────────────────────────────────────────────────

const cdrFalso = (codigo: string, descripcion: string) => {
  const xml = `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x"><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>${descripcion}</cbc:Description></ApplicationResponse>`;
  return Buffer.from(zipSync({ "R-1.xml": new TextEncoder().encode(xml) })).toString("base64");
};

const fetchAcepta = (async () =>
  new Response(
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><applicationResponse>${cdrFalso("0", "El comprobante de retención ha sido aceptado")}</applicationResponse></soap:Body></soap:Envelope>`,
    { status: 200 },
  )) as unknown as typeof fetch;

// ─── Retención ────────────────────────────────────────────────────────────

describe("comprobante de retención", () => {
  test("declara exactamente lo que se retuvo en el pago", async () => {
    const pago = await compraYPago();
    // 3 % de 5 900.
    assert.equal(s2(pago.retencion), "177.00");

    const r = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    assert.equal(r.numero, "00000001");
    assert.equal(s2(r.importeTotal), "177.00");
  });

  test("el detalle apunta a la factura retenida con su neto", async () => {
    const pago = await compraYPago();
    const r = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const { items } = await con((db) => cargarRetencion(db, r.id));
    assert.equal(items.length, 1);
    assert.equal(items[0]!.serie, "F001");
    assert.equal(s2(items[0]!.importe), "177.00");
    assert.equal(s2(items[0]!.neto), "5723.00", "5900 menos 177");
  });

  test("un pago sin retención no genera comprobante", async () => {
    await raw`UPDATE empresas SET es_agente_retencion = false WHERE id = ${empresaId}`;
    const pago = await compraYPago();
    assert.equal(s2(pago.retencion), "0.00");
    await assert.rejects(
      () =>
        con((db) =>
          emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
        ),
      /no retuvo nada/,
    );
  });

  test("no se emite dos veces sobre el mismo pago", async () => {
    const pago = await compraYPago();
    await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
        ),
      /ya tiene su comprobante/,
    );
  });

  test("una compra en dólares se declara en soles con su tipo de cambio", async () => {
    const pago = await compraYPago({ moneda: "USD", tipoCambio: "3.752" });
    const r = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const { cabecera, items } = await con((db) => cargarRetencion(db, r.id));

    // La operación se declara en soles: 5 900 USD por 3.752.
    assert.equal(s2(cabecera.importeOperacion), "22136.80");
    assert.equal(items[0]!.moneda, "USD");
    assert.equal(s2(items[0]!.tipoCambio!), "3.75");
  });

  test("la cola de trabajo muestra los pagos con retención sin documentar", async () => {
    const pago = await compraYPago();
    const antes = await con((db) => pagosSinRetencion(db));
    assert.equal(antes.length, 1);
    assert.equal(antes[0]!.numero, "PG-0001");

    await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const despues = await con((db) => pagosSinRetencion(db));
    assert.equal(despues.length, 0);
  });

  test("firma, envía y guarda el CDR", async () => {
    const pago = await compraYPago();
    const r = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );

    const envio = await enviarRetencionASunat(app, ctx(), r.id, KEK, { fetchImpl: fetchAcepta });
    assert.equal(envio.estado, cpe.ESTADO_CPE.ACEPTADO);

    const { cabecera } = await con((db) => cargarRetencion(db, r.id));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.ACEPTADO);
    assert.ok(cabecera.cdrBase64, "el CDR es la constancia");
    assert.ok(cabecera.xmlFirmado!.includes("<Retention"), "es un documento de retención");
    assert.ok(verificarFirma(cabecera.xmlFirmado!));
  });

  test("un rechazo se guarda en vez de lanzarse", async () => {
    const pago = await compraYPago();
    const r = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const fetchRechaza = (async () =>
      new Response(
        `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap-env:Client.2335</faultcode><faultstring>El documento ya existe</faultstring></soap:Fault></soap:Body></soap:Envelope>`,
        { status: 500 },
      )) as unknown as typeof fetch;

    const envio = await enviarRetencionASunat(app, ctx(), r.id, KEK, { fetchImpl: fetchRechaza });
    assert.equal(envio.estado, cpe.ESTADO_CPE.RECHAZADO);
    const { cabecera } = await con((db) => cargarRetencion(db, r.id));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.RECHAZADO);
    assert.equal(cabecera.codigoSunat, 2335);
  });

  test("sin serie del tipo 20 no se puede emitir", async () => {
    await raw`DELETE FROM series_documento WHERE empresa_id = ${empresaId} AND tipo_documento = '20'`;
    const pago = await compraYPago();
    await assert.rejects(
      () =>
        con((db) =>
          emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
        ),
      /no está registrada para el tipo de documento 20/,
    );
  });
});

// ─── Percepción ───────────────────────────────────────────────────────────

describe("comprobante de percepción", () => {
  /** Venta con percepción cobrada. */
  async function ventaConPercepcionCobrada() {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0009999",
        fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "50", valorUnitario: "300" }],
      }),
    );
    const venta = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-05", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, cantidad: "2", valorUnitario: "500" }],
      }),
    );
    // La percepción se cobró al emitir: 2 % de 1 180.
    await raw`
      UPDATE comprobantes SET percepcion_monto = 23.60, estado = 'aceptado'
      WHERE id = ${venta.comprobanteId}`;

    const cobranza = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: "CB-0001",
        clienteId: cliente,
        fecha: "2026-09-20",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "transferencia",
        cuentaDestino: "1041",
        aplicaciones: [{ comprobanteId: venta.comprobanteId, importe: "1180.00" }],
      }),
    );
    return { venta, cobranza };
  }

  test("documenta la percepción que se cobró con la venta", async () => {
    const { cobranza } = await ventaConPercepcionCobrada();
    const r = await con((db) =>
      emitirPercepcionDeCobranza(db, empresaId, usuarioId, {
        cobranzaId: cobranza.cobranzaId,
        serie: "P001",
      }),
    );
    assert.equal(s2(r.importeTotal), "23.60");

    const { items } = await con((db) => cargarRetencion(db, r.id));
    // En la percepción el neto es lo cobrado *más* lo percibido.
    assert.equal(s2(items[0]!.neto), "1203.60");
  });

  test("el XML es un Perception, no un Retention", async () => {
    const { cobranza } = await ventaConPercepcionCobrada();
    const r = await con((db) =>
      emitirPercepcionDeCobranza(db, empresaId, usuarioId, {
        cobranzaId: cobranza.cobranzaId,
        serie: "P001",
      }),
    );
    await enviarRetencionASunat(app, ctx(), r.id, KEK, { fetchImpl: fetchAcepta });

    const { cabecera } = await con((db) => cargarRetencion(db, r.id));
    assert.ok(cabecera.xmlFirmado!.includes("<Perception"));
    assert.ok(cabecera.xmlFirmado!.includes("SUNATPerceptionPercent"));
    assert.ok(verificarFirma(cabecera.xmlFirmado!));
  });

  test("una cobranza sin percepción no genera comprobante", async () => {
    await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0008888",
        fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "50", valorUnitario: "300" }],
      }),
    );
    const venta = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-05", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, cantidad: "1", valorUnitario: "500" }],
      }),
    );
    const cobranza = await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: "CB-0002", clienteId: cliente, fecha: "2026-09-20",
        moneda: "PEN", tipoCambio: "1", medioCobro: "transferencia", cuentaDestino: "1041",
        aplicaciones: [{ comprobanteId: venta.comprobanteId, importe: "590.00" }],
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          emitirPercepcionDeCobranza(db, empresaId, usuarioId, {
            cobranzaId: cobranza.cobranzaId,
            serie: "P001",
          }),
        ),
      /ningún comprobante de esta cobranza llevaba percepción/,
    );
  });

  test("la cola de trabajo distingue percepciones pendientes", async () => {
    const { cobranza } = await ventaConPercepcionCobrada();
    const antes = await con((db) => cobranzasSinPercepcion(db));
    assert.equal(antes.length, 1);
    assert.equal(s2(antes[0]!.percepcion), "23.60");

    await con((db) =>
      emitirPercepcionDeCobranza(db, empresaId, usuarioId, {
        cobranzaId: cobranza.cobranzaId, serie: "P001",
      }),
    );
    assert.equal((await con((db) => cobranzasSinPercepcion(db))).length, 0);
  });

  test("las listas separan retenciones de percepciones", async () => {
    const pago = await compraYPago();
    await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const todas = await con((db) => listarRetenciones(db));
    const soloRetenciones = await con((db) => listarRetenciones(db, "20"));
    const soloPercepciones = await con((db) => listarRetenciones(db, "40"));
    assert.equal(todas.length, 1);
    assert.equal(soloRetenciones.length, 1);
    assert.equal(soloPercepciones.length, 0);
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("una empresa no ve los comprobantes de retención de otra", async () => {
    const pago = await compraYPago();
    await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    const otra = await crearEmpresa(
      URL,
      { ruc: "20522633721", razonSocial: "OTRA EMPRESA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-2" },
    );
    const lista = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarRetenciones(db),
    );
    assert.equal(lista.length, 0);
  });
});
