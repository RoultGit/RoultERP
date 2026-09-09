/**
 * Empresas, usuarios, sesiones y permisos.
 *
 * Estas tablas son la excepción a la regla de `empresa_id`: `usuarios` y
 * `sesiones` son globales porque una persona puede trabajar en varias empresas
 * con la misma credencial. Su aislamiento no lo da RLS sino el hecho de que
 * sólo se consultan por el identificador del propio usuario autenticado, antes
 * de que exista una empresa activa.
 *
 * `usuario_empresa` es la bisagra: decide a qué empresas puede entrar alguien y
 * con qué rol en cada una.
 */
import { relations } from "drizzle-orm";
import {
  boolean, index, inet, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { auditoria, creadoEn, fecha, id, importe } from "./comun.ts";

export const empresas = pgTable(
  "empresas",
  {
    id: id(),
    ruc: text("ruc").notNull(),
    razonSocial: text("razon_social").notNull(),
    nombreComercial: text("nombre_comercial"),
    direccion: text("direccion"),
    ubigeo: text("ubigeo"),
    /** Moneda en la que la empresa lleva su contabilidad. PEN salvo excepción. */
    monedaFuncional: text("moneda_funcional").notNull().default("PEN"),
    /** "promedio" o "peps". Define cómo se valoriza todo su inventario. */
    metodoValorizacion: text("metodo_valorizacion").notNull().default("promedio"),
    /** Cómo redondea el depósito de detracción: "cercano" o "arriba". */
    redondeoDetraccion: text("redondeo_detraccion").notNull().default("cercano"),
    esAgenteRetencion: boolean("es_agente_retencion").notNull().default(false),
    esAgentePercepcion: boolean("es_agente_percepcion").notNull().default(false),
    activa: boolean("activa").notNull().default(true),
    ...auditoria(),
  },
  (t) => [uniqueIndex("empresas_ruc_uk").on(t.ruc)],
);

export const usuarios = pgTable(
  "usuarios",
  {
    id: id(),
    /** Se guarda normalizado a minúsculas; el índice único lo garantiza. */
    email: text("email").notNull(),
    /** Hash Argon2id en formato PHC. Jamás sale de la capa de auth. */
    passwordHash: text("password_hash").notNull(),
    nombre: text("nombre").notNull(),
    /** Secreto TOTP cifrado con sobre. NULL mientras el usuario no active MFA. */
    mfaSecreto: jsonb("mfa_secreto"),
    mfaActivo: boolean("mfa_activo").notNull().default(false),
    /**
     * Último paso TOTP consumido. TOTP por sí solo no impide que un código
     * interceptado se reutilice dentro de su ventana de 30 s; guardar el paso
     * y exigir que el siguiente sea mayor sí lo impide.
     */
    mfaUltimoPaso: integer("mfa_ultimo_paso"),
    /** Hashes de los códigos de respaldo aún sin usar. */
    mfaRespaldos: text("mfa_respaldos").array(),
    activo: boolean("activo").notNull().default(true),
    ultimoAccesoEn: timestamp("ultimo_acceso_en", { withTimezone: true }),
    ...auditoria(),
  },
  (t) => [uniqueIndex("usuarios_email_uk").on(t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    /** Permisos en formato `modulo:accion`, tal como los define core/auth/rbac. */
    permisos: text("permisos").array().notNull(),
    /** Los roles del sistema no se borran; se pueden copiar y editar. */
    esSistema: boolean("es_sistema").notNull().default(false),
    ...auditoria(),
  },
  (t) => [uniqueIndex("roles_empresa_codigo_uk").on(t.empresaId, t.codigo)],
);

export const usuarioEmpresa = pgTable(
  "usuario_empresa",
  {
    id: id(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    rolId: uuid("rol_id").notNull().references(() => roles.id),
    activo: boolean("activo").notNull().default(true),
    ...auditoria(),
  },
  (t) => [
    uniqueIndex("usuario_empresa_uk").on(t.usuarioId, t.empresaId),
    index("usuario_empresa_usuario_ix").on(t.usuarioId),
  ],
);

export const sesiones = pgTable(
  "sesiones",
  {
    id: id(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    /** SHA-256 del token. El token en claro sólo existe en la cookie. */
    tokenHash: text("token_hash").notNull(),
    /** Empresa seleccionada en esta sesión. Cambia con el selector de empresa. */
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "cascade" }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    creadaEn: creadoEn(),
    expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
    ultimoUsoEn: timestamp("ultimo_uso_en", { withTimezone: true }).notNull().defaultNow(),
    revocadaEn: timestamp("revocada_en", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sesiones_token_uk").on(t.tokenHash),
    index("sesiones_usuario_ix").on(t.usuarioId),
  ],
);

/**
 * Invitaciones y reseteos de contraseña. Mismo tratamiento que las sesiones:
 * se guarda el hash y se entrega el token en claro una sola vez.
 */
export const tokensUnUso = pgTable(
  "tokens_un_uso",
  {
    id: id(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** "invitacion" o "reseteo". */
    tipo: text("tipo").notNull(),
    expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
    usadoEn: timestamp("usado_en", { withTimezone: true }),
    creadoEn: creadoEn(),
  },
  (t) => [uniqueIndex("tokens_un_uso_uk").on(t.tokenHash)],
);

/**
 * Contador de intentos fallidos de login.
 *
 * La clave es el correo o la IP, con un prefijo que los distingue. Se frena por
 * los dos a la vez: sólo por cuenta, cualquiera puede bloquear a un usuario a
 * voluntad; sólo por IP, una botnet lo esquiva.
 */
export const intentosLogin = pgTable("intentos_login", {
  clave: text("clave").primaryKey(),
  fallos: integer("fallos").notNull().default(0),
  ultimoFalloEn: timestamp("ultimo_fallo_en", { withTimezone: true }),
});

/**
 * Bitácora de auditoría. Append-only por política de RLS: se puede insertar y
 * leer, nunca actualizar ni borrar, ni siquiera desde la aplicación.
 */
export const auditoriaLog = pgTable(
  "auditoria",
  {
    id: id(),
    empresaId: uuid("empresa_id"),
    usuarioId: uuid("usuario_id"),
    tabla: text("tabla").notNull(),
    registroId: text("registro_id"),
    /** "insertar", "actualizar", "anular", "extornar", "acceder". */
    accion: text("accion").notNull(),
    antes: jsonb("antes"),
    despues: jsonb("despues"),
    ip: inet("ip"),
    creadoEn: creadoEn(),
  },
  (t) => [
    index("auditoria_empresa_fecha_ix").on(t.empresaId, t.creadoEn),
    index("auditoria_tabla_registro_ix").on(t.tabla, t.registroId),
  ],
);

/**
 * Cola de trabajos largos: PLE, recálculo de kardex, envíos a SUNAT.
 *
 * ponytail: una tabla y un cron, sin Redis ni broker. Techo: si hace falta
 * concurrencia real, se toma con `FOR UPDATE SKIP LOCKED` desde varios workers,
 * que es un cambio en la consulta y no en el modelo.
 */
export const trabajos = pgTable(
  "trabajos",
  {
    id: id(),
    // Todo trabajo pertenece a una empresa. Las tareas globales (traer el tipo
    // de cambio del día) son una ruta de cron, no una fila aquí: así esta tabla
    // no necesita una excepción en la política de aislamiento.
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    /** "pendiente", "ejecutando", "listo", "fallido". */
    estado: text("estado").notNull().default("pendiente"),
    payload: jsonb("payload").notNull(),
    resultado: jsonb("resultado"),
    error: text("error"),
    intentos: integer("intentos").notNull().default(0),
    ejecutarEn: timestamp("ejecutar_en", { withTimezone: true }).notNull().defaultNow(),
    creadoEn: creadoEn(),
  },
  (t) => [index("trabajos_pendientes_ix").on(t.estado, t.ejecutarEn)],
);

/** Tipo de cambio publicado por SUNAT/SBS. Catálogo global, no por empresa. */
export const tipoCambio = pgTable(
  "tipo_cambio",
  {
    fecha: fecha("fecha").notNull(),
    moneda: text("moneda").notNull(),
    compra: importe("compra").notNull(),
    venta: importe("venta").notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [uniqueIndex("tipo_cambio_uk").on(t.fecha, t.moneda)],
);

export const empresasRel = relations(empresas, ({ many }) => ({
  roles: many(roles),
  miembros: many(usuarioEmpresa),
}));

export const usuariosRel = relations(usuarios, ({ many }) => ({
  membresias: many(usuarioEmpresa),
  sesiones: many(sesiones),
}));

export const usuarioEmpresaRel = relations(usuarioEmpresa, ({ one }) => ({
  usuario: one(usuarios, { fields: [usuarioEmpresa.usuarioId], references: [usuarios.id] }),
  empresa: one(empresas, { fields: [usuarioEmpresa.empresaId], references: [empresas.id] }),
  rol: one(roles, { fields: [usuarioEmpresa.rolId], references: [roles.id] }),
}));
