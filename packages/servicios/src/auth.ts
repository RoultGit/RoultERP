/**
 * Servicio de autenticación.
 *
 * Todo el camino de credenciales pasa por aquí y usa el rol `roulterp_auth`,
 * que no tiene permiso sobre ninguna tabla de negocio. La consecuencia práctica
 * es que un fallo en este archivo compromete contraseñas y sesiones, no la
 * contabilidad de los clientes.
 *
 * Tres decisiones que conviene no revertir sin pensarlo:
 *
 * - El login responde lo mismo ante un correo inexistente y ante una
 *   contraseña equivocada, y tarda lo mismo, porque verifica un hash señuelo
 *   cuando el usuario no existe. Distinguir los dos casos convierte el
 *   formulario en un enumerador de cuentas.
 *
 * - El freno de fuerza bruta cuenta por cuenta y por IP a la vez. Sólo por
 *   cuenta, cualquiera bloquea a un usuario a voluntad; sólo por IP, una
 *   botnet lo esquiva.
 *
 * - El token de sesión se guarda hasheado. Un volcado de la tabla de sesiones
 *   no le sirve a nadie para suplantar a un usuario.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  hashPassword, verifyPassword, needsRehash, dummyHash, assertPasswordUsable,
  nuevoTokenSesion, hashToken, sesionVigente, renovarExpiracion,
  SESSION_TTL_MS, RESET_TTL_MS, INVITACION_TTL_MS,
  verifyTotp, generateSecret, otpauthUri, generateRecoveryCodes,
  sellar, abrir, MODULOS, ACCIONES, todosDe, type SobreCifrado,
  evaluarAmbos, registrarFallo, limpiar, type Intentos,
  construirActor, puede, exigir as exigirPermiso, SinPermiso,
  ROLES_BASE, type Actor, type Permiso,
} from "@roulterp/core/auth";
import { enAuth, schema as s, type Conexion, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { usuarios, sesiones, usuarioEmpresa, roles, tokensUnUso, intentosLogin } = s;

/** Ventana del reto de MFA. Corta a propósito: es un paso, no una sesión. */
const RETO_MFA_MS = 5 * 60 * 1000;
const PASO_TOTP = 30;

export type Entorno = {
  auth: Conexion;
  /** Clave maestra para cifrar el secreto TOTP. */
  kek: Uint8Array;
  kekId: string;
  /** Inyectable para poder probar los bordes de expiración. */
  ahora?: () => Date;
};

const ahoraDe = (e: Entorno) => e.ahora?.() ?? new Date();

// ─── Errores ──────────────────────────────────────────────────────────────

export class CredencialesInvalidas extends ErrorDeNegocio {
  constructor() {
    super("correo o contraseña incorrectos", "CredencialesInvalidas");
  }
}

export class DemasiadosIntentos extends ErrorDeNegocio {
  constructor(readonly esperaMs: number) {
    super("demasiados intentos; espere antes de reintentar", "DemasiadosIntentos");
  }
}

/** Un rol mal definido o intocable. Lo lee quien administra usuarios. */
export class RolInvalido extends ErrorDeNegocio {
  constructor(motivo: string) {
    super(motivo, "RolInvalido");
  }
}

export class TokenInvalido extends ErrorDeNegocio {
  constructor(motivo = "el enlace no es válido o ya venció") {
    super(motivo, "TokenInvalido");
  }
}

// ─── Entradas validadas ───────────────────────────────────────────────────

/**
 * El correo se normaliza a minúsculas y sin espacios antes de tocar la base.
 * Sin esto, `Ana@x.pe` y `ana@x.pe` serían dos cuentas distintas, y el índice
 * único no lo impediría.
 */
export const correoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("el correo no tiene un formato válido")
  .max(254);

export const passwordSchema = z
  .string()
  .min(12, "la contraseña debe tener al menos 12 caracteres")
  .max(1024);

export const loginSchema = z.object({
  email: correoSchema,
  password: z.string().min(1).max(1024),
});

// ─── Login ────────────────────────────────────────────────────────────────

export type ResultadoLogin =
  | { estado: "ok"; token: string; usuarioId: string; expiraEn: Date }
  | { estado: "mfa_requerido"; reto: string };

