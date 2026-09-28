/**
 * La cola de envío a SUNAT.
 *
 * SUNAT tarda lo que tarda —normalmente unos segundos, hasta un minuto en un
 * mal día— y eso no está en nuestras manos. Lo que sí está es que nadie espere
 * mirando una pantalla, y ahí es donde hace falta una cola.
 *
 * **La cola es la propia tabla de comprobantes, no un servicio aparte.** Un
 * comprobante en `borrador`, `firmado` o `enviado` es, por definición, uno que
 * falta por informar; SQS no añadiría nada y sí añadiría un componente que
 * desplegar, pagar y vigilar. Además la base es la única fuente de verdad: con
 * una cola externa, un mensaje perdido deja un comprobante sin declarar y nadie
 * se entera hasta la fiscalización.
 *
 * Tres reglas la gobiernan:
 *
 * **Uno por transacción.** Cada comprobante se envía y se guarda por separado.
 * Si el número doce falla, los once anteriores ya están declarados.
 *
 * **Espera creciente.** Reintentar cada segundo contra un servicio caído sólo
 * consigue que SUNAT corte por abuso. La espera dobla en cada fallo, desde un
 * minuto hasta una hora.
 *
 * **Lo que falla muchas veces deja de reintentarse y se denuncia.** Un
 * comprobante con un RUC inválido no va a entrar nunca por mucho que se
 * insista: a partir del octavo intento sale de la cola y aparece en la lista de
 * los que necesitan una persona. Reintentarlo para siempre escondería el
 * problema en el registro.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ErrorSunat } from "@roulterp/core/cpe";
import { schema as s, enEmpresa, type Conexion } from "@roulterp/db";
import { enviarASunat } from "./ventas.ts";

const { comprobantes } = s;

/** Estados que significan «todavía no está declarado». */
const PENDIENTES = ["borrador", "firmado", "enviado"] as const;

/**
 * A partir de aquí no se reintenta solo.
 *
 * Ocho intentos con espera creciente cubren unas dos horas de caída de SUNAT,
 * que es más de lo que duran sus incidencias habituales. Lo que sigue fallando
 * después ya no es una caída: es un dato que hay que corregir.
 */
export const MAX_INTENTOS = 8;

/** Espera antes del siguiente intento: 1, 2, 4… minutos, con tope de una hora. */
export function esperaTrasFallo(intentos: number): number {
  return Math.min(2 ** Math.max(0, intentos - 1), 60) * 60_000;
}

export type ResultadoCola = {
  intentados: number;
  aceptados: number;
  rechazados: number;
  /** Fallos temporales: siguen en la cola con su espera. */
  reprogramados: number;
  /** Agotaron los intentos. Necesitan que alguien los mire. */
  atascados: number;
};

/**
 * Envía los comprobantes que están esperando turno.
 *
 * Recibe cómo abrir transacciones y no una ya abierta: cada envío necesita la
 * suya, y hablar con SUNAT no puede retener una conexión del pool mientras
 * tanto.
 *
 * `limite` acota cuánto trabajo hace una pasada. Sin él, la primera ejecución
 * después de una caída larga intentaría vaciar la cola entera en una sola
 * petición y se cortaría por tiempo a la mitad.
 */
