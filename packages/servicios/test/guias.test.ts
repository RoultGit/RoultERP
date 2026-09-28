/**
 * Guías de remisión electrónicas.
 *
 * La API de la GRE es la única parte del sistema que no habla SOAP con SUNAT, y
 * la que usa credenciales distintas. Estas pruebas fijan las dos cosas que
 * hacen fallar una integración de GRE: pedir el token con el `username`
 * equivocado, y emitir una guía a la que le falta lo que exige su modalidad de
 * transporte.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { sellar } from "@roulterp/core/auth";
import { certificadoDePrueba, pfxDePrueba, verificarFirma } from "@roulterp/core/cpe";
import {
  crearEmpresa, guardarCredencialesGre,
  emitirGuia, enviarGuiaASunat, recogerTicketGuia,
  listarGuias, cargarGuia, seriesDeGuia, GuiaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(23);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let destinatario = "";
let transportista = "";
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

  const [d] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRÁULICA DEL SUR S.A.C.', true) RETURNING id`;
  destinatario = d!.id;

  const [t] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'TRANSPORTES DEL SUR S.A.', true) RETURNING id`;
  transportista = t!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga 2HP', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '09', 'T001', 0)`;

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

const guiaBase = () => ({
  serie: "T001",
  fechaEmision: "2026-09-12",
  destinatarioId: destinatario,
  motivo: "04",
  descripcionMotivo: "Traslado entre establecimientos",
  pesoBruto: "120.5",
  modoTransporte: "02",
  fechaTraslado: "2026-09-13",
  partida: { ubigeo: "150103", direccion: "Av. Nicolás Ayllón 3820, Ate" },
  llegada: { ubigeo: "150132", direccion: "Av. Argentina 2000, San Miguel" },
  placa: "ABC-123",
  conductor: {
    tipoDocumento: "1",
    numeroDocumento: "45678912",
    nombres: "Juan",
    apellidos: "Pérez",
    licencia: "Q45678912",
  },
  lineas: [{ productoId: producto, cantidad: "4" }],
});

const configurarGre = () =>
  con((db) =>
    guardarCredencialesGre(
      db,
      empresaId,
      { clientId: "cliente-gre-0001", clientSecret: "secreto-gre" },
      KEK,
      "test",
    ),
  );

// ─── Doble de la API REST ─────────────────────────────────────────────────

type Llamada = { url: string; metodo: string; cuerpo: string; auth?: string };

/**
 * Simula la API de la GRE y guarda lo que recibe.
 *
 * Registrar las llamadas es lo que permite comprobar que el `username` del
 * token es el RUC pegado al usuario SOL: es un detalle invisible que devuelve
 * un 401 sin explicación cuando está mal.
 */