/**
 * Resultado interno de la transacción de login.
 *
 * Existe para que la transacción pueda terminar *bien* incluso cuando las
 * credenciales son malas. Lanzar dentro provocaría un ROLLBACK que se llevaría
 * el contador de intentos fallidos, y el freno de fuerza bruta no contaría nada.
 */
type Veredicto =
  | { fallo: "frenado"; esperaMs: number }
  | { fallo: "credenciales"; porCuenta: Intentos; porIp: Intentos }
  | { ok: ResultadoLogin };

export async function login(
  env: Entorno,
  entrada: { email: string; password: string; ip?: string; userAgent?: string },
): Promise<ResultadoLogin> {
  const { email, password } = loginSchema.parse(entrada);
  const ahora = ahoraDe(env);
  const claveIp = `ip:${entrada.ip ?? "desconocida"}`;
  const claveCuenta = `cuenta:${email}`;

  // El contador de fallos NO puede escribirse dentro de la transacción que
  // después lanza: el ROLLBACK se lo llevaría por delante y el freno no
  // contaría nada. Por eso la transacción devuelve el veredicto y el registro
  // del fallo ocurre fuera, en su propia transacción, antes de lanzar.
  const resultado = await enAuth(env.auth, async (db): Promise<Veredicto> => {
    const [porCuenta, porIp] = await Promise.all([
      leerIntentos(db, claveCuenta),
      leerIntentos(db, claveIp),
    ]);
    const veredicto = evaluarAmbos(porCuenta, porIp, ahora);
    if (!veredicto.permitido) {
      return { fallo: "frenado" as const, esperaMs: veredicto.esperaMs };
    }

    const [usuario] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);

    // Se verifica siempre un hash, exista el usuario o no, para que el tiempo
    // de respuesta no revele qué correos están registrados.
    const hash = usuario?.passwordHash ?? (await dummyHash());
    const coincide = await verifyPassword(password, hash);

    if (!usuario || !usuario.activo || !coincide) {
      return { fallo: "credenciales" as const, porCuenta, porIp };
    }

    await limpiarIntentos(db, [claveCuenta, claveIp]);

    // Si la contraseña sigue con un costo antiguo, se rehashea ahora que se
    // tiene el texto en claro. Subir el costo no invalida a nadie.
    if (needsRehash(usuario.passwordHash)) {
      await db
        .update(usuarios)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(usuarios.id, usuario.id));
    }

    if (usuario.mfaActivo) {
      const { token, hash: tokenHash } = nuevoTokenSesion();
      await db.insert(tokensUnUso).values({
        usuarioId: usuario.id,
        tokenHash,
        tipo: "mfa",
        expiraEn: new Date(ahora.getTime() + RETO_MFA_MS),
      });
      return { ok: { estado: "mfa_requerido", reto: token } };
    }

    return { ok: await abrirSesion(db, usuario.id, entrada, ahora) };
  });

  if ("fallo" in resultado) {
    if (resultado.fallo === "frenado") throw new DemasiadosIntentos(resultado.esperaMs);
    await enAuth(env.auth, async (db) => {
      await anotarFallo(db, claveCuenta, resultado.porCuenta, ahora);
      await anotarFallo(db, claveIp, resultado.porIp, ahora);
    });
    throw new CredencialesInvalidas();
  }
  return resultado.ok;
}

