import "server-only";

/**
 * Configuración y conexiones del proceso.
 *
 * Las variables se validan al arrancar y no al usarlas. Un despliegue sin la
 * clave maestra debe fallar en el primer arranque, no la primera vez que
 * alguien intente activar su segundo factor.
 *
 * Los pools son singletons a propósito: en el runtime de Node de Next, cada
 * módulo se evalúa una vez por proceso, y abrir un pool por petición agotaría
 * las conexiones de Postgres en minutos.
 */
import { conectar, type Conexion } from "@roulterp/db";
import { kekDesdeEntorno } from "@roulterp/core/auth";
import type { Entorno } from "@roulterp/servicios";

function exigir(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    throw new Error(
      `falta la variable de entorno ${nombre}. Copie .env.example a .env.local y complétela.`,
    );
  }
  return v;
}

export const DATABASE_URL = exigir("DATABASE_URL");

const { kek, kekId } = kekDesdeEntorno();

declare global {
  // eslint-disable-next-line no-var
  var __roulterp:
    | { app: Conexion; auth: Conexion }
    | undefined;
}

/**
 * En desarrollo, Next recarga los módulos en caliente y crearía un pool nuevo
 * en cada recarga. Guardarlos en `globalThis` evita quedarse sin conexiones a
 * los diez minutos de trabajo.
 */
/*
 * Tamaño del pool, configurable por entorno.
 *
 * En una máquina con un proceso, diez conexiones son holgura. En un entorno
 * sin servidor —Vercel, Lambda— hay un pool **por instancia**, y cada instancia
 * caliente reserva las suyas: con cinco instancias, quince conexiones cada una
 * son setenta y cinco, y ahí se agota el límite del servidor de base antes de
 * que haya usuarios de verdad.
 *
 * Por eso se puede bajar sin recompilar: `ROULTERP_POOL_MAX=2` en serverless.
 * El valor de partida, diez, es el correcto para un contenedor de larga vida.
 */
const POOL_MAX = Math.max(1, Number(process.env["ROULTERP_POOL_MAX"]) || 10);

const pools =
  globalThis.__roulterp ??
  (globalThis.__roulterp = {
    app: conectar({ url: DATABASE_URL, rol: "app", max: POOL_MAX }),
    // La de identidad trabaja sólo en el login: necesita menos.
    auth: conectar({ url: DATABASE_URL, rol: "auth", max: Math.max(1, Math.ceil(POOL_MAX / 2)) }),
  });

export const conexionApp = pools.app;
export const conexionAuth = pools.auth;

/** Entorno que espera el servicio de autenticación. */
export const entornoAuth: Entorno = { auth: conexionAuth, kek, kekId };

/**
 * Clave maestra de cifrado.
 *
 * La necesitan los módulos que custodian secretos por empresa —el certificado
 * digital y las credenciales SOL—. Se exporta desde aquí para que exista un
 * solo punto donde se lee del entorno, y nunca se registra ni se envía a
 * ninguna parte.
 */
export const kekMaestra = kek;
export const kekMaestraId = kekId;

export const esProduccion = process.env.NODE_ENV === "production";
