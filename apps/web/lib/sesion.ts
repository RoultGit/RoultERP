import "server-only";

/**
 * Puerta de entrada a los datos desde el servidor.
 *
 * Toda página y toda acción que toque datos de negocio pasa por `conEmpresa`.
 * Eso garantiza tres cosas a la vez: que hay sesión, que hay una empresa
 * elegida, y que la consulta corre dentro de una transacción con el contexto de
 * RLS fijado. No existe otro camino a la base para el código de la aplicación.
 *
 * El permiso se comprueba aquí *además* de en RLS. No es redundancia inútil:
 * RLS decide de qué empresa son las filas, el RBAC decide si esta persona puede
 * hacer esta operación. Un usuario de solo consulta pasa el filtro de RLS
 * perfectamente y aun así no debe poder anular una factura.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { enEmpresa, type Db } from "@roulterp/db";
import { SESSION_COOKIE, cookieOptions, SESSION_TTL_MS } from "@roulterp/core/auth";
import {
  cargarSesion, puede, exigirPermiso, type Permiso, type SesionActiva,
} from "@roulterp/servicios";
import { conexionApp, entornoAuth, esProduccion } from "./entorno";
// Se reexporta para no obligar a cada acción a importar de dos sitios.
import { NoAutorizado } from "./errores";

/**
 * `cache` de React deduplica la carga dentro de una misma petición: el layout,
 * la página y tres componentes pueden pedir la sesión y sólo se resuelve una
 * vez.
 */
export const sesionActual = cache(async (): Promise<SesionActiva | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? cargarSesion(entornoAuth, token) : null;
});

/** Exige sesión. Redirige al login si no la hay. */
export async function exigirSesion(): Promise<SesionActiva> {
  const s = await sesionActual();
  if (!s) redirect("/entrar");
  return s;
}

/** Exige sesión y empresa elegida. */
export async function exigirEmpresa(): Promise<SesionActiva & { empresaId: string }> {
  const s = await exigirSesion();
  if (!s.empresaId) redirect("/empresas");
  return s as SesionActiva & { empresaId: string };
}

/**
 * Ejecuta trabajo contra la base con el contexto de la empresa activa.
 *
 * Si se indica un permiso, se verifica antes de abrir la transacción: no tiene
 * sentido gastar una conexión en una operación que va a rechazarse.
 */
export async function conEmpresa<T>(
  trabajo: (db: Db, sesion: SesionActiva & { empresaId: string }) => Promise<T>,
  permiso?: Permiso,
): Promise<T> {
  const sesion = await exigirEmpresa();
  if (permiso && !puede(sesion.actor, sesion.empresaId, permiso)) {
    throw new NoAutorizado(permiso);
  }
  return enEmpresa(
    conexionApp,
    { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
    (db) => trabajo(db, sesion),
  );
}

/**
 * Exige sesión, empresa **y permiso**, sin abrir una transacción.
 *
 * `conEmpresa` ya comprueba el permiso, pero no sirve para todo: hablar con
 * SUNAT tarda y no puede retener una conexión del pool, así que esas acciones
 * reciben la conexión y abren sus propias transacciones cortas. Al hacerlo se
 * saltaban `conEmpresa` y, con él, la comprobación del permiso: quedaban
 * protegidas por RLS —veían sólo su empresa— pero cualquiera con sesión podía
 * dispararlas, incluido el rol de sólo consulta.
 *
 * Eso importa más aquí que en otros sitios: informar a SUNAT es un acto hacia
 * fuera y no se deshace. Una vez aceptado, está declarado.
 */
export async function exigirEmpresaCon(
  permiso: Permiso,
): Promise<SesionActiva & { empresaId: string }> {
  const sesion = await exigirEmpresa();
  if (!puede(sesion.actor, sesion.empresaId, permiso)) throw new NoAutorizado(permiso);
  return sesion;
}

/** ¿Puede el usuario actual hacer esto en la empresa activa? Para ocultar botones. */
export async function tienePermiso(permiso: Permiso): Promise<boolean> {
  const s = await sesionActual();
  return !!s?.empresaId && puede(s.actor, s.empresaId, permiso);
}

export async function ponerCookieSesion(token: string): Promise<void> {
  const opciones = cookieOptions(SESSION_TTL_MS);
  (await cookies()).set(SESSION_COOKIE, token, {
    ...opciones,
    // En desarrollo se sirve por HTTP; exigir `secure` impediría entrar.
    secure: esProduccion,
  });
}

export async function borrarCookieSesion(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export { NoAutorizado, exigirPermiso, type Permiso, type SesionActiva };