/** Segundo paso del login cuando el usuario tiene MFA activo. */
export async function verificarMfa(
  env: Entorno,
  entrada: { reto: string; codigo: string; ip?: string; userAgent?: string },
): Promise<ResultadoLogin> {
  const ahora = ahoraDe(env);
  // Un millón de combinaciones en los cinco minutos que dura el reto son
  // alcanzables por fuerza bruta. Se aplica al reto el mismo freno del login.
  const claveReto = `mfa:${hashToken(entrada.reto)}`;

  type Paso2 = { ok: ResultadoLogin } | { fallo: true };

  const resultado = await enAuth(env.auth, async (db): Promise<Paso2> => {
    const intentos = await leerIntentos(db, claveReto);
    const veredicto = evaluarAmbos(intentos, limpiar(), ahora);
    if (!veredicto.permitido) throw new DemasiadosIntentos(veredicto.esperaMs);

    const [fila] = await db
      .select()
      .from(tokensUnUso)
      .where(and(eq(tokensUnUso.tokenHash, hashToken(entrada.reto)), eq(tokensUnUso.tipo, "mfa")))
      .limit(1);

    if (!fila || fila.usadoEn || fila.expiraEn.getTime() <= ahora.getTime()) {
      throw new TokenInvalido("el reto de verificación venció; vuelva a iniciar sesión");
    }

    const [usuario] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, fila.usuarioId))
      .limit(1);
    if (!usuario?.mfaActivo || !usuario.mfaSecreto) throw new TokenInvalido();

    const secreto = new TextDecoder().decode(
      abrir(env.kek, usuario.mfaSecreto as SobreCifrado, contextoMfa(usuario.id)),
    );

    const paso = Math.floor(ahora.getTime() / 1000 / PASO_TOTP);
    const codigo = entrada.codigo.trim().replace(/\s/g, "");

    let valido = verifyTotp(secreto, codigo, Math.floor(ahora.getTime() / 1000));
    // Un código ya consumido no vale una segunda vez, aunque siga dentro de su
    // ventana: TOTP no protege del replay por sí solo.
    if (valido && usuario.mfaUltimoPaso !== null && paso <= usuario.mfaUltimoPaso) {
      valido = false;
    }

    if (!valido) {
      const usadoRespaldo = await consumirRespaldo(db, usuario.id, usuario.mfaRespaldos, codigo);
      // Se devuelve el fallo en vez de lanzarlo, para que el contador de
      // intentos que se escribe después no se pierda en un ROLLBACK.
      if (!usadoRespaldo) return { fallo: true };
    } else {
      await db.update(usuarios).set({ mfaUltimoPaso: paso }).where(eq(usuarios.id, usuario.id));
    }

    await db.update(tokensUnUso).set({ usadoEn: ahora }).where(eq(tokensUnUso.id, fila.id));
    await limpiarIntentos(db, [claveReto]);
    return { ok: await abrirSesion(db, usuario.id, entrada, ahora) };
  });

  if ("fallo" in resultado) {
    await enAuth(env.auth, async (db) => {
      await anotarFallo(db, claveReto, await leerIntentos(db, claveReto), ahora);
    });
    throw new CredencialesInvalidas();
  }
  return resultado.ok;
}

async function abrirSesion(
  db: Db,
  usuarioId: string,
  entrada: { ip?: string; userAgent?: string },
  ahora: Date,
): Promise<{ estado: "ok"; token: string; usuarioId: string; expiraEn: Date }> {
  const { token, hash } = nuevoTokenSesion();
  const expiraEn = new Date(ahora.getTime() + SESSION_TTL_MS);

  // Si el usuario pertenece a una sola empresa, se selecciona sola: pedirle que
  // elija entre una única opción es una pantalla que no aporta nada.
  const membresias = await db
    .select({ empresaId: usuarioEmpresa.empresaId })
    .from(usuarioEmpresa)
    .where(and(eq(usuarioEmpresa.usuarioId, usuarioId), eq(usuarioEmpresa.activo, true)));
  const empresaId = membresias.length === 1 ? membresias[0]!.empresaId : null;

  await db.insert(sesiones).values({
    usuarioId,
    tokenHash: hash,
    empresaId,
    ip: entrada.ip ?? null,
    userAgent: entrada.userAgent?.slice(0, 500) ?? null,
    expiraEn,
    ultimoUsoEn: ahora,
    creadaEn: ahora,
  });
  await db.update(usuarios).set({ ultimoAccesoEn: ahora }).where(eq(usuarios.id, usuarioId));

  return { estado: "ok", token, usuarioId, expiraEn };
}

// ─── Sesión activa ────────────────────────────────────────────────────────

export type SesionActiva = {
  sesionId: string;
  usuarioId: string;
  email: string;
  nombre: string;
  empresaId: string | null;
  actor: Actor;
};

/**
 * Resuelve la cookie a una sesión utilizable y renueva su vigencia.
 *
 * Devuelve null en vez de lanzar: una sesión vencida es el curso normal de las
 * cosas, no un error del que haya que informar con detalle.
 */
