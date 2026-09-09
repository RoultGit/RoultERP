import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, needsRehash, assertPasswordUsable, DEFAULT_PARAMS,
} from "../src/auth/password.ts";
import {
  totp, verifyTotp, base32Encode, base32Decode, generateSecret, otpauthUri,
  generateRecoveryCodes,
} from "../src/auth/totp.ts";
import {
  nuevoTokenSesion, hashToken, sesionVigente, renovarExpiracion,
  SESSION_IDLE_MS, SESSION_MAX_MS, type EstadoSesion,
} from "../src/auth/session.ts";
import { sellar, abrir, cifrar, descifrar } from "../src/auth/secretbox.ts";
import {
  construirActor, puede, exigir, SinPermiso, ROLES_BASE, empresasVisibles,
} from "../src/auth/rbac.ts";
import {
  evaluar, evaluarAmbos, registrarFallo, limpiar, esperaTras, UMBRAL, VENTANA_MS,
} from "../src/auth/throttle.ts";

// ─── Contraseñas ──────────────────────────────────────────────────────────

// Parámetros bajos: probar la lógica, no medir Argon2. La correctitud del KDF
// es responsabilidad de @noble, que trae sus propios vectores.
const RAPIDO = { m: 256, t: 1, p: 1 };

test("una contraseña verifica contra su propio hash y no contra otro", async () => {
  const phc = await hashPassword("contraseña-larga-1", RAPIDO);
  assert.equal(await verifyPassword("contraseña-larga-1", phc), true);
  assert.equal(await verifyPassword("contraseña-larga-2", phc), false);
});

test("el mismo texto produce hashes distintos (la sal es aleatoria)", async () => {
  const a = await hashPassword("contraseña-larga-1", RAPIDO);
  const b = await hashPassword("contraseña-larga-1", RAPIDO);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("contraseña-larga-1", b), true);
});

test("el hash sale en formato PHC con sus parámetros", async () => {
  const phc = await hashPassword("contraseña-larga-1", RAPIDO);
  assert.match(phc, /^\$argon2id\$v=19\$m=256,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
});

test("un hash corrupto devuelve false en vez de reventar", async () => {
  for (const basura of ["", "no-es-un-hash", "$argon2id$v=19$m=x$aa$bb", "$2b$10$abc"]) {
    assert.equal(await verifyPassword("contraseña-larga-1", basura), false);
  }
});

test("se rechazan contraseñas cortas y absurdamente largas", () => {
  assert.throws(() => assertPasswordUsable("corta"), RangeError);
  assert.throws(() => assertPasswordUsable("x".repeat(1025)), RangeError);
  assert.doesNotThrow(() => assertPasswordUsable("doce-caracter"));
});

test("needsRehash detecta hashes por debajo del costo actual", async () => {
  const viejo = await hashPassword("contraseña-larga-1", RAPIDO);
  assert.equal(needsRehash(viejo, DEFAULT_PARAMS), true);
  assert.equal(needsRehash(viejo, RAPIDO), false);
  assert.equal(needsRehash("basura", DEFAULT_PARAMS), true);
});

// ─── TOTP ─────────────────────────────────────────────────────────────────

// RFC 6238, apéndice B. Semilla ASCII "12345678901234567890" en base32.
const SEMILLA_RFC = base32Encode(new TextEncoder().encode("12345678901234567890"));

test("TOTP coincide con los vectores del RFC 6238", () => {
  const vectores: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [t, esperado] of vectores) {
    assert.equal(totp(SEMILLA_RFC, t, { digits: 8, algorithm: "sha1" }), esperado, `t=${t}`);
  }
});

test("base32 va y vuelve sin perder bytes", () => {
  for (const n of [0, 1, 5, 10, 20, 33]) {
    const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37) % 256));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, `n=${n}`);
  }
});

test("base32 rechaza caracteres fuera del alfabeto", () => {
  assert.throws(() => base32Decode("ABC1"), TypeError);
});

test("verifyTotp acepta el código del momento y tolera ±1 ventana", () => {
  const s = generateSecret();
  const t = 1_700_000_000;
  assert.equal(verifyTotp(s, totp(s, t), t), true);
  assert.equal(verifyTotp(s, totp(s, t - 30), t), true);
  assert.equal(verifyTotp(s, totp(s, t + 30), t), true);
  assert.equal(verifyTotp(s, totp(s, t - 120), t), false);
});

test("verifyTotp rechaza formatos inválidos sin lanzar", () => {
  const s = generateSecret();
  for (const malo of ["", "12345", "1234567", "abcdef", "12 34 56"]) {
    assert.equal(verifyTotp(s, malo, 1_700_000_000), false, malo);
  }
});

test("verifyTotp ignora espacios que pega el usuario", () => {
  const s = generateSecret();
  const t = 1_700_000_000;
  const c = totp(s, t);
  assert.equal(verifyTotp(s, ` ${c.slice(0, 3)} ${c.slice(3)} `, t), true);
});

