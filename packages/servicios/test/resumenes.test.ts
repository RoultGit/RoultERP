/**
 * Resúmenes diarios de boletas y comunicaciones de baja.
 *
 * Lo que se comprueba aquí, además del XML: que un ticket «en proceso» no se
 * confunda con un rechazo, y que el desenlace del resumen se propague a cada
 * comprobante que agrupa. Un resumen aceptado cuyas boletas siguen en borrador
 * deja al contribuyente creyendo que declaró algo que no declaró.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { cpe } from "@roulterp/core";
import { sellar } from "@roulterp/core/auth";
import { certificadoDePrueba, pfxDePrueba, verificarFirma } from "@roulterp/core/cpe";
import {
  crearEmpresa, registrarCompra, emitirVenta,
  generarResumenDiario, generarComunicacionBaja, enviarResumenASunat, recogerTicket,
  boletasPendientes, diasPendientesDeResumen, cargarResumen, listarResumenes,
  cargarComprobante, ResumenInvalido,
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
let clienteConRuc = "";
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
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '1', '45678912', 'JUAN PÉREZ', true) RETURNING id`;
  cliente = c!.id;

  const [cr] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRÁULICA DEL SUR S.A.C.', true) RETURNING id`;
  clienteConRuc = cr!.id;

  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '03', 'B001', 0)`;

  await enEmpresa(app, { empresaId, usuarioId }, (db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: prov!.id, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "100", valorUnitario: "300" }],
    }),
  );

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
});

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);

/** Emite una boleta del día indicado. Queda en borrador, como toda boleta. */
const boleta = (fecha: string, importe = "100") =>
  con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente,
      tipoDocumento: "03",
      serie: "B001",
      fechaEmision: fecha,
      moneda: "PEN",
      tipoCambio: "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "1", valorUnitario: importe }],
    }),
  );

/** Factura aceptada por SUNAT: lo único que se puede dar de baja. */
async function facturaAceptada(fecha = "2026-09-10") {
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: clienteConRuc, tipoDocumento: "01", serie: "F001", fechaEmision: fecha,
      moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId: producto, cantidad: "1", valorUnitario: "1000" }],
    }),
  );
  await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${r.comprobanteId}`;
  return r;
}

// ─── Dobles de SUNAT ──────────────────────────────────────────────────────

const soap = (cuerpo: string) =>
  new Response(
    // El prefijo `ns` va declarado: xmldom rechaza un prefijo sin espacio de
    // nombres, y una respuesta así de rota no la manda SUNAT.
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://service.sunat.gob.pe"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`,
    { status: 200 },
  );

const fetchTicket = (ticket: string) =>
  (async () => soap(`<ns:sendSummaryResponse><ticket>${ticket}</ticket></ns:sendSummaryResponse>`)) as unknown as typeof fetch;

const cdrFalso = (codigo: string, descripcion: string) => {
  const xml = `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x"><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>${descripcion}</cbc:Description></ApplicationResponse>`;
  return Buffer.from(zipSync({ "R-1.xml": new TextEncoder().encode(xml) })).toString("base64");
};

const fetchEstado = (codigo: string, descripcion: string) =>
  (async () =>
    soap(
      `<ns:getStatusResponse><status><statusCode>${codigo === "0" ? "0" : "99"}</statusCode><content>${cdrFalso(codigo, descripcion)}</content></status></ns:getStatusResponse>`,
    )) as unknown as typeof fetch;

const fetchEnProceso = (async () =>
  soap(`<ns:getStatusResponse><status><statusCode>98</statusCode><statusMessage>En proceso</statusMessage></status></ns:getStatusResponse>`)) as unknown as typeof fetch;

// ─── Resumen diario ───────────────────────────────────────────────────────