export async function cargarSesion(env: Entorno, token: string): Promise<SesionActiva | null> {
  if (!token) return null;
  const ahora = ahoraDe(env);

  return enAuth(env.auth, async (db) => {
    const [fila] = await db
      .select({
        sesion: sesiones,
        usuario: usuarios,
      })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
      .where(eq(sesiones.tokenHash, hashToken(token)))
      .limit(1);

    if (!fila || !fila.usuario.activo) return null;
    const estado = {
      creadaEn: fila.sesion.creadaEn,
      expiraEn: fila.sesion.expiraEn,
      ultimoUsoEn: fila.sesion.ultimoUsoEn,
      revocadaEn: fila.sesion.revocadaEn,
    };
    if (!sesionVigente(estado, ahora)) return null;

    await db
      .update(sesiones)
      .set({ ultimoUsoEn: ahora, expiraEn: renovarExpiracion(estado, ahora) })
      .where(eq(sesiones.id, fila.sesion.id));

    const actor = await cargarActor(db, fila.usuario.id);

    // Una membresía revocada mientras la sesión estaba abierta tiene que
    // expulsar de la empresa en el acto, no en el próximo login.
    const empresaId =
      fila.sesion.empresaId && actor.membresias.get(fila.sesion.empresaId)?.activo
        ? fila.sesion.empresaId
        : null;

    return {
      sesionId: fila.sesion.id,
      usuarioId: fila.usuario.id,
      email: fila.usuario.email,
      nombre: fila.usuario.nombre,
      empresaId,
      actor,
    };
  });
}

async function cargarActor(db: Db, usuarioId: string): Promise<Actor> {
  const filas = await db
    .select({
      empresaId: usuarioEmpresa.empresaId,
      activo: usuarioEmpresa.activo,
      permisos: roles.permisos,
    })
    .from(usuarioEmpresa)
    .innerJoin(roles, eq(roles.id, usuarioEmpresa.rolId))
    .where(eq(usuarioEmpresa.usuarioId, usuarioId));

  return construirActor(
    usuarioId,
    filas.map((f) => ({ empresaId: f.empresaId, permisos: f.permisos, activo: f.activo })),
  );
}

/** Cambia la empresa activa de la sesión, si el usuario pertenece a ella. */
export async function seleccionarEmpresa(
  env: Entorno,
  sesionId: string,
  empresaId: string,
): Promise<boolean> {
  return enAuth(env.auth, async (db) => {
    const [sesion] = await db.select().from(sesiones).where(eq(sesiones.id, sesionId)).limit(1);
    if (!sesion) return false;

    const [membresia] = await db
      .select()
      .from(usuarioEmpresa)
      .where(
        and(
          eq(usuarioEmpresa.usuarioId, sesion.usuarioId),
          eq(usuarioEmpresa.empresaId, empresaId),
          eq(usuarioEmpresa.activo, true),
        ),
      )
      .limit(1);
    if (!membresia) return false;

    await db.update(sesiones).set({ empresaId }).where(eq(sesiones.id, sesionId));
    return true;
  });
}

export async function cerrarSesion(env: Entorno, token: string): Promise<void> {
  const ahora = ahoraDe(env);
  await enAuth(env.auth, (db) =>
    db
      .update(sesiones)
      .set({ revocadaEn: ahora })
      .where(and(eq(sesiones.tokenHash, hashToken(token)), isNull(sesiones.revocadaEn))),
  );
}

/** Cierra todas las sesiones de un usuario. Se usa al cambiar la contraseña. */
export async function cerrarTodasLasSesiones(env: Entorno, usuarioId: string): Promise<void> {
  const ahora = ahoraDe(env);
  await enAuth(env.auth, (db) =>
    db
      .update(sesiones)
      .set({ revocadaEn: ahora })
      .where(and(eq(sesiones.usuarioId, usuarioId), isNull(sesiones.revocadaEn))),
  );
}

// ─── Contraseñas ──────────────────────────────────────────────────────────