test("el URI otpauth lleva secreto y emisor escapados", () => {
  const uri = otpauthUri({ secret: "ABCD", cuenta: "ana@ejemplo.pe", emisor: "RoultERP" });
  assert.match(uri, /^otpauth:\/\/totp\/RoultERP%3Aana%40ejemplo\.pe\?/);
  assert.match(uri, /secret=ABCD/);
  assert.match(uri, /issuer=RoultERP/);
});

test("los códigos de respaldo son únicos y con formato legible", () => {
  const cs = generateRecoveryCodes(10);
  assert.equal(new Set(cs).size, 10);
  assert.ok(cs.every((c) => /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/.test(c)));
});

// ─── Sesiones ─────────────────────────────────────────────────────────────

test("el token de sesión se guarda hasheado, nunca en claro", () => {
  const { token, hash } = nuevoTokenSesion();
  assert.notEqual(token, hash);
  assert.equal(hash, hashToken(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(token.length >= 43, "256 bits en base64url");
});

test("dos tokens seguidos no se repiten", () => {
  const vistos = new Set(Array.from({ length: 200 }, () => nuevoTokenSesion().token));
  assert.equal(vistos.size, 200);
});

const ahora = new Date("2026-09-09T12:00:00Z");
const sesionBase = (over: Partial<EstadoSesion> = {}): EstadoSesion => ({
  creadaEn: ahora,
  expiraEn: new Date(ahora.getTime() + 3_600_000),
  ultimoUsoEn: ahora,
  revocadaEn: null,
  ...over,
});

test("una sesión recién creada es válida", () => {
  assert.equal(sesionVigente(sesionBase(), ahora), true);
});

test("una sesión revocada no vale, aunque no haya expirado", () => {
  assert.equal(sesionVigente(sesionBase({ revocadaEn: ahora }), ahora), false);
});

test("una sesión expirada no vale", () => {
  const s = sesionBase({ expiraEn: new Date(ahora.getTime() - 1) });
  assert.equal(sesionVigente(s, ahora), false);
});

test("la inactividad mata la sesión antes de que expire", () => {
  const s = sesionBase({
    expiraEn: new Date(ahora.getTime() + SESSION_MAX_MS),
    ultimoUsoEn: new Date(ahora.getTime() - SESSION_IDLE_MS - 1),
  });
  assert.equal(sesionVigente(s, ahora), false);
});

test("el tope absoluto manda aunque haya actividad continua", () => {
  const creada = new Date(ahora.getTime() - SESSION_MAX_MS - 1);
  const s = sesionBase({
    creadaEn: creada,
    ultimoUsoEn: ahora,
    expiraEn: new Date(ahora.getTime() + 3_600_000),
  });
  assert.equal(sesionVigente(s, ahora), false);
});

test("renovar no sobrepasa el tope absoluto", () => {
  const creada = new Date(ahora.getTime() - SESSION_MAX_MS + 60_000);
  const s = sesionBase({ creadaEn: creada });
  const nueva = renovarExpiracion(s, ahora);
  assert.equal(nueva.getTime(), creada.getTime() + SESSION_MAX_MS);
});

// ─── Cifrado de secretos ──────────────────────────────────────────────────

const KEK = new Uint8Array(32).fill(7);

test("un secreto sellado vuelve intacto", () => {
  const pfx = new Uint8Array([0x30, 0x82, 0x0a, 0xff, 0x00, 0x11]);
  const sobre = sellar(KEK, "k1", pfx, "empresa:abc:certificado");
  assert.deepEqual(abrir(KEK, sobre, "empresa:abc:certificado"), pfx);
});

test("el sobre no contiene el secreto en claro", () => {
  const secreto = new TextEncoder().encode("clave-del-certificado");
  const sobre = sellar(KEK, "k1", secreto, "empresa:abc:certificado");
  const serializado = JSON.stringify(sobre);
  assert.ok(!serializado.includes("clave-del-certificado"));
});

test("un secreto de una empresa no se abre con el contexto de otra", () => {
  const sobre = sellar(KEK, "k1", new Uint8Array([1, 2, 3]), "empresa:A:certificado");
  assert.throws(() => abrir(KEK, sobre, "empresa:B:certificado"));
});

test("una clave maestra distinta no abre el sobre", () => {
  const sobre = sellar(KEK, "k1", new Uint8Array([1, 2, 3]), "ctx");
  assert.throws(() => abrir(new Uint8Array(32).fill(8), sobre, "ctx"));
});

test("alterar un byte del texto cifrado se detecta", () => {
  const blob = cifrar(KEK, new Uint8Array([1, 2, 3, 4]));
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => descifrar(KEK, blob));
});

test("una clave de tamaño equivocado se rechaza al entrar, no al fallar", () => {
  assert.throws(() => cifrar(new Uint8Array(16), new Uint8Array([1])), RangeError);
});

test("dos sellados del mismo secreto dan textos cifrados distintos", () => {
  const s = new Uint8Array([9, 9, 9]);
  const a = sellar(KEK, "k1", s, "ctx");
  const b = sellar(KEK, "k1", s, "ctx");
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.dek, b.dek);
});