function apiFalsa(respuestas: { estado?: Record<string, unknown>; ticket?: string } = {}) {
  const llamadas: Llamada[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    llamadas.push({
      url: u,
      metodo: init?.method ?? "GET",
      cuerpo: String(init?.body ?? ""),
      auth: (init?.headers as Record<string, string>)?.["Authorization"],
    });

    if (u.includes("oauth2/token")) {
      return new Response(
        JSON.stringify({ access_token: "token-de-prueba", token_type: "bearer", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/envios/")) {
      return new Response(JSON.stringify(respuestas.estado ?? { codRespuesta: "98" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ numTicket: respuestas.ticket ?? "1a2b3c", fecRecepcion: "2026-09-12T10:00:00" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  return { fetchImpl, llamadas };
}

// ─── Emisión ──────────────────────────────────────────────────────────────

describe("emisión de la guía", () => {
  test("numera la guía y guarda sus bienes", async () => {
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    assert.equal(g.numero, "00000001");

    const { cabecera, items } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.estado, "borrador");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.codigo, "P001", "el código sale del producto");
    assert.equal(items[0]!.unidad, "NIU");
  });

  test("el correlativo avanza con cada guía", async () => {
    await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const b = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    assert.equal(b.numero, "00000002");
  });

  test("una guía sin bienes no se emite", async () => {
    await assert.rejects(
      () => con((db) => emitirGuia(db, empresaId, usuarioId, { ...guiaBase(), lineas: [] })),
      /al menos un bien/,
    );
  });

  test("el transporte privado sin conductor se rechaza antes de guardar", async () => {
    const sinConductor = { ...guiaBase() };
    delete (sinConductor as { conductor?: unknown }).conductor;
    await assert.rejects(
      () => con((db) => emitirGuia(db, empresaId, usuarioId, sinConductor)),
      /datos del conductor/,
    );
    const lista = await con((db) => listarGuias(db));
    assert.equal(lista.length, 0, "una guía inválida no debe quedar guardada");
  });

  test("el transporte público exige transportista", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirGuia(db, empresaId, usuarioId, { ...guiaBase(), modoTransporte: "01" }),
        ),
      /identificar al transportista/,
    );
  });

  test("con transportista, el transporte público sí se emite", async () => {
    const g = await con((db) =>
      emitirGuia(db, empresaId, usuarioId, {
        ...guiaBase(),
        modoTransporte: "01",
        transportistaId: transportista,
        registroMtc: "MTC-0001",
      }),
    );
    const { cabecera } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.transportistaId, transportista);
  });

  test("un traslado por venta exige el comprobante que lo sustenta", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirGuia(db, empresaId, usuarioId, {
            ...guiaBase(),
            motivo: "01",
            descripcionMotivo: "Venta",
          }),
        ),
      /comprobante que lo sustenta/,
    );
  });

  test("una cantidad de cero no se traslada", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirGuia(db, empresaId, usuarioId, {
            ...guiaBase(),
            lineas: [{ productoId: producto, cantidad: "0" }],
          }),
        ),
      /mayor que cero/,
    );
  });

  test("sin serie registrada no se puede emitir", async () => {
    await raw`DELETE FROM series_documento WHERE empresa_id = ${empresaId}`;
    await assert.rejects(
      () => con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase())),
      /no está registrada para guías/,
    );
  });

  test("las series de guía se listan aparte de las de factura", async () => {
    const series = await con((db) => seriesDeGuia(db));
    assert.deepEqual(series.map((s) => s.serie), ["T001"]);
  });
});

// ─── Envío por la API REST ────────────────────────────────────────────────