export async function cambiarPassword(
  env: Entorno,
  usuarioId: string,
  actual: string,
  nueva: string,
): Promise<void> {
  passwordSchema.parse(nueva);
  assertPasswordUsable(nueva);

  await enAuth(env.auth, async (db) => {
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
    if (!usuario || !(await verifyPassword(actual, usuario.passwordHash))) {
      throw new CredencialesInvalidas();
    }
    await db
      .update(usuarios)
      .set({ passwordHash: await hashPassword(nueva) })
      .where(eq(usuarios.id, usuarioId));
  });

  // Cambiar la contraseña expulsa al resto de dispositivos. Es justo lo que se
  // espera de este botón cuando uno sospecha que le robaron la cuenta.
  await cerrarTodasLasSesiones(env, usuarioId);
}

/**
 * Genera un token de reseteo.
 *
 * Devuelve null si el correo no existe, y quien llama debe responder lo mismo
 * en ambos casos: «si el correo está registrado, le enviamos un enlace». De lo
 * contrario el formulario de recuperación enumera cuentas.
 */
export async function solicitarReseteo(env: Entorno, email: string): Promise<string | null> {
  const correo = correoSchema.parse(email);
  const ahora = ahoraDe(env);

  return enAuth(env.auth, async (db) => {
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, correo)).limit(1);
    if (!usuario || !usuario.activo) return null;

    const { token, hash } = nuevoTokenSesion();
    await db.insert(tokensUnUso).values({
      usuarioId: usuario.id,
      tokenHash: hash,
      tipo: "reseteo",
      expiraEn: new Date(ahora.getTime() + RESET_TTL_MS),
    });
    return token;
  });
}

export async function resetearPassword(
  env: Entorno,
  token: string,
  nueva: string,
): Promise<string> {
  passwordSchema.parse(nueva);
  const ahora = ahoraDe(env);

  const usuarioId = await enAuth(env.auth, async (db) => {
    const fila = await consumirToken(db, token, "reseteo", ahora);
    await db
      .update(usuarios)
      .set({ passwordHash: await hashPassword(nueva) })
      .where(eq(usuarios.id, fila.usuarioId));
    return fila.usuarioId;
  });

  await cerrarTodasLasSesiones(env, usuarioId);
  return usuarioId;
}

// ─── Invitaciones ─────────────────────────────────────────────────────────

/**
 * Invita a alguien a una empresa. Si el correo ya existe, se le añade la
 * membresía y no se crea otra cuenta: la misma persona trabaja en varias
 * empresas con una sola credencial.
 */
export async function invitarUsuario(
  env: Entorno,
  datos: { email: string; nombre: string; empresaId: string; rolCodigo: string },
): Promise<{ token: string | null; usuarioId: string }> {
  const correo = correoSchema.parse(datos.email);
  const ahora = ahoraDe(env);

  return enAuth(env.auth, async (db) => {
    const [rol] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.empresaId, datos.empresaId), eq(roles.codigo, datos.rolCodigo)))
      .limit(1);
    if (!rol) throw new RolInvalido(`el rol ${datos.rolCodigo} no existe en esta empresa`);

    let [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, correo)).limit(1);
    let token: string | null = null;

    if (!usuario) {
      // Se crea con un hash imposible de acertar: la cuenta no sirve hasta que
      // la persona acepte la invitación y elija su contraseña.
      const { token: t, hash } = nuevoTokenSesion();
      token = t;
      [usuario] = await db
        .insert(usuarios)
        .values({
          email: correo,
          nombre: datos.nombre,
          passwordHash: await hashPassword(nuevoTokenSesion().token.slice(0, 40)),
          activo: false,
        })
        .returning();
      await db.insert(tokensUnUso).values({
        usuarioId: usuario!.id,
        tokenHash: hash,
        tipo: "invitacion",
        expiraEn: new Date(ahora.getTime() + INVITACION_TTL_MS),
      });
    }

    await db
      .insert(usuarioEmpresa)
      .values({ usuarioId: usuario!.id, empresaId: datos.empresaId, rolId: rol.id })
      .onConflictDoUpdate({
        target: [usuarioEmpresa.usuarioId, usuarioEmpresa.empresaId],
        set: { rolId: rol.id, activo: true },
      });

    return { token, usuarioId: usuario!.id };
  });
}

