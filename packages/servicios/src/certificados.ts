/**
 * Custodia del certificado digital y de las credenciales SOL.
 *
 * Es lo más valioso que guarda el sistema: con el certificado se puede emitir
 * cualquier comprobante a nombre de ese RUC, y con las credenciales se puede
 * enviarlo. Por eso ninguno de los dos toca la base en claro, ni siquiera de
 * paso, y ninguna función de este archivo devuelve un secreto hacia arriba.
 *
 * Lo que sí se devuelve son los metadatos que el usuario necesita ver: a qué
 * RUC pertenece el certificado y cuándo vence. Se extraen al cargarlo, una
 * vez, para no tener que descifrarlo cada vez que alguien abre la pantalla.
 */
import { desc, eq } from "drizzle-orm";
import { sellar, abrir, type SobreCifrado } from "@roulterp/core/auth";
import { abrirPfx, CertificadoInvalido } from "@roulterp/core/cpe";
import { schema as s, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { certificadosDigitales, credencialesSunat, empresas } = s;

export class ConfiguracionInvalida extends ErrorDeNegocio {
  constructor(motivo: string) {
    super(motivo, "ConfiguracionInvalida");
  }
}

/** Contexto de cifrado. Ata el secreto a su empresa: uno de otra no se abre. */
const contextoCertificado = (empresaId: string) => `empresa:${empresaId}:certificado`;
const contextoSol = (empresaId: string) => `empresa:${empresaId}:sol`;
const contextoGre = (empresaId: string) => `empresa:${empresaId}:gre`;

export type ResumenCertificado = {
  id: string;
  ruc: string | null;
  vigenteHasta: string | null;
  /** Días que faltan para que venza. Negativo si ya venció. */
  diasParaVencer: number | null;
  activo: boolean;
  cargadoEn: Date;
};

/**
 * Carga el certificado `.pfx` de la empresa.
 *
 * Antes de guardarlo se abre para comprobar tres cosas: que la contraseña es
 * correcta, que el RUC coincide con el de la empresa, y que no está vencido.
 * Guardar un certificado que no sirve significa descubrirlo el día que hay que
 * facturar.
 */
export async function cargarCertificado(
  db: Db,
  empresaId: string,
  usuarioId: string,
  pfx: Uint8Array,
  password: string,
  kek: Uint8Array,
  kekId: string,
): Promise<ResumenCertificado> {
  if (pfx.length === 0) throw new ConfiguracionInvalida("el archivo está vacío");
  if (pfx.length > 512 * 1024) {
    throw new ConfiguracionInvalida("el archivo es demasiado grande para ser un certificado");
  }

  // `abrirPfx` lanza CertificadoInvalido si la contraseña o el archivo no
  // sirven; se deja pasar tal cual porque su mensaje ya está escrito para el
  // usuario y no distingue cuál de las dos falló.
  const cert = abrirPfx(pfx, password);

  const [empresa] = await db
    .select({ ruc: empresas.ruc })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  if (!empresa) throw new ConfiguracionInvalida("la empresa no existe");

  if (cert.ruc && cert.ruc !== empresa.ruc) {
    throw new ConfiguracionInvalida(
      `el certificado pertenece al RUC ${cert.ruc} y esta empresa es ${empresa.ruc}`,
    );
  }
  if (cert.vence && cert.vence.getTime() < Date.now()) {
    throw new ConfiguracionInvalida(
      `el certificado venció el ${cert.vence.toISOString().slice(0, 10)}`,
    );
  }

  const contexto = contextoCertificado(empresaId);

  // El anterior se desactiva en vez de borrarse: un comprobante emitido el mes
  // pasado se firmó con él, y poder saber con cuál se firmó importa en una
  // fiscalización.
  await db
    .update(certificadosDigitales)
    .set({ activo: false })
    .where(eq(certificadosDigitales.activo, true));

  const [fila] = await db
    .insert(certificadosDigitales)
    .values({
      empresaId,
      pfxCifrado: sellar(kek, kekId, pfx, contexto),
      passwordCifrado: sellar(kek, kekId, new TextEncoder().encode(password), contexto),
      ruc: cert.ruc ?? null,
      vigenteHasta: cert.vence ? cert.vence.toISOString().slice(0, 10) : null,
      activo: true,
      creadoPor: usuarioId,
    })
    .returning();

  return aResumen(fila!);
}

/** Certificado activo de la empresa, sin sus secretos. */
export async function certificadoActivo(db: Db): Promise<ResumenCertificado | null> {
  const [fila] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .orderBy(desc(certificadosDigitales.creadoEn))
    .limit(1);
  return fila ? aResumen(fila) : null;
}

function aResumen(f: typeof certificadosDigitales.$inferSelect): ResumenCertificado {
  const dias = f.vigenteHasta
    ? Math.round(
        (Date.parse(`${f.vigenteHasta}T00:00:00Z`) - Date.now()) / 86_400_000,
      )
    : null;
  return {
    id: f.id,
    ruc: f.ruc,
    vigenteHasta: f.vigenteHasta,
    diasParaVencer: dias,
    activo: f.activo,
    cargadoEn: f.creadoEn,
  };
}

/**
 * Comprueba que el certificado guardado se puede abrir con la clave maestra
 * actual.
 *
 * Sirve para diagnosticar antes de emitir: si la clave maestra cambió sin
 * recifrar, el certificado es inservible y conviene saberlo ahora y no con una
 * factura a medio emitir.
 */
export async function verificarCertificado(
  db: Db,
  empresaId: string,
  kek: Uint8Array,
): Promise<{ ok: boolean; motivo?: string }> {
  const [fila] = await db
    .select()
    .from(certificadosDigitales)
    .where(eq(certificadosDigitales.activo, true))
    .limit(1);
  if (!fila) return { ok: false, motivo: "no hay certificado cargado" };

  try {
    const contexto = contextoCertificado(empresaId);
    const pfx = abrir(kek, fila.pfxCifrado as SobreCifrado, contexto);
    const password = new TextDecoder().decode(
      abrir(kek, fila.passwordCifrado as SobreCifrado, contexto),
    );
    abrirPfx(pfx, password);
    return { ok: true };
  } catch (e) {
    if (e instanceof CertificadoInvalido) return { ok: false, motivo: e.message };
    return {
      ok: false,
      motivo: "el certificado no se puede descifrar con la clave maestra actual",
    };
  }
}

export type ResumenCredenciales = {
  usuarioSol: string;
  entorno: string;
  configuradoEn: Date;
};

/**
 * Guarda las credenciales SOL.
 *
 * El usuario secundario se guarda en claro —no es un secreto y hay que
 * mostrarlo— y la clave, cifrada.
 */
export async function guardarCredencialesSol(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: { usuarioSol: string; claveSol: string; entorno: "beta" | "produccion" },
  kek: Uint8Array,
  kekId: string,
): Promise<ResumenCredenciales> {
  const usuario = datos.usuarioSol.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,}$/.test(usuario)) {
    throw new ConfiguracionInvalida(
      "el usuario SOL sólo lleva letras y números, sin el RUC delante",
    );
  }
  if (datos.claveSol.length === 0) {
    throw new ConfiguracionInvalida("la clave SOL es obligatoria");
  }

  const [fila] = await db
    .insert(credencialesSunat)
    .values({
      empresaId,
      usuarioSol: usuario,
      claveCifrada: sellar(
        kek,
        kekId,
        new TextEncoder().encode(datos.claveSol),
        contextoSol(empresaId),
      ),
      entorno: datos.entorno,
      creadoPor: usuarioId,
    })
    .onConflictDoUpdate({
      target: credencialesSunat.empresaId,
      set: {
        usuarioSol: usuario,
        claveCifrada: sellar(
          kek,
          kekId,
          new TextEncoder().encode(datos.claveSol),
          contextoSol(empresaId),
        ),
        entorno: datos.entorno,
      },
    })
    .returning();

  return {
    usuarioSol: fila!.usuarioSol,
    entorno: fila!.entorno,
    configuradoEn: fila!.creadoEn,
  };
}