describe("resumen diario de boletas", () => {
  test("agrupa las boletas del día y las numera", async () => {
    await boleta("2026-09-12", "100");
    await boleta("2026-09-12", "200");

    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12",
        fechaEmision: "2026-09-13",
      }),
    );
    assert.equal(r.comprobantes, 2);
    assert.equal(r.identificador, "RC-20260913-1");
  });

  test("no mezcla boletas de días distintos", async () => {
    await boleta("2026-09-12");
    await boleta("2026-09-13");
    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-14",
      }),
    );
    assert.equal(r.comprobantes, 1);
  });

  test("una factura no entra al resumen: se envía sola", async () => {
    await boleta("2026-09-12");
    await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: clienteConRuc, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-12", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, cantidad: "1", valorUnitario: "500" }],
      }),
    );
    const pendientes = await con((db) => boletasPendientes(db, "2026-09-12"));
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0]!.tipo_documento, "03");
  });

  test("una boleta ya resumida no vuelve a entrar", async () => {
    await boleta("2026-09-12");
    await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );
    const pendientes = await con((db) => boletasPendientes(db, "2026-09-12"));
    assert.equal(pendientes.length, 0, "informarla dos veces duplicaría la venta");
  });

  test("un día sin boletas no genera resumen", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          generarResumenDiario(db, empresaId, usuarioId, {
            fechaReferencia: "2026-09-12",
            fechaEmision: "2026-09-13",
          }),
        ),
      /no hay boletas sin resumir/,
    );
  });

  test("el resumen no puede ser anterior al día que resume", async () => {
    await boleta("2026-09-12");
    await assert.rejects(
      () =>
        con((db) =>
          generarResumenDiario(db, empresaId, usuarioId, {
            fechaReferencia: "2026-09-12", fechaEmision: "2026-09-11",
          }),
        ),
      /no puede ser anterior/,
    );
  });

  test("el correlativo avanza dentro del mismo día de envío", async () => {
    await boleta("2026-09-11");
    await boleta("2026-09-12");
    const a = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-11", fechaEmision: "2026-09-13",
      }),
    );
    const b = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );
    assert.equal(a.identificador, "RC-20260913-1");
    assert.equal(b.identificador, "RC-20260913-2");
  });

  test("la cola de trabajo muestra los días sin resumir", async () => {
    await boleta("2026-09-12", "100");
    await boleta("2026-09-12", "200");
    await boleta("2026-09-13", "300");
    const dias = await con((db) => diasPendientesDeResumen(db));
    assert.equal(dias.length, 2);
    assert.equal(dias[0]!.fecha, "2026-09-13");
    assert.equal(dias[1]!.boletas, 2);
  });
});

// ─── Envío y ticket ───────────────────────────────────────────────────────

