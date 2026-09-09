/**
 * Pruebas del servicio de autenticación contra Postgres real.
 *
 *   createdb roulterp_test
 *   DATABASE_URL=postgres://localhost/roulterp_test npm test -w @roulterp/servicios
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, migrar, type Conexion } from "@roulterp/db";
import { totp } from "@roulterp/core/auth";
import {
  login, verificarMfa, cargarSesion, cerrarSesion, cerrarTodasLasSesiones,
  seleccionarEmpresa, cambiarPassword, solicitarReseteo, resetearPassword,
  invitarUsuario, aceptarInvitacion, revocarAcceso,
  prepararMfa, activarMfa, desactivarMfa,
  CredencialesInvalidas, DemasiadosIntentos, TokenInvalido,
  crearEmpresa, rucValido, type Entorno,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(11);
const PASS = "contraseña-de-prueba-1";

let raw: postgres.Sql;
let auth: Conexion;
let env: Entorno;
let reloj = new Date("2026-09-09T12:00:00Z");

let empresaA = "";
let empresaB = "";
let adminA = "";

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  auth = conectar({ url: URL, rol: "auth", max: 4 });
  env = { auth, kek: KEK, kekId: "test", ahora: () => reloj };
});

after(async () => {
  await raw?.end();
  await auth?.cliente.end();
});

beforeEach(async () => {
  reloj = new Date("2026-09-09T12:00:00Z");
  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  await raw`TRUNCATE TABLE intentos_login`;

  const a = await crearEmpresa(
    URL,
    { ruc: "20303051831", razonSocial: "SERVIDIMAR" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: PASS },
  );
  const b = await crearEmpresa(
    URL,
    { ruc: "20100066603", razonSocial: "OTRA EMPRESA" },
    { email: "beto@otra.pe", nombre: "Beto", password: PASS },
  );
  empresaA = a.empresaId;
  empresaB = b.empresaId;
  adminA = a.usuarioId;
});

const avanzar = (ms: number) => {
  reloj = new Date(reloj.getTime() + ms);
};

// ─── Alta de empresas ─────────────────────────────────────────────────────

describe("alta de empresas", () => {
  test("valida el dígito verificador del RUC", () => {
    assert.equal(rucValido("20303051831"), true);
    assert.equal(rucValido("20100066603"), true);
    assert.equal(rucValido("20303051832"), false, "dígito verificador incorrecto");
    assert.equal(rucValido("12345678901"), false, "prefijo no válido");
    assert.equal(rucValido("2030305183"), false, "muy corto");
    assert.equal(rucValido(""), false);
  });

  test("una empresa nueva nace con su plan de cuentas y sus catálogos", async () => {
    const [{ count: cuentas }] = await raw<{ count: string }[]>`
      SELECT count(*) FROM plan_cuentas WHERE empresa_id = ${empresaA}`;
    assert.ok(Number(cuentas) > 50, `esperaba un plan de cuentas sembrado, hubo ${cuentas}`);

    const [{ count: unidades }] = await raw<{ count: string }[]>`
      SELECT count(*) FROM unidades_medida WHERE empresa_id = ${empresaA}`;
    assert.ok(Number(unidades) > 10);

    const [{ count: reglas }] = await raw<{ count: string }[]>`
      SELECT count(*) FROM reglas_detraccion WHERE empresa_id = ${empresaA}`;
    assert.ok(Number(reglas) > 15);

    const [{ count: almacenes }] = await raw<{ count: string }[]>`
      SELECT count(*) FROM almacenes WHERE empresa_id = ${empresaA}`;
    assert.equal(Number(almacenes), 2, "almacén principal y tránsito");
  });

  test("las tasas de detracción se guardan con su precisión, como texto", async () => {
    const [fila] = await raw<{ tasa: string }[]>`
      SELECT tasa FROM reglas_detraccion WHERE empresa_id = ${empresaA} AND codigo = '035'`;
    // 1.5 %. Si el driver lo convirtiera a number, esto dejaría de ser exacto.
    assert.equal(typeof fila!.tasa, "string", "los numeric deben llegar como texto");
    assert.equal(Number(fila!.tasa), 0.015);
  });

  test("cada empresa tiene sus propios roles del sistema", async () => {
    const filas = await raw<{ codigo: string }[]>`
      SELECT codigo FROM roles WHERE empresa_id = ${empresaA} ORDER BY codigo`;
    assert.deepEqual(
      filas.map((f) => f.codigo),
      ["admin", "consulta", "contador", "logistica", "ventas"],
    );
  });

  test("un RUC inválido se rechaza antes de crear nada", async () => {
    await assert.rejects(
      () =>
        crearEmpresa(URL, { ruc: "20303051832", razonSocial: "X" }, {
          email: "x@x.pe", nombre: "X", password: PASS,
        }),
      /RUC .* no es válido/,
    );
  });

  test("la misma persona puede administrar dos empresas con una sola cuenta", async () => {
    const c = await crearEmpresa(
      URL,
      { ruc: "20522633721", razonSocial: "TERCERA" },
      { email: "ana@servidimar.pe", nombre: "Ana", password: PASS },
    );
    assert.equal(c.usuarioId, adminA, "no debe duplicarse el usuario");

    const sesion = await entrar("ana@servidimar.pe");
    const activa = await cargarSesion(env, sesion.token);
    assert.equal(activa!.actor.membresias.size, 2);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────

async function entrar(email = "ana@servidimar.pe", password = PASS) {
  const r = await login(env, { email, password, ip: "10.0.0.1" });
  assert.equal(r.estado, "ok");
  return r as Extract<typeof r, { estado: "ok" }>;
}

describe("login", () => {
  test("credenciales correctas abren sesión", async () => {
    const r = await entrar();
    assert.ok(r.token.length >= 43);
    assert.equal(r.usuarioId, adminA);
  });

  test("el correo no distingue mayúsculas ni espacios", async () => {
    const r = await login(env, { email: "  ANA@Servidimar.PE  ", password: PASS });
    assert.equal(r.estado, "ok");
  });

  test("una contraseña equivocada y un correo inexistente dan el mismo error", async () => {
    const a = await login(env, { email: "ana@servidimar.pe", password: "mala-mala-mala" })
      .then(() => null, (e) => e);
    const b = await login(env, { email: "nadie@ninguna.pe", password: "mala-mala-mala" })
      .then(() => null, (e) => e);
    assert.ok(a instanceof CredencialesInvalidas);
    assert.ok(b instanceof CredencialesInvalidas);
    assert.equal(a.message, b.message, "el mensaje no debe revelar si la cuenta existe");
  });

  test("un usuario desactivado no entra, aunque acierte la contraseña", async () => {
    await raw`UPDATE usuarios SET activo = false WHERE id = ${adminA}`;
    await assert.rejects(() => entrar(), CredencialesInvalidas);
  });

  test("la sesión selecciona sola la empresa cuando sólo hay una", async () => {
    const r = await entrar();
    const activa = await cargarSesion(env, r.token);
    assert.equal(activa!.empresaId, empresaA);
  });

  test("con dos empresas no se elige ninguna: la escoge el usuario", async () => {
    await crearEmpresa(
      URL,
      { ruc: "20522633721", razonSocial: "TERCERA" },
      { email: "ana@servidimar.pe", nombre: "Ana", password: PASS },
    );
    const r = await entrar();
    const activa = await cargarSesion(env, r.token);
    assert.equal(activa!.empresaId, null);
  });

  test("el token se guarda hasheado, nunca en claro", async () => {
    const r = await entrar();
    const [fila] = await raw<{ token_hash: string }[]>`SELECT token_hash FROM sesiones`;
    assert.notEqual(fila!.token_hash, r.token);
    assert.match(fila!.token_hash, /^[0-9a-f]{64}$/);
  });
});

describe("freno de fuerza bruta", () => {
  test("tras varios fallos hay que esperar, y la espera crece", async () => {
    for (let i = 0; i < 6; i++) {
      await login(env, { email: "ana@servidimar.pe", password: "mala-mala-mala", ip: "10.0.0.9" })
        .catch(() => {});
    }
    await assert.rejects(
      () => login(env, { email: "ana@servidimar.pe", password: PASS, ip: "10.0.0.9" }),
      DemasiadosIntentos,
      "ni siquiera con la contraseña correcta mientras dure el freno",
    );
  });

  test("pasada la espera se vuelve a permitir", async () => {
    for (let i = 0; i < 6; i++) {
      await login(env, { email: "ana@servidimar.pe", password: "mala", ip: "10.0.0.9" })
        .catch(() => {});
    }
    avanzar(5000);
    const r = await login(env, { email: "ana@servidimar.pe", password: PASS, ip: "10.0.0.9" });
    assert.equal(r.estado, "ok");
  });

  test("un login exitoso limpia el contador", async () => {
    for (let i = 0; i < 3; i++) {
      await login(env, { email: "ana@servidimar.pe", password: "mala", ip: "10.0.0.8" })
        .catch(() => {});
    }
    await login(env, { email: "ana@servidimar.pe", password: PASS, ip: "10.0.0.8" });
    const filas = await raw`SELECT * FROM intentos_login WHERE clave = 'ip:10.0.0.8'`;
    assert.equal(filas.length, 0);
  });

  test("el freno cuenta también por IP: otro correo desde la misma IP no la esquiva", async () => {
    for (let i = 0; i < 6; i++) {
      await login(env, { email: `nadie${i}@x.pe`, password: "mala", ip: "10.0.0.7" }).catch(() => {});
    }
    await assert.rejects(
      () => login(env, { email: "ana@servidimar.pe", password: PASS, ip: "10.0.0.7" }),
      DemasiadosIntentos,
    );
  });
});

// ─── Sesiones ─────────────────────────────────────────────────────────────

describe("sesiones", () => {
  test("cargarSesion devuelve el actor con sus permisos por empresa", async () => {
    const r = await entrar();
    const s = await cargarSesion(env, r.token);
    assert.equal(s!.email, "ana@servidimar.pe");
    assert.equal(s!.actor.membresias.get(empresaA)!.permisos.has("contabilidad:crear"), true);
    assert.equal(s!.actor.membresias.has(empresaB), false);
  });

  test("un token inventado no abre nada", async () => {
    assert.equal(await cargarSesion(env, "token-inventado"), null);
    assert.equal(await cargarSesion(env, ""), null);
  });

  test("cerrar sesión la invalida en el acto", async () => {
    const r = await entrar();
    await cerrarSesion(env, r.token);
    assert.equal(await cargarSesion(env, r.token), null);
  });

  test("la sesión muere por inactividad", async () => {
    const r = await entrar();
    avanzar(3 * 60 * 60 * 1000); // más de las 2 h de inactividad
    assert.equal(await cargarSesion(env, r.token), null);
  });

  test("usarla la mantiene viva", async () => {
    const r = await entrar();
    for (let i = 0; i < 4; i++) {
      avanzar(60 * 60 * 1000);
      assert.ok(await cargarSesion(env, r.token), `debía seguir viva en la hora ${i + 1}`);
    }
  });

  test("el tope absoluto la cierra aunque haya actividad continua", async () => {
    const r = await entrar();
    for (let i = 0; i < 7 * 24; i++) {
      avanzar(60 * 60 * 1000);
      await cargarSesion(env, r.token);
    }
    avanzar(60 * 60 * 1000);
    assert.equal(await cargarSesion(env, r.token), null);
  });

  test("cambiar de empresa exige pertenecer a ella", async () => {
    const r = await entrar();
    const s = await cargarSesion(env, r.token);
    assert.equal(await seleccionarEmpresa(env, s!.sesionId, empresaB), false);
    assert.equal(await seleccionarEmpresa(env, s!.sesionId, empresaA), true);
  });

  test("revocar la membresía expulsa de la empresa sin esperar al próximo login", async () => {
    const r = await entrar();
    assert.equal((await cargarSesion(env, r.token))!.empresaId, empresaA);
    await revocarAcceso(env, adminA, empresaA);
    assert.equal((await cargarSesion(env, r.token))!.empresaId, null);
  });

  test("cerrar todas las sesiones cierra las de todos los dispositivos", async () => {
    const uno = await entrar();
    const dos = await entrar();
    await cerrarTodasLasSesiones(env, adminA);
    assert.equal(await cargarSesion(env, uno.token), null);
    assert.equal(await cargarSesion(env, dos.token), null);
  });
});

// ─── Contraseñas ──────────────────────────────────────────────────────────

describe("contraseñas", () => {
  test("cambiarla exige la actual y cierra las demás sesiones", async () => {
    const vieja = await entrar();
    await cambiarPassword(env, adminA, PASS, "una-contraseña-nueva-1");

    assert.equal(await cargarSesion(env, vieja.token), null, "las sesiones abiertas deben caer");
    await assert.rejects(() => entrar(), CredencialesInvalidas);
    const r = await login(env, { email: "ana@servidimar.pe", password: "una-contraseña-nueva-1" });
    assert.equal(r.estado, "ok");
  });

  test("no se cambia sin acertar la actual", async () => {
    await assert.rejects(
      () => cambiarPassword(env, adminA, "no-es-la-actual", "otra-contraseña-larga"),
      CredencialesInvalidas,
    );
  });

  test("una contraseña corta se rechaza", async () => {
    await assert.rejects(() => cambiarPassword(env, adminA, PASS, "corta"));
  });

  test("el reseteo emite un token de un solo uso", async () => {
    const token = await solicitarReseteo(env, "ana@servidimar.pe");
    assert.ok(token);
    await resetearPassword(env, token!, "reseteada-con-token-1");
    const r = await login(env, { email: "ana@servidimar.pe", password: "reseteada-con-token-1" });
    assert.equal(r.estado, "ok");

    await assert.rejects(
      () => resetearPassword(env, token!, "otra-vez-no-1234"),
      TokenInvalido,
      "un token de reseteo no se canjea dos veces",
    );
  });

  test("solicitar el reseteo de un correo inexistente devuelve null, sin delatar nada", async () => {
    assert.equal(await solicitarReseteo(env, "nadie@ninguna.pe"), null);
  });

  test("un token de reseteo vencido no sirve", async () => {
    const token = await solicitarReseteo(env, "ana@servidimar.pe");
    avanzar(2 * 60 * 60 * 1000);
    await assert.rejects(() => resetearPassword(env, token!, "tarde-tarde-1234"), TokenInvalido);
  });

  test("un token de reseteo no vale como invitación", async () => {
    const token = await solicitarReseteo(env, "ana@servidimar.pe");
    await assert.rejects(() => aceptarInvitacion(env, token!, "no-cuela-12345"), TokenInvalido);
  });
});

// ─── Invitaciones ─────────────────────────────────────────────────────────

describe("invitaciones", () => {
  test("invitar crea una cuenta inactiva que se activa al aceptar", async () => {
    const { token, usuarioId } = await invitarUsuario(env, {
      email: "carla@servidimar.pe", nombre: "Carla",
      empresaId: empresaA, rolCodigo: "logistica",
    });
    assert.ok(token);

    await assert.rejects(
      () => login(env, { email: "carla@servidimar.pe", password: PASS }),
      CredencialesInvalidas,
      "no debe poder entrar antes de aceptar",
    );

    await aceptarInvitacion(env, token!, "mi-propia-clave-1");
    const r = await login(env, { email: "carla@servidimar.pe", password: "mi-propia-clave-1" });
    assert.equal(r.estado, "ok");

    const s = await cargarSesion(env, (r as { token: string }).token);
    assert.equal(s!.usuarioId, usuarioId);
    assert.equal(s!.actor.membresias.get(empresaA)!.permisos.has("importaciones:crear"), true);
    assert.equal(s!.actor.membresias.get(empresaA)!.permisos.has("contabilidad:crear"), false);
  });

  test("invitar a alguien que ya tiene cuenta sólo añade la membresía", async () => {
    const { token } = await invitarUsuario(env, {
      email: "beto@otra.pe", nombre: "Beto", empresaId: empresaA, rolCodigo: "consulta",
    });
    assert.equal(token, null, "no hace falta un enlace: ya tiene contraseña");

    const r = await login(env, { email: "beto@otra.pe", password: PASS });
    const s = await cargarSesion(env, (r as { token: string }).token);
    assert.equal(s!.actor.membresias.size, 2);
    assert.equal(s!.actor.membresias.get(empresaA)!.permisos.has("ventas:crear"), false);
    assert.equal(s!.actor.membresias.get(empresaB)!.permisos.has("ventas:crear"), true);
  });

  test("invitar con un rol que no existe falla", async () => {
    await assert.rejects(
      () =>
        invitarUsuario(env, {
          email: "x@x.pe", nombre: "X", empresaId: empresaA, rolCodigo: "inventado",
        }),
      /no existe en esta empresa/,
    );
  });

  test("una invitación no se acepta dos veces", async () => {
    const { token } = await invitarUsuario(env, {
      email: "dora@servidimar.pe", nombre: "Dora", empresaId: empresaA, rolCodigo: "ventas",
    });
    await aceptarInvitacion(env, token!, "clave-de-dora-1");
    await assert.rejects(() => aceptarInvitacion(env, token!, "otra-clave-12345"), TokenInvalido);
  });

  test("una invitación vencida no sirve", async () => {
    const { token } = await invitarUsuario(env, {
      email: "eva@servidimar.pe", nombre: "Eva", empresaId: empresaA, rolCodigo: "ventas",
    });
    avanzar(8 * 24 * 60 * 60 * 1000);
    await assert.rejects(() => aceptarInvitacion(env, token!, "clave-de-eva-12"), TokenInvalido);
  });
});

// ─── Segundo factor ───────────────────────────────────────────────────────

describe("segundo factor", () => {
  async function conMfa() {
    const { secreto } = await prepararMfa(env, adminA, "ana@servidimar.pe");
    const codigo = totp(secreto, Math.floor(reloj.getTime() / 1000));
    const respaldos = await activarMfa(env, adminA, codigo);
    return { secreto, respaldos };
  }

  test("preparar no activa: hay que demostrar que la app ya tiene el secreto", async () => {
    await prepararMfa(env, adminA, "ana@servidimar.pe");
    const [u] = await raw<{ mfa_activo: boolean }[]>`
      SELECT mfa_activo FROM usuarios WHERE id = ${adminA}`;
    assert.equal(u!.mfa_activo, false, "activarlo antes dejaría al usuario fuera de su cuenta");
  });

  test("activar con un código equivocado falla", async () => {
    await prepararMfa(env, adminA, "ana@servidimar.pe");
    await assert.rejects(() => activarMfa(env, adminA, "000000"), CredencialesInvalidas);
  });

  test("con MFA activo el login pide el segundo paso", async () => {
    const { secreto } = await conMfa();
    const r = await login(env, { email: "ana@servidimar.pe", password: PASS });
    assert.equal(r.estado, "mfa_requerido");

    avanzar(30_000); // paso siguiente, para no chocar con la protección de replay
    const codigo = totp(secreto, Math.floor(reloj.getTime() / 1000));
    const ok = await verificarMfa(env, {
      reto: (r as { reto: string }).reto,
      codigo,
    });
    assert.equal(ok.estado, "ok");
  });

  test("el secreto TOTP se guarda cifrado, nunca en claro", async () => {
    const { secreto } = await conMfa();
    const [u] = await raw<{ mfa_secreto: unknown }[]>`
      SELECT mfa_secreto FROM usuarios WHERE id = ${adminA}`;
    assert.ok(!JSON.stringify(u!.mfa_secreto).includes(secreto));
  });

  test("un código ya usado no vale una segunda vez dentro de su ventana", async () => {
    const { secreto } = await conMfa();
    avanzar(30_000);
    const codigo = totp(secreto, Math.floor(reloj.getTime() / 1000));

    const primero = await login(env, { email: "ana@servidimar.pe", password: PASS });
    await verificarMfa(env, { reto: (primero as { reto: string }).reto, codigo });

    const segundo = await login(env, { email: "ana@servidimar.pe", password: PASS });
    await assert.rejects(
      () => verificarMfa(env, { reto: (segundo as { reto: string }).reto, codigo }),
      CredencialesInvalidas,
      "TOTP por sí solo no impide el replay; el paso consumido sí",
    );
  });

  test("un reto de MFA vencido obliga a empezar de nuevo", async () => {
    const { secreto } = await conMfa();
    const r = await login(env, { email: "ana@servidimar.pe", password: PASS });
    avanzar(10 * 60 * 1000);
    await assert.rejects(
      () =>
        verificarMfa(env, {
          reto: (r as { reto: string }).reto,
          codigo: totp(secreto, Math.floor(reloj.getTime() / 1000)),
        }),
      TokenInvalido,
    );
  });

  test("un código de respaldo entra una vez y luego se quema", async () => {
    const { respaldos } = await conMfa();
    const codigo = respaldos[0]!;

    const uno = await login(env, { email: "ana@servidimar.pe", password: PASS });
    const ok = await verificarMfa(env, { reto: (uno as { reto: string }).reto, codigo });
    assert.equal(ok.estado, "ok");

    const dos = await login(env, { email: "ana@servidimar.pe", password: PASS });
    await assert.rejects(
      () => verificarMfa(env, { reto: (dos as { reto: string }).reto, codigo }),
      CredencialesInvalidas,
    );
  });

  test("los códigos de respaldo se guardan hasheados", async () => {
    const { respaldos } = await conMfa();
    const [u] = await raw<{ mfa_respaldos: string[] }[]>`
      SELECT mfa_respaldos FROM usuarios WHERE id = ${adminA}`;
    assert.equal(u!.mfa_respaldos.length, 10);
    assert.ok(!u!.mfa_respaldos.includes(respaldos[0]!));
  });

  test("desactivar el MFA exige la contraseña, no basta la sesión", async () => {
    await conMfa();
    await assert.rejects(
      () => desactivarMfa(env, adminA, "no-es-la-contraseña"),
      CredencialesInvalidas,
      "con una sesión robada se dejaría la cuenta abierta para siempre",
    );
    await desactivarMfa(env, adminA, PASS);
    const r = await login(env, { email: "ana@servidimar.pe", password: PASS });
    assert.equal(r.estado, "ok");
  });
});