/**
 * Guarda las credenciales de la API de guías de remisión.
 *
 * No son las SOL: la GRE usa un `client_id` y un `client_secret` que se generan
 * aparte en el menú SOL. El secreto se cifra con su propio contexto, así que un
 * sobre de la GRE no se puede abrir como si fuera el de la clave SOL.
 */
export async function guardarCredencialesGre(
  db: Db,
  empresaId: string,
  datos: { clientId: string; clientSecret: string },
  kek: Uint8Array,
  kekId: string,
): Promise<void> {
  const clientId = datos.clientId.trim();
  if (clientId.length < 8) {
    throw new ConfiguracionInvalida("el client_id de la GRE no parece válido");
  }
  if (datos.clientSecret.trim().length === 0) {
    throw new ConfiguracionInvalida("el client_secret es obligatorio");
  }

  const [existente] = await db.select().from(credencialesSunat).limit(1);
  if (!existente) {
    throw new ConfiguracionInvalida(
      "configure primero las credenciales SOL; las de la GRE se guardan junto a ellas",
    );
  }

  await db
    .update(credencialesSunat)
    .set({
      greClientId: clientId,
      greClientSecretCifrado: sellar(
        kek,
        kekId,
        new TextEncoder().encode(datos.clientSecret.trim()),
        contextoGre(empresaId),
      ),
    })
    .where(eq(credencialesSunat.id, existente.id));
}