export async function aceptarInvitacion(
  env: Entorno,
  token: string,
  password: string,
): Promise<string> {
  passwordSchema.parse(password);
  const ahora = ahoraDe(env);

  return enAuth(env.auth, async (db) => {
    const fila = await consumirToken(db, token, "invitacion", ahora);
    await db
      .update(usuarios)
      .set({ passwordHash: await hashPassword(password), activo: true })
      .where(eq(usuarios.id, fila.usuarioId));
    return fila.usuarioId;
  });
}

/** Quita el acceso de un usuario a una empresa, sin borrar su cuenta. */
export async function revocarAcceso(
  env: Entorno,
  usuarioId: string,
  empresaId: string,
): Promise<void> {
  await enAuth(env.auth, (db) =>
    db
      .update(usuarioEmpresa)
      .set({ activo: false })
      .where(
        and(eq(usuarioEmpresa.usuarioId, usuarioId), eq(usuarioEmpresa.empresaId, empresaId)),
      ),
  );
}

// ─── Segundo factor ───────────────────────────────────────────────────────

const contextoMfa = (usuarioId: string) => `usuario:${usuarioId}:mfa`;

/**
 * Primer paso: genera el secreto y lo guarda cifrado, pero deja el MFA
 * inactivo. Sólo se activa cuando la persona demuestra que su app ya lo tiene,
 * o quedaría fuera de su propia cuenta.
 */
export async function prepararMfa(
  env: Entorno,
  usuarioId: string,
  email: string,
): Promise<{ secreto: string; uri: string }> {
  const secreto = generateSecret();
  await enAuth(env.auth, (db) =>
    db
      .update(usuarios)
      .set({
        mfaSecreto: sellar(
          env.kek,
          env.kekId,
          new TextEncoder().encode(secreto),
          contextoMfa(usuarioId),
        ),
        mfaActivo: false,
      })
      .where(eq(usuarios.id, usuarioId)),
  );
  return { secreto, uri: otpauthUri({ secret: secreto, cuenta: email, emisor: "RoultERP" }) };
}

/** Segundo paso: confirma con un código y entrega los códigos de respaldo. */
export async function activarMfa(
  env: Entorno,
  usuarioId: string,
  codigo: string,
): Promise<string[]> {
  const ahora = ahoraDe(env);
  return enAuth(env.auth, async (db) => {
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
    if (!usuario?.mfaSecreto) throw new TokenInvalido("primero hay que preparar el segundo factor");

    const secreto = new TextDecoder().decode(
      abrir(env.kek, usuario.mfaSecreto as SobreCifrado, contextoMfa(usuarioId)),
    );
    if (!verifyTotp(secreto, codigo, Math.floor(ahora.getTime() / 1000))) {
      throw new CredencialesInvalidas();
    }

    const respaldos = generateRecoveryCodes();
    await db
      .update(usuarios)
      .set({
        mfaActivo: true,
        mfaUltimoPaso: Math.floor(ahora.getTime() / 1000 / PASO_TOTP),
        // Los códigos de respaldo se guardan hasheados, igual que una
        // contraseña: se muestran una vez y no vuelven a existir en claro.
        mfaRespaldos: respaldos.map(hashToken),
      })
      .where(eq(usuarios.id, usuarioId));
    return respaldos;
  });
}

export async function desactivarMfa(
  env: Entorno,
  usuarioId: string,
  password: string,
): Promise<void> {
  await enAuth(env.auth, async (db) => {
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
    // Se exige la contraseña: quitar el segundo factor con una sesión robada
    // dejaría la cuenta abierta para siempre.
    if (!usuario || !(await verifyPassword(password, usuario.passwordHash))) {
      throw new CredencialesInvalidas();
    }
    await db
      .update(usuarios)
      .set({ mfaActivo: false, mfaSecreto: null, mfaRespaldos: null, mfaUltimoPaso: null })
      .where(eq(usuarios.id, usuarioId));
  });
}

async function consumirRespaldo(
  db: Db,
  usuarioId: string,
  respaldos: string[] | null,
  codigo: string,
): Promise<boolean> {
  if (!respaldos?.length) return false;
  const hash = hashToken(codigo.toUpperCase());
  if (!respaldos.includes(hash)) return false;
  // De un solo uso: se elimina en cuanto se acepta.
  await db
    .update(usuarios)
    .set({ mfaRespaldos: respaldos.filter((r) => r !== hash) })
    .where(eq(usuarios.id, usuarioId));
  return true;
}