// ─── RBAC ─────────────────────────────────────────────────────────────────

const A = "empresa-a";
const B = "empresa-b";

const actor = construirActor("u1", [
  { empresaId: A, permisos: ROLES_BASE["contador"]!.permisos, activo: true },
  { empresaId: B, permisos: ROLES_BASE["consulta"]!.permisos, activo: true },
]);

test("el permiso se evalúa por empresa, no globalmente", () => {
  assert.equal(puede(actor, A, "contabilidad:crear"), true);
  assert.equal(puede(actor, B, "contabilidad:crear"), false);
  assert.equal(puede(actor, B, "contabilidad:ver"), true);
});

test("una empresa donde no hay membresía no da ningún permiso", () => {
  assert.equal(puede(actor, "empresa-ajena", "contabilidad:ver"), false);
});

test("una membresía desactivada no da permisos", () => {
  const suspendido = construirActor("u2", [
    { empresaId: A, permisos: ROLES_BASE["admin"]!.permisos, activo: false },
  ]);
  assert.equal(puede(suspendido, A, "usuarios:crear"), false);
  assert.deepEqual(empresasVisibles(suspendido), []);
});

test("exigir lanza SinPermiso sin filtrar si la empresa existe", () => {
  assert.throws(
    () => exigir(actor, "empresa-ajena", "contabilidad:ver"),
    (e: unknown) => e instanceof SinPermiso && !/empresa-ajena/.test(e.message),
  );
});

test("el rol admin cubre todos los módulos", () => {
  const admin = construirActor("u3", [
    { empresaId: A, permisos: ROLES_BASE["admin"]!.permisos, activo: true },
  ]);
  assert.equal(puede(admin, A, "cpe:anular"), true);
  assert.equal(puede(admin, A, "sig:ver"), true);
});

test("el rol de solo consulta no puede escribir en ningún módulo", () => {
  const lector = construirActor("u4", [
    { empresaId: A, permisos: ROLES_BASE["consulta"]!.permisos, activo: true },
  ]);
  for (const p of ["ventas:crear", "compras:editar", "contabilidad:anular"] as const) {
    assert.equal(puede(lector, A, p), false, p);
  }
});

// ─── Freno de fuerza bruta ────────────────────────────────────────────────

const t0 = new Date("2026-09-09T12:00:00Z");

test("por debajo del umbral no hay espera", () => {
  assert.deepEqual(evaluar({ fallos: UMBRAL, ultimoFalloEn: t0 }, t0), { permitido: true });
});

test("pasado el umbral la espera crece exponencialmente", () => {
  assert.equal(esperaTras(UMBRAL), 0);
  assert.equal(esperaTras(UMBRAL + 1), 2000);
  assert.equal(esperaTras(UMBRAL + 2), 4000);
  assert.equal(esperaTras(UMBRAL + 3), 8000);
});

test("la espera tiene tope de 15 minutos", () => {
  assert.equal(esperaTras(UMBRAL + 50), 15 * 60 * 1000);
});

test("bloquea mientras no pase la espera y libera después", () => {
  const i = { fallos: UMBRAL + 1, ultimoFalloEn: t0 };
  const v = evaluar(i, new Date(t0.getTime() + 500));
  assert.equal(v.permitido, false);
  assert.equal(v.permitido === false && v.esperaMs, 1500);
  assert.deepEqual(evaluar(i, new Date(t0.getTime() + 2000)), { permitido: true });
});

test("los fallos se olvidan tras la ventana", () => {
  const i = { fallos: 99, ultimoFalloEn: t0 };
  assert.deepEqual(evaluar(i, new Date(t0.getTime() + VENTANA_MS)), { permitido: true });
});

test("registrarFallo reinicia el contador si la ventana venció", () => {
  const i = registrarFallo({ fallos: 4, ultimoFalloEn: t0 }, new Date(t0.getTime() + VENTANA_MS));
  assert.equal(i.fallos, 1);
});

test("registrarFallo acumula dentro de la ventana", () => {
  const i = registrarFallo({ fallos: 4, ultimoFalloEn: t0 }, new Date(t0.getTime() + 1000));
  assert.equal(i.fallos, 5);
});

test("gana el freno más restrictivo entre cuenta e IP", () => {
  const libre = limpiar();
  const trabado = { fallos: UMBRAL + 3, ultimoFalloEn: t0 };
  const v = evaluarAmbos(libre, trabado, t0);
  assert.equal(v.permitido, false);
  assert.equal(v.permitido === false && v.esperaMs, 8000);
});

test("con ambos frenos libres se permite", () => {
  assert.deepEqual(evaluarAmbos(limpiar(), limpiar(), t0), { permitido: true });
});