describe("envío por la API de la GRE", () => {
  test("pide el token con el RUC pegado al usuario SOL", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const { fetchImpl, llamadas } = apiFalsa();

    await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl });

    const token = llamadas.find((l) => l.url.includes("oauth2/token"))!;
    const params = new URLSearchParams(token.cuerpo);
    assert.equal(params.get("username"), "20303051831MODDATOS");
    assert.equal(params.get("grant_type"), "password");
    assert.equal(params.get("scope"), "https://api-cpe.sunat.gob.pe");
    assert.equal(params.get("client_id"), "cliente-gre-0001");
    assert.ok(token.url.includes("/clientessol/cliente-gre-0001/oauth2/token/"));
  });

  test("envía el ZIP en base64 con su hash y guarda el ticket", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const { fetchImpl, llamadas } = apiFalsa({ ticket: "TICKET-1" });

    const r = await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl });
    assert.equal(r.ticket, "TICKET-1");

    const envio = llamadas.find((l) => l.metodo === "POST" && !l.url.includes("token"))!;
    assert.equal(envio.auth, "Bearer token-de-prueba");
    assert.ok(envio.url.endsWith("/gem/comprobantes/20303051831-09-T001-00000001"));

    const cuerpo = JSON.parse(envio.cuerpo) as {
      archivo: { nomArchivo: string; arcGreZip: string; hashZip: string };
    };
    assert.equal(cuerpo.archivo.nomArchivo, "20303051831-09-T001-00000001.zip");
    assert.ok(cuerpo.archivo.arcGreZip.length > 100, "el ZIP viaja en base64");
    assert.match(cuerpo.archivo.hashZip, /^[0-9a-f]{64}$/, "el hash es SHA-256 en hexadecimal");

    const { cabecera } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.estado, "enviada");
    assert.equal(cabecera.ticket, "TICKET-1");
    assert.ok(verificarFirma(cabecera.xmlFirmado!), "la guía firmada no verifica");
  });

  test("sin credenciales de la GRE no se envía, y lo dice", async () => {
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const { fetchImpl } = apiFalsa();
    await assert.rejects(
      () => enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl }),
      /credenciales de la API de guías/,
    );
  });

  test("«en proceso» no mueve el estado", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl: apiFalsa().fetchImpl });

    const r = await recogerTicketGuia(app, ctx(), g.guiaId, KEK, {
      fetchImpl: apiFalsa({ estado: { codRespuesta: "98" } }).fetchImpl,
    });
    assert.equal(r.enProceso, true);
    const { cabecera } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.estado, "enviada");
  });

  test("aceptada, guarda el CDR", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl: apiFalsa().fetchImpl });

    const r = await recogerTicketGuia(app, ctx(), g.guiaId, KEK, {
      fetchImpl: apiFalsa({
        estado: {
          codRespuesta: "0",
          indCdrGenerado: "1",
          arcCdr: Buffer.from("cdr-falso").toString("base64"),
        },
      }).fetchImpl,
    });
    assert.equal(r.estado, "aceptada");

    const { cabecera } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.estado, "aceptada");
    assert.ok(cabecera.cdrBase64, "el CDR es la constancia; hay que conservarlo");
  });

  test("rechazada, guarda el número y el detalle del error", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl: apiFalsa().fetchImpl });

    await recogerTicketGuia(app, ctx(), g.guiaId, KEK, {
      fetchImpl: apiFalsa({
        estado: {
          codRespuesta: "99",
          indCdrGenerado: "0",
          error: { numError: "3105", desError: "El ubigeo del punto de llegada no existe" },
        },
      }).fetchImpl,
    });

    const { cabecera } = await con((db) => cargarGuia(db, g.guiaId));
    assert.equal(cabecera.estado, "rechazada");
    assert.equal(cabecera.codigoSunat, "3105");
    assert.match(cabecera.mensajeSunat!, /ubigeo/);
  });

  test("reenviar devuelve el ticket que ya tenía", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, {
      fetchImpl: apiFalsa({ ticket: "YA-ENVIADO" }).fetchImpl,
    });

    const explota = (async () => {
      throw new Error("no debió reenviarse");
    }) as unknown as typeof fetch;
    const r = await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl: explota });
    assert.equal(r.ticket, "YA-ENVIADO");
  });

  test("no se recoge el ticket de una guía que no se envió", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    await assert.rejects(
      () => recogerTicketGuia(app, ctx(), g.guiaId, KEK, { fetchImpl: apiFalsa().fetchImpl }),
      /todavía no se ha enviado/,
    );
  });

  test("un error de la API se propaga con su mensaje", async () => {
    await configurarGre();
    const g = await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ cod: "1033", msg: "La guía ya fue registrada" }),
        { status: 422 },
      );
    }) as unknown as typeof fetch;

    const r = await enviarGuiaASunat(app, ctx(), g.guiaId, KEK, { fetchImpl });
    assert.equal(r.estado, "rechazada");
    assert.match(r.mensaje!, /ya fue registrada/);
  });
});

// ─── Aislamiento ──────────────────────────────────────────────────────────

describe("aislamiento", () => {
  test("una empresa no ve las guías de otra", async () => {
    await con((db) => emitirGuia(db, empresaId, usuarioId, guiaBase()));
    const otra = await crearEmpresa(
      URL,
      { ruc: "20522633721", razonSocial: "OTRA EMPRESA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-2" },
    );
    const lista = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listarGuias(db),
    );
    assert.equal(lista.length, 0);
  });
});