// ─── Auxiliares ───────────────────────────────────────────────────────────

async function consumirToken(
  db: Db,
  token: string,
  tipo: string,
  ahora: Date,
): Promise<{ id: string; usuarioId: string }> {
  const [fila] = await db
    .select()
    .from(tokensUnUso)
    .where(and(eq(tokensUnUso.tokenHash, hashToken(token)), eq(tokensUnUso.tipo, tipo)))
    .limit(1);

  if (!fila || fila.usadoEn || fila.expiraEn.getTime() <= ahora.getTime()) {
    throw new TokenInvalido();
  }
  // Se marca usado dentro de la misma transacción que lo consume, para que dos
  // peticiones simultáneas no lo canjeen dos veces.
  const marcadas = await db
    .update(tokensUnUso)
    .set({ usadoEn: ahora })
    .where(and(eq(tokensUnUso.id, fila.id), isNull(tokensUnUso.usadoEn)))
    .returning({ id: tokensUnUso.id });
  if (marcadas.length === 0) throw new TokenInvalido();

  return { id: fila.id, usuarioId: fila.usuarioId };
}

async function leerIntentos(db: Db, clave: string): Promise<Intentos> {
  const [fila] = await db.select().from(intentosLogin).where(eq(intentosLogin.clave, clave)).limit(1);
  return fila ? { fallos: fila.fallos, ultimoFalloEn: fila.ultimoFalloEn } : limpiar();
}

async function anotarFallo(db: Db, clave: string, previo: Intentos, ahora: Date): Promise<void> {
  const siguiente = registrarFallo(previo, ahora);
  await db
    .insert(intentosLogin)
    .values({ clave, fallos: siguiente.fallos, ultimoFalloEn: siguiente.ultimoFalloEn })
    .onConflictDoUpdate({
      target: intentosLogin.clave,
      set: { fallos: siguiente.fallos, ultimoFalloEn: siguiente.ultimoFalloEn },
    });
}

async function limpiarIntentos(db: Db, claves: string[]): Promise<void> {
  await db.delete(intentosLogin).where(inArray(intentosLogin.clave, claves));
}

export { ROLES_BASE, MODULOS, ACCIONES, todosDe, puede, exigirPermiso, SinPermiso, type Actor, type Permiso };

// ─── Administración de usuarios y roles ───────────────────────────────────

/**
 * Usuarios con acceso a una empresa.
 *
 * Va contra el rol `auth`, no contra el de negocio: las tablas de identidad
 * viven fuera de RLS porque un usuario pertenece a varias empresas y su fila no
 * es de ninguna. El filtro por empresa lo pone esta consulta, y es la única
 * puerta: no hay forma de listar los usuarios de otra empresa desde aquí.
 */
export async function usuariosDeEmpresa(env: Entorno, empresaId: string) {
  return enAuth(env.auth, async (db) => {
    const filas = await db
      .select({
        usuarioId: usuarios.id,
        email: usuarios.email,
        nombre: usuarios.nombre,
        activoCuenta: usuarios.activo,
        mfaActivo: usuarios.mfaActivo,
        ultimoAcceso: usuarios.ultimoAccesoEn,
        activo: usuarioEmpresa.activo,
        rolId: roles.id,
        rolCodigo: roles.codigo,
        rolNombre: roles.nombre,
      })
      .from(usuarioEmpresa)
      .innerJoin(usuarios, eq(usuarios.id, usuarioEmpresa.usuarioId))
      .innerJoin(roles, eq(roles.id, usuarioEmpresa.rolId))
      .where(eq(usuarioEmpresa.empresaId, empresaId))
      .orderBy(usuarios.nombre);
    return filas;
  });
}

/** Roles definidos en la empresa, con sus permisos. */
export async function rolesDeEmpresa(env: Entorno, empresaId: string) {
  return enAuth(env.auth, (db) =>
    db
      .select()
      .from(roles)
      .where(eq(roles.empresaId, empresaId))
      .orderBy(roles.nombre),
  );
}