/** Credenciales configuradas, sin la clave. */
export async function credencialesActuales(
  db: Db,
): Promise<(ResumenCredenciales & { greClientId: string | null }) | null> {
  const [fila] = await db.select().from(credencialesSunat).limit(1);
  return fila
    ? {
        usuarioSol: fila.usuarioSol,
        entorno: fila.entorno,
        configuradoEn: fila.creadoEn,
        greClientId: fila.greClientId,
      }
    : null;
}

/**
 * ¿Está la empresa lista para emitir?
 *
 * Reúne en un solo lugar todo lo que hace falta, para poder decírselo al
 * usuario de una vez en lugar de que lo descubra error por error.
 */
export type Preparacion = {
  /** Se puede emitir el comprobante: numerarlo, mover stock y contabilizarlo. */
  puedeEmitir: boolean;
  /** Se puede enviar a SUNAT: hay certificado y credenciales utilizables. */
  puedeEnviar: boolean;
  /** Lo que impide emitir. */
  faltantesEmision: string[];
  /** Lo que impide enviar, aunque se pueda emitir. */
  faltantesEnvio: string[];
  avisos: string[];
};

/**
 * Qué falta para emitir y qué falta para enviar. **No es lo mismo.**
 *
 * Emitir es un acto de la empresa: numerar el comprobante, descargar el
 * almacén, generar el asiento y la cuenta por cobrar. Para eso sólo hace falta
 * una serie, porque un comprobante sin número no existe.
 *
 * Enviar es una conversación con SUNAT, y eso sí necesita certificado y
 * credenciales. Confundir las dos cosas dejaba a una empresa recién dada de
 * alta sin poder registrar una sola venta mientras esperaba su certificado, que
 * tarda días: el ERP quedaba inservible justo cuando más se le necesita.
 */
export async function listaParaEmitir(
  db: Db,
  empresaId: string,
  kek: Uint8Array,
): Promise<Preparacion> {
  const faltantes: string[] = [];
  const avisos: string[] = [];

  const cert = await certificadoActivo(db);
  if (!cert) {
    faltantes.push("Cargue el certificado digital (.pfx) de la empresa");
  } else {
    const v = await verificarCertificado(db, empresaId, kek);
    if (!v.ok) faltantes.push(`El certificado no se puede usar: ${v.motivo}`);
    // Renovar un certificado toma días; avisar con un mes de margen evita
    // llegar al vencimiento sin poder facturar.
    else if (cert.diasParaVencer !== null && cert.diasParaVencer < 30) {
      avisos.push(
        cert.diasParaVencer < 0
          ? "El certificado está vencido"
          : `El certificado vence en ${cert.diasParaVencer} días`,
      );
    }
  }

  const cred = await credencialesActuales(db);
  if (!cred) faltantes.push("Configure el usuario y la clave SOL");
  else if (cred.entorno === "beta") {
    avisos.push("Está apuntando al entorno de pruebas de SUNAT; no se emite de verdad");
  }

  const series = await db
    .select({ serie: s.seriesDocumento.serie })
    .from(s.seriesDocumento)
    .where(eq(s.seriesDocumento.activa, true))
    .limit(1);

  const faltantesEmision =
    series.length === 0 ? ["Registre al menos una serie de facturación"] : [];

  return {
    puedeEmitir: faltantesEmision.length === 0,
    puedeEnviar: faltantesEmision.length === 0 && faltantes.length === 0,
    faltantesEmision,
    faltantesEnvio: faltantes,
    avisos,
  };
}
