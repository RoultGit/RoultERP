/**
 * Control documental de una importación.
 *
 * Es lo que el cliente pidió en la pregunta 17: hoy lleva a mano, sobre la
 * orden de importación, qué papeles ha recibido de cada embarque. El registro
 * no es lo que cuesta; lo que cuesta es que nadie se entere de que falta algo
 * hasta que la agencia lo pide y el contenedor ya está devengando almacenaje.
 *
 * El catálogo de documentos exigibles vive en el dominio
 * (`core/importaciones`), no aquí ni en base. Este módulo sólo hace dos cosas:
 * guardar lo que llegó y decir, cruzando el catálogo con el estado del
 * embarque, qué falta **ya** y qué falta **aún**. Son dos avisos distintos
 * porque llevan a dos acciones distintas: perseguir a alguien hoy, o esperar.
 */
import { and, asc, eq } from "drizzle-orm";
import { ErrorDeNegocio } from "@roulterp/core";
import {
  DOCUMENTOS_IMPORTACION, expediente, tipoDocumentoImportacion, HITOS,
  type TipoDocumentoImportacion,
} from "@roulterp/core/importaciones";
import { schema as s, type Db } from "@roulterp/db";

const { importacionDocumentos, importaciones } = s;

export class DocumentoInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "DocumentoInvalido");
  }
}

/**
 * Hasta qué hito ha llegado el embarque según su estado.
 *
 * Esta correspondencia es la que convierte la lista en un aviso. Vive aquí y no
 * en el dominio porque los estados son de este servicio: el catálogo de
 * documentos no tiene por qué saber que existe «en_aduana».
 */
const HITO_POR_ESTADO: Record<string, (typeof HITOS)[number]> = {
  borrador: "embarque",
  aprobada: "embarque",
  en_transito: "embarque",
  en_aduana: "llegada",
  nacionalizada: "numeracion",
  liquidada: "liquidacion",
};

export type FilaExpediente = TipoDocumentoImportacion & {
  recibidoEn: string | null;
  referencia: string | null;
  noAplica: boolean;
  observaciones: string | null;
  /** Ya hacía falta y no está. Es la única columna que cuesta dinero. */
  vencido: boolean;
};

export type Expediente = {
  filas: readonly FilaExpediente[];
  /** Los que ya hacían falta. Se enseñan arriba y en rojo. */
  vencidos: readonly TipoDocumentoImportacion[];
  pendientes: readonly TipoDocumentoImportacion[];
  completo: boolean;
  hito: (typeof HITOS)[number];
};

/** El expediente de un embarque: el catálogo cruzado con lo que se registró. */
export async function expedienteDe(db: Db, importacionId: string): Promise<Expediente> {
  const [cab] = await db
    .select({ estado: importaciones.estado })
    .from(importaciones)
    .where(eq(importaciones.id, importacionId))
    .limit(1);
  if (!cab) throw new DocumentoInvalido(["la importación no existe"]);

  const registrados = await db
    .select()
    .from(importacionDocumentos)
    .where(eq(importacionDocumentos.importacionId, importacionId))
    .orderBy(asc(importacionDocumentos.tipo));

  // Una importación anulada no espera nada de nadie.
  const hito = HITO_POR_ESTADO[cab.estado] ?? "embarque";
  const resumen = expediente(
    registrados.map((r) => ({ tipo: r.tipo, recibidoEn: r.recibidoEn, noAplica: r.noAplica })),
    hito,
  );
  const vencidos = new Set(resumen.vencidos.map((d) => d.clave));
  const porTipo = new Map(registrados.map((r) => [r.tipo, r]));

  return {
    hito,
    vencidos: resumen.vencidos,
    pendientes: resumen.pendientes,
    completo: resumen.completo,
    filas: DOCUMENTOS_IMPORTACION.map((doc) => {
      const fila = porTipo.get(doc.clave);
      return {
        ...doc,
        recibidoEn: fila?.recibidoEn ?? null,
        referencia: fila?.referencia ?? null,
        noAplica: fila?.noAplica ?? false,
        observaciones: fila?.observaciones ?? null,
        vencido: vencidos.has(doc.clave),
      };
    }),
  };
}

export type DatosDocumento = {
  importacionId: string;
  tipo: string;
  /** Vacío deja el documento como pendiente sin borrar lo demás. */
  recibidoEn?: string;
  referencia?: string;
  noAplica?: boolean;
  observaciones?: string;
};

/**
 * Anota o corrige un documento del expediente.
 *
 * Es un `upsert` por (importación, tipo) y no un insert: el flujo real es
 * «anoto que espero el B/L» y días después «ya llegó, con este número». Dos
 * filas del mismo tipo dejarían el cuadro diciendo que el packing list llegó y
 * no llegó a la vez, y el índice único lo impide de todos modos.
 */
export async function registrarDocumento(
  db: Db,
  empresaId: string,
  usuarioId: string,
  datos: DatosDocumento,
): Promise<void> {
  const motivos: string[] = [];
  if (!datos.importacionId) motivos.push("indique la importación");
  if (!tipoDocumentoImportacion(datos.tipo)) {
    motivos.push(`«${datos.tipo}» no es un documento de importación conocido`);
  }
  // Un documento no puede estar recibido y no aplicable a la vez: es la
  // contradicción que deja el cuadro sin saber qué contar.
  if (datos.noAplica && datos.recibidoEn) {
    motivos.push("un documento marcado como no aplicable no puede tener fecha de recepción");
  }
  if (motivos.length) throw new DocumentoInvalido(motivos);

  const valores = {
    recibidoEn: datos.recibidoEn || null,
    referencia: datos.referencia?.trim() || null,
    noAplica: datos.noAplica ?? false,
    observaciones: datos.observaciones?.trim() || null,
  };

  await db
    .insert(importacionDocumentos)
    .values({ empresaId, importacionId: datos.importacionId, tipo: datos.tipo, creadoPor: usuarioId, ...valores })
    .onConflictDoUpdate({
      target: [importacionDocumentos.importacionId, importacionDocumentos.tipo],
      set: { ...valores, actualizadoEn: new Date() },
    });
}

/** Quita la anotación, que no es lo mismo que marcarla como no aplicable. */
export async function olvidarDocumento(
  db: Db,
  importacionId: string,
  tipo: string,
): Promise<void> {
  await db
    .delete(importacionDocumentos)
    .where(
      and(
        eq(importacionDocumentos.importacionId, importacionId),
        eq(importacionDocumentos.tipo, tipo),
      ),
    );
}