describe("envío del resumen y recogida del ticket", () => {
  async function resumenEnviado(ticket = "1234567890") {
    await boleta("2026-09-12", "100");
    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );
    const envio = await enviarResumenASunat(app, ctx(), r.resumenId, KEK, {
      fetchImpl: fetchTicket(ticket),
    });
    return { ...r, envio };
  }

  test("firma el resumen y guarda el ticket", async () => {
    const { resumenId, envio } = await resumenEnviado();
    assert.equal(envio.estado, "enviado");
    assert.equal(envio.ticket, "1234567890");

    const { cabecera } = await con((db) => cargarResumen(db, resumenId));
    assert.equal(cabecera.ticket, "1234567890");
    assert.ok(cabecera.xmlFirmado?.includes("SignatureValue"), "se conserva el XML firmado");
    assert.ok(verificarFirma(cabecera.xmlFirmado!), "la firma del resumen no verifica");
  });

  test("el XML es un SummaryDocuments con una línea por boleta", async () => {
    await boleta("2026-09-12", "100");
    await boleta("2026-09-12", "200");
    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );
    await enviarResumenASunat(app, ctx(), r.resumenId, KEK, { fetchImpl: fetchTicket("t") });
    const { cabecera } = await con((db) => cargarResumen(db, r.resumenId));
    const xml = cabecera.xmlFirmado!;

    assert.ok(xml.includes("<SummaryDocuments"));
    assert.equal(xml.match(/<sac:SummaryDocumentsLine>/g)?.length, 2);
    assert.ok(xml.includes("<cbc:ReferenceDate>2026-09-12</cbc:ReferenceDate>"));
    assert.ok(xml.includes("<cbc:IssueDate>2026-09-13</cbc:IssueDate>"));
    assert.ok(xml.includes("RC-20260913-1"));
  });

  test("«en proceso» no es un rechazo: se vuelve a preguntar", async () => {
    const { resumenId } = await resumenEnviado();
    const r = await recogerTicket(app, ctx(), resumenId, KEK, { fetchImpl: fetchEnProceso });
    assert.equal(r.enProceso, true);

    const { cabecera } = await con((db) => cargarResumen(db, resumenId));
    assert.equal(cabecera.estado, "enviado", "el estado no debe moverse mientras SUNAT procesa");
    assert.equal(cabecera.cdrBase64, null);
  });

  test("aceptado el resumen, sus boletas quedan aceptadas", async () => {
    const { resumenId } = await resumenEnviado();
    const r = await recogerTicket(app, ctx(), resumenId, KEK, {
      fetchImpl: fetchEstado("0", "El resumen ha sido aceptado"),
    });
    assert.equal(r.estado, cpe.ESTADO_CPE.ACEPTADO);

    const { items } = await con((db) => cargarResumen(db, resumenId));
    const { cabecera } = await con((db) => cargarComprobante(db, items[0]!.comprobante_id!));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.ACEPTADO, "la boleta hereda el desenlace");
  });

  test("rechazado el resumen, las boletas no quedan declaradas", async () => {
    const { resumenId } = await resumenEnviado();
    await recogerTicket(app, ctx(), resumenId, KEK, {
      fetchImpl: fetchEstado("2335", "El resumen contiene errores"),
    });
    const { items } = await con((db) => cargarResumen(db, resumenId));
    const { cabecera } = await con((db) => cargarComprobante(db, items[0]!.comprobante_id!));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.RECHAZADO);
  });

  test("recoger dos veces no vuelve a preguntar a SUNAT", async () => {
    const { resumenId } = await resumenEnviado();
    await recogerTicket(app, ctx(), resumenId, KEK, { fetchImpl: fetchEstado("0", "aceptado") });

    const explota = (async () => {
      throw new Error("no debió llamarse a SUNAT otra vez");
    }) as unknown as typeof fetch;
    const r = await recogerTicket(app, ctx(), resumenId, KEK, { fetchImpl: explota });
    assert.equal(r.estado, cpe.ESTADO_CPE.ACEPTADO);
  });

  test("no se recoge el ticket de un resumen que no se envió", async () => {
    await boleta("2026-09-12");
    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );
    await assert.rejects(
      () => recogerTicket(app, ctx(), r.resumenId, KEK, { fetchImpl: fetchEnProceso }),
      /todavía no se ha enviado/,
    );
  });

  test("reenviar no duplica: devuelve el ticket que ya tenía", async () => {
    const { resumenId } = await resumenEnviado("AAA");
    const explota = (async () => {
      throw new Error("no debió reenviarse");
    }) as unknown as typeof fetch;
    const r = await enviarResumenASunat(app, ctx(), resumenId, KEK, { fetchImpl: explota });
    assert.equal(r.ticket, "AAA");
  });
});

// ─── Comunicación de baja ─────────────────────────────────────────────────

