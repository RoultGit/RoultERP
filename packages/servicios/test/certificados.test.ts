/**
 * Custodia del certificado digital y de las credenciales SOL.
 *
 * Lo que se comprueba aquí es que ningún secreto llegue a la base en claro, y
 * que un certificado que no sirve se rechace al cargarlo y no el día que hay
 * que facturar.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { certificadoDePrueba, pfxDePrueba, CertificadoInvalido } from "@roulterp/core/cpe";
import {
  crearEmpresa, cargarCertificado, certificadoActivo, verificarCertificado,
  guardarCredencialesSol, credencialesActuales, listaParaEmitir,
  ConfiguracionInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(31);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";

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
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

const CLAVE_PFX = "clave-del-certificado";
const certPropio = () => certificadoDePrueba("20303051831");
const pfxDe = (cert: ReturnType<typeof certificadoDePrueba>) => pfxDePrueba(cert, CLAVE_PFX);

describe("carga del certificado", () => {
  test("se guarda y devuelve su RUC y su vencimiento", async () => {
    const cert = certPropio();
    const r = await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    assert.equal(r.ruc, "20303051831");
    assert.equal(r.activo, true);
    assert.ok(r.diasParaVencer! > 300, "el de prueba dura un año");
  });

  test("ni el PFX ni su contraseña quedan en claro en la base", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    const [fila] = await raw<{ pfx_cifrado: unknown; password_cifrado: unknown }[]>`
      SELECT pfx_cifrado, password_cifrado FROM certificados_digitales`;
    const texto = JSON.stringify(fila);
    assert.ok(!texto.includes(CLAVE_PFX), "la contraseña no puede estar en claro");
    assert.ok(!texto.includes("PRIVATE KEY"), "la clave privada tampoco");
  });

  test("con la contraseña equivocada se rechaza al cargarlo", async () => {
    const cert = certPropio();
    await assert.rejects(
      () =>
        con((db) =>
          cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), "clave-mala", KEK, "test"),
        ),
      CertificadoInvalido,
    );
    assert.equal(await con((db) => certificadoActivo(db)), null, "no se guardó nada");
  });

  test("un certificado de otro RUC se rechaza y lo dice", async () => {
    const ajeno = certificadoDePrueba("20100066603");
    await assert.rejects(
      () =>
        con((db) =>
          cargarCertificado(db, empresaId, usuarioId, pfxDe(ajeno), CLAVE_PFX, KEK, "test"),
        ),
      (e: unknown) =>
        e instanceof ConfiguracionInvalida &&
        /pertenece al RUC 20100066603 y esta empresa es 20303051831/.test(e.message),
    );
  });

  test("un archivo vacío o que no es un PFX se rechaza", async () => {
    await assert.rejects(
      () => con((db) => cargarCertificado(db, empresaId, usuarioId, new Uint8Array(0), "x", KEK, "test")),
      /está vacío/,
    );
    await assert.rejects(
      () =>
        con((db) =>
          cargarCertificado(db, empresaId, usuarioId, new Uint8Array([1, 2, 3]), "x", KEK, "test"),
        ),
      CertificadoInvalido,
    );
  });

  test("cargar uno nuevo desactiva el anterior pero no lo borra", async () => {
    const a = certPropio();
    const b = certPropio();
    const primero = await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(a), CLAVE_PFX, KEK, "test"),
    );
    const segundo = await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(b), CLAVE_PFX, KEK, "test"),
    );

    assert.notEqual(primero.id, segundo.id);
    assert.equal((await con((db) => certificadoActivo(db)))!.id, segundo.id);

    const [{ count }] = await raw<{ count: string }[]>`
      SELECT count(*) FROM certificados_digitales`;
    assert.equal(
      Number(count),
      2,
      "el anterior se conserva: con él se firmaron comprobantes que hay que poder explicar",
    );
  });

  test("el certificado guardado se puede volver a abrir con la clave maestra", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    assert.deepEqual(await con((db) => verificarCertificado(db, empresaId, KEK)), { ok: true });
  });

  test("con otra clave maestra deja de poder abrirse, y se avisa", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    const otra = new Uint8Array(32).fill(99);
    const v = await con((db) => verificarCertificado(db, empresaId, otra));
    assert.equal(v.ok, false);
    assert.match(v.motivo!, /clave maestra/);
  });

  test("sin certificado cargado, verificar lo dice en vez de reventar", async () => {
    const v = await con((db) => verificarCertificado(db, empresaId, KEK));
    assert.deepEqual(v, { ok: false, motivo: "no hay certificado cargado" });
  });
});

describe("credenciales SOL", () => {
  test("se guardan con la clave cifrada y el usuario en claro", async () => {
    const r = await con((db) =>
      guardarCredencialesSol(
        db, empresaId, usuarioId,
        { usuarioSol: "moddatos", claveSol: "clave-secreta-sol", entorno: "beta" },
        KEK, "test",
      ),
    );
    assert.equal(r.usuarioSol, "MODDATOS", "se normaliza a mayúsculas");

    const [fila] = await raw<{ usuario_sol: string; clave_cifrada: unknown }[]>`
      SELECT usuario_sol, clave_cifrada FROM credenciales_sunat`;
    assert.equal(fila!.usuario_sol, "MODDATOS");
    assert.ok(
      !JSON.stringify(fila!.clave_cifrada).includes("clave-secreta-sol"),
      "la clave SOL no puede estar en claro",
    );
  });

  test("guardar otra vez reemplaza, no duplica", async () => {
    for (const entorno of ["beta", "produccion"] as const) {
      await con((db) =>
        guardarCredencialesSol(
          db, empresaId, usuarioId,
          { usuarioSol: "MODDATOS", claveSol: "x1234567", entorno },
          KEK, "test",
        ),
      );
    }
    const [{ count }] = await raw<{ count: string }[]>`SELECT count(*) FROM credenciales_sunat`;
    assert.equal(Number(count), 1);
    assert.equal((await con((db) => credencialesActuales(db)))!.entorno, "produccion");
  });

  test("un usuario SOL con el RUC delante se rechaza", async () => {
    // Es el error clásico: el usuario del servicio es RUC + usuario, pero aquí
    // se guarda sólo el usuario secundario; el sistema concatena al enviar.
    await assert.rejects(
      () =>
        con((db) =>
          guardarCredencialesSol(
            db, empresaId, usuarioId,
            { usuarioSol: "20303051831 MODDATOS", claveSol: "x", entorno: "beta" },
            KEK, "test",
          ),
        ),
      /sin el RUC delante/,
    );
  });

  test("una clave vacía se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarCredencialesSol(
            db, empresaId, usuarioId,
            { usuarioSol: "MODDATOS", claveSol: "", entorno: "beta" },
            KEK, "test",
          ),
        ),
      /clave SOL es obligatoria/,
    );
  });
});

describe("estado de preparación para emitir", () => {
  test("una empresa recién creada enumera todo lo que le falta", async () => {
    const r = await con((db) => listaParaEmitir(db, empresaId, KEK));
    assert.equal(r.puedeEmitir, false);
    assert.equal(r.puedeEnviar, false);
    assert.deepEqual(r.faltantesEmision.length, 1, "sólo la serie impide emitir");
    assert.ok(r.faltantesEmision.some((f) => /serie de facturación/.test(f)));
    assert.equal(r.faltantesEnvio.length, 2, "certificado y credenciales impiden enviar");
    assert.ok(r.faltantesEnvio.some((f) => /certificado digital/.test(f)));
    assert.ok(r.faltantesEnvio.some((f) => /clave SOL/.test(f)));
  });

  test("con serie pero sin certificado se puede emitir, no enviar", async () => {
    // Es el estado de toda empresa recién dada de alta mientras tramita su
    // certificado, y tiene que poder facturar: el comprobante se numera, mueve
    // el almacén y se contabiliza; el envío espera.
    await raw`
      INSERT INTO series_documento (empresa_id, tipo_documento, serie)
      VALUES (${empresaId}, '01', 'F001')`;

    const r = await con((db) => listaParaEmitir(db, empresaId, KEK));
    assert.equal(r.puedeEmitir, true, JSON.stringify(r.faltantesEmision));
    assert.equal(r.puedeEnviar, false);
    assert.ok(r.faltantesEnvio.some((f) => /certificado digital/.test(f)));
  });

  test("con todo configurado queda lista, y avisa de que está en pruebas", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    await con((db) =>
      guardarCredencialesSol(
        db, empresaId, usuarioId,
        { usuarioSol: "MODDATOS", claveSol: "MODDATOS", entorno: "beta" },
        KEK, "test",
      ),
    );
    await raw`
      INSERT INTO series_documento (empresa_id, tipo_documento, serie)
      VALUES (${empresaId}, '01', 'F001')`;

    const r = await con((db) => listaParaEmitir(db, empresaId, KEK));
    assert.equal(r.puedeEmitir, true, JSON.stringify(r.faltantesEmision));
    assert.equal(r.puedeEnviar, true, JSON.stringify(r.faltantesEnvio));
    assert.ok(r.avisos.some((a) => /entorno de pruebas/.test(a)));
  });

  test("un certificado que no se puede descifrar aparece como faltante, no como listo", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );
    const r = await con((db) => listaParaEmitir(db, empresaId, new Uint8Array(32).fill(7)));
    assert.equal(r.puedeEnviar, false);
    assert.ok(r.faltantesEnvio.some((f) => /no se puede usar/.test(f)));
  });
});

describe("aislamiento", () => {
  test("el certificado de una empresa no se ve desde otra", async () => {
    const cert = certPropio();
    await con((db) =>
      cargarCertificado(db, empresaId, usuarioId, pfxDe(cert), CLAVE_PFX, KEK, "test"),
    );

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => certificadoActivo(db),
    );
    assert.equal(desdeOtra, null);
  });
});