export async function enviarPendientes(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  kek: Uint8Array,
  opciones: { limite?: number; ahora?: Date; fetchImpl?: typeof fetch } = {},
): Promise<ResultadoCola> {
  const ahora = opciones.ahora ?? new Date();
  const limite = opciones.limite ?? 10;

  const turno = await enEmpresa(conexion, ctx, (db) =>
    db
      .select({ id: comprobantes.id, intentos: comprobantes.intentosEnvio })
      .from(comprobantes)
      .where(
        and(
          inArray(comprobantes.estado, [...PENDIENTES]),
          // Lo migrado de otro sistema no se envía: ya se declaró allá.
          eq(comprobantes.esApertura, false),
          sql`${comprobantes.intentosEnvio} < ${MAX_INTENTOS}`,
          or(isNull(comprobantes.reintentarDesde), lte(comprobantes.reintentarDesde, ahora)),
        ),
      )
      // Los más antiguos primero: el correlativo se informa en orden.
      .orderBy(asc(comprobantes.fechaEmision), asc(comprobantes.numero))
      .limit(limite),
  );

  const r: ResultadoCola = {
    intentados: 0, aceptados: 0, rechazados: 0, reprogramados: 0, atascados: 0,
  };

  for (const fila of turno) {
    r.intentados++;
    try {
      const envio = await enviarASunat(conexion, ctx, fila.id, kek, {
        ...(opciones.fetchImpl ? { fetchImpl: opciones.fetchImpl } : {}),
      });
      // Aceptado o rechazado, SUNAT ya respondió: sale de la cola. Un rechazo
      // se corrige con una nota o una baja, no reenviando lo mismo.
      if (envio.estado === "rechazado") r.rechazados++;
      else r.aceptados++;
      await enEmpresa(conexion, ctx, (db) =>
        db
          .update(comprobantes)
          .set({ ultimoError: null, reintentarDesde: null })
          .where(eq(comprobantes.id, fila.id)),
      );
    } catch (e) {
      // Sólo los fallos del servicio vuelven a la cola. Un error del programa
      // no se arregla esperando, así que también consume intento y acaba
      // saliendo a la lista de los que hay que mirar.
      const temporal = e instanceof ErrorSunat && e.reintentable;
      const intentos = fila.intentos + 1;
      const agotado = intentos >= MAX_INTENTOS;
      if (agotado) r.atascados++;
      else r.reprogramados++;

      await enEmpresa(conexion, ctx, (db) =>
        db
          .update(comprobantes)
          .set({
            intentosEnvio: intentos,
            ultimoError: e instanceof Error ? e.message.slice(0, 500) : "error desconocido",
            reintentarDesde: agotado
              ? null
              : new Date(ahora.getTime() + esperaTrasFallo(temporal ? intentos : MAX_INTENTOS)),
          })
          .where(eq(comprobantes.id, fila.id)),
      );
    }
  }

  return r;
}

export type EnLaCola = {
  id: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  total: string;
  estado: string;
  intentos: number;
  ultimoError: string | null;
  reintentarDesde: Date | null;
  /** Agotó los intentos: no se reintentará solo. */
  atascado: boolean;
};

/**
 * Qué hay en la cola ahora mismo.
 *
 * Los atascados van primero: son los que necesitan que alguien haga algo, y
 * son justamente los que se perderían al final de una lista larga.
 */
export async function estadoDeLaCola(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
): Promise<EnLaCola[]> {
  const filas = await enEmpresa(conexion, ctx, (db) =>
    db
      .select({
        id: comprobantes.id,
        serie: comprobantes.serie,
        numero: comprobantes.numero,
        fechaEmision: comprobantes.fechaEmision,
        total: comprobantes.total,
        estado: comprobantes.estado,
        intentos: comprobantes.intentosEnvio,
        ultimoError: comprobantes.ultimoError,
        reintentarDesde: comprobantes.reintentarDesde,
      })
      .from(comprobantes)
      .where(
        and(
          inArray(comprobantes.estado, [...PENDIENTES]),
          eq(comprobantes.esApertura, false),
        ),
      )
      .orderBy(asc(comprobantes.fechaEmision), asc(comprobantes.numero)),
  );

  return filas
    .map((f) => ({ ...f, atascado: f.intentos >= MAX_INTENTOS }))
    .sort((a, b) => Number(b.atascado) - Number(a.atascado));
}

/** Devuelve a la cola algo que se había atascado, después de corregirlo. */
export async function reencolar(
  conexion: Conexion,
  ctx: { empresaId: string; usuarioId: string },
  comprobanteId: string,
): Promise<void> {
  await enEmpresa(conexion, ctx, (db) =>
    db
      .update(comprobantes)
      .set({ intentosEnvio: 0, ultimoError: null, reintentarDesde: null })
      .where(eq(comprobantes.id, comprobanteId)),
  );
}