describe("comunicación de baja", () => {
  test("da de baja una factura aceptada", async () => {
    const f = await facturaAceptada();
    const r = await con((db) =>
      generarComunicacionBaja(db, empresaId, usuarioId, {
        comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "Error en el RUC del cliente" }],
        fechaEmision: "2026-09-11",
      }),
    );
    assert.equal(r.identificador, "RA-20260911-1");

    // El comprobante queda marcado en cuanto se pide la baja, no cuando SUNAT
    // contesta: si no, alguien podría cobrarlo mientras tanto.
    const { cabecera } = await con((db) => cargarComprobante(db, f.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.BAJA_SOLICITADA);
  });

  test("una boleta no se da de baja: se anula en su resumen", async () => {
    const b = await boleta("2026-09-12");
    await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${b.comprobanteId}`;
    await assert.rejects(
      () =>
        con((db) =>
          generarComunicacionBaja(db, empresaId, usuarioId, {
            comprobantes: [{ comprobanteId: b.comprobanteId, motivo: "error" }],
          }),
        ),
      /se anula en su resumen diario/,
    );
  });

  test("no se da de baja lo que SUNAT nunca aceptó", async () => {
    const f = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: clienteConRuc, tipoDocumento: "01", serie: "F001",
        fechaEmision: "2026-09-10", moneda: "PEN", tipoCambio: "1", almacenId,
        lineas: [{ productoId: producto, cantidad: "1", valorUnitario: "100" }],
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          generarComunicacionBaja(db, empresaId, usuarioId, {
            comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "error" }],
          }),
        ),
      /no está aceptado por SUNAT/,
    );
  });

  test("la baja exige un motivo", async () => {
    const f = await facturaAceptada();
    await assert.rejects(
      () =>
        con((db) =>
          generarComunicacionBaja(db, empresaId, usuarioId, {
            comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "   " }],
          }),
        ),
      /necesita un motivo/,
    );
  });

  test("una comunicación agrupa comprobantes de un solo día", async () => {
    const a = await facturaAceptada("2026-09-10");
    const b = await facturaAceptada("2026-09-11");
    await assert.rejects(
      () =>
        con((db) =>
          generarComunicacionBaja(db, empresaId, usuarioId, {
            comprobantes: [
              { comprobanteId: a.comprobanteId, motivo: "error" },
              { comprobanteId: b.comprobanteId, motivo: "error" },
            ],
          }),
        ),
      /un solo día/,
    );
  });

  test("el XML es un VoidedDocuments con el motivo de cada baja", async () => {
    const f = await facturaAceptada();
    const r = await con((db) =>
      generarComunicacionBaja(db, empresaId, usuarioId, {
        comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "Error en el RUC del cliente" }],
        fechaEmision: "2026-09-11",
      }),
    );
    await enviarResumenASunat(app, ctx(), r.resumenId, KEK, { fetchImpl: fetchTicket("t2") });

    const { cabecera } = await con((db) => cargarResumen(db, r.resumenId));
    const xml = cabecera.xmlFirmado!;
    assert.ok(xml.includes("<VoidedDocuments"));
    assert.ok(xml.includes("<sac:DocumentSerialID>F001</sac:DocumentSerialID>"));
    assert.ok(xml.includes("Error en el RUC del cliente"));
    assert.ok(verificarFirma(xml), "la firma de la baja no verifica");
  });

  test("aceptada la baja, el comprobante queda dado de baja", async () => {
    const f = await facturaAceptada();
    const r = await con((db) =>
      generarComunicacionBaja(db, empresaId, usuarioId, {
        comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "Error en el RUC" }],
      }),
    );
    await enviarResumenASunat(app, ctx(), r.resumenId, KEK, { fetchImpl: fetchTicket("t3") });
    await recogerTicket(app, ctx(), r.resumenId, KEK, {
      fetchImpl: fetchEstado("0", "La comunicación de baja ha sido aceptada"),
    });

    const { cabecera } = await con((db) => cargarComprobante(db, f.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.DADO_DE_BAJA);
  });

  test("rechazada la baja, el comprobante vuelve a estar vigente", async () => {
    const f = await facturaAceptada();
    const r = await con((db) =>
      generarComunicacionBaja(db, empresaId, usuarioId, {
        comprobantes: [{ comprobanteId: f.comprobanteId, motivo: "Error en el RUC" }],
      }),
    );
    await enviarResumenASunat(app, ctx(), r.resumenId, KEK, { fetchImpl: fetchTicket("t4") });
    await recogerTicket(app, ctx(), r.resumenId, KEK, {
      fetchImpl: fetchEstado("2325", "El comprobante no puede darse de baja"),
    });

    // Es lo correcto: la factura sigue existiendo para SUNAT, así que tiene que
    // seguir existiendo aquí.
    const { cabecera } = await con((db) => cargarComprobante(db, f.comprobanteId));
    assert.equal(cabecera.estado, cpe.ESTADO_CPE.ACEPTADO);
  });

  test("los resúmenes se listan del más reciente al más antiguo", async () => {
    await boleta("2026-09-11");
    await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-11", fechaEmision: "2026-09-12",
      }),
    );
    await boleta("2026-09-13");
    await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-13", fechaEmision: "2026-09-14",
      }),
    );
    const lista = await con((db) => listarResumenes(db));
    assert.equal(lista.length, 2);
    assert.equal(lista[0]!.identificador, "RC-20260914-1");
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("una empresa no ve los resúmenes de otra", async () => {
    await boleta("2026-09-12");
    await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-12", fechaEmision: "2026-09-13",
      }),
    );

    const otra = await crearEmpresa(
      URL,
      { ruc: "20522633721", razonSocial: "OTRA EMPRESA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-2" },
    );
    const lista = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarResumenes(db),
    );
    assert.equal(lista.length, 0);
  });
});