/**
 * Crea o actualiza un rol.
 *
 * Un rol del sistema no se edita: son el punto de partida de cada empresa
 * nueva, y dejarlos cambiar significaría que dos empresas con el mismo rol
 * "contador" no tienen los mismos permisos. Para variar, se copia.
 */
export async function guardarRol(
  env: Entorno,
  empresaId: string,
  datos: { rolId?: string; codigo: string; nombre: string; permisos: string[] },
): Promise<string> {
  const codigo = datos.codigo.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(codigo)) {
    throw new RolInvalido("el código del rol lleva letras, números, guiones y guiones bajos");
  }
  if (datos.nombre.trim().length < 2) throw new RolInvalido("el rol necesita un nombre");

  // Se filtra contra el catálogo real: un permiso inventado no protege nada y
  // esconde el error hasta que alguien no puede hacer su trabajo.
  const validos = new Set<string>(MODULOS.flatMap(todosDe));
  const permisos = [...new Set(datos.permisos)].filter((p) => validos.has(p));
  if (permisos.length === 0) throw new RolInvalido("un rol sin permisos no sirve para nada");

  return enAuth(env.auth, async (db) => {
    if (datos.rolId) {
      const [existente] = await db.select().from(roles).where(eq(roles.id, datos.rolId)).limit(1);
      if (!existente || existente.empresaId !== empresaId) throw new RolInvalido("el rol no existe");
      if (existente.esSistema) {
        throw new RolInvalido(
          `«${existente.nombre}» es un rol del sistema y no se edita; duplíquelo para partir de él`,
        );
      }
      await db
        .update(roles)
        .set({ codigo, nombre: datos.nombre.trim(), permisos })
        .where(eq(roles.id, datos.rolId));
      return datos.rolId;
    }

    const [fila] = await db
      .insert(roles)
      .values({ empresaId, codigo, nombre: datos.nombre.trim(), permisos, esSistema: false })
      .returning({ id: roles.id });
    return fila!.id;
  });
}

/** Cambia el rol de un usuario dentro de una empresa. */
export async function cambiarRol(
  env: Entorno,
  usuarioId: string,
  empresaId: string,
  rolId: string,
): Promise<void> {
  await enAuth(env.auth, async (db) => {
    const [rol] = await db.select().from(roles).where(eq(roles.id, rolId)).limit(1);
    if (!rol || rol.empresaId !== empresaId) throw new RolInvalido("el rol no existe en esta empresa");
    await db
      .update(usuarioEmpresa)
      .set({ rolId, activo: true })
      .where(
        and(eq(usuarioEmpresa.usuarioId, usuarioId), eq(usuarioEmpresa.empresaId, empresaId)),
      );
  });
}

/** Devuelve el acceso a alguien a quien se le había revocado. */
export async function restaurarAcceso(
  env: Entorno,
  usuarioId: string,
  empresaId: string,
): Promise<void> {
  await enAuth(env.auth, (db) =>
    db
      .update(usuarioEmpresa)
      .set({ activo: true })
      .where(
        and(eq(usuarioEmpresa.usuarioId, usuarioId), eq(usuarioEmpresa.empresaId, empresaId)),
      ),
  );
}

/**
 * Cuántos administradores activos quedan en la empresa.
 *
 * Sirve para no dejarla sin nadie que pueda administrarla: revocar al último
 * administrador es irreversible desde dentro del producto.
 */
export async function administradoresActivos(env: Entorno, empresaId: string): Promise<number> {
  return enAuth(env.auth, async (db) => {
    const filas = await db
      .select({ id: usuarioEmpresa.id })
      .from(usuarioEmpresa)
      .innerJoin(roles, eq(roles.id, usuarioEmpresa.rolId))
      .innerJoin(usuarios, eq(usuarios.id, usuarioEmpresa.usuarioId))
      .where(
        and(
          eq(usuarioEmpresa.empresaId, empresaId),
          eq(usuarioEmpresa.activo, true),
          eq(usuarios.activo, true),
          sql`'usuarios:editar' = ANY(${roles.permisos})`,
        ),
      );
    return filas.length;
  });
}
