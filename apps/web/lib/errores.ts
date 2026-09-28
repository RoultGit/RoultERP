/**
 * Traducción de errores a lo que lee la persona que está delante.
 *
 * Antes cada módulo llevaba su propia función `mensaje()` —veintinueve copias
 * casi iguales— con su lista de clases enumeradas a mano. Eso tenía dos
 * defectos que no se ven hasta que muerden: el módulo nuevo empezaba copiando
 * la del vecino y se dejaba alguna clase fuera, así que su error salía por la
 * rama genérica y el usuario leía «revise los datos» sin saber cuál; y
 * arreglar el texto del permiso obligaba a tocar veintinueve archivos.
 *
 * Ahora hay una sola, y decide por la **raíz** del error, no por su clase:
 * cualquier `ErrorDeNegocio` se muestra tal cual, venga del módulo que venga y
 * se haya escrito hoy o el año que viene.
 *
 * Lo que nunca sale a la pantalla es lo que no se reconoce. Un fallo de la base
 * o un `TypeError` van al registro del servidor con su contexto y el usuario ve
 * una frase genérica: el detalle no le sirve para nada y puede llevar dentro un
 * nombre de tabla, una consulta o parte de una clave.
 */
import { ErrorDeNegocio } from "@roulterp/core";
import { SinPermiso } from "@roulterp/core/auth";
import { ErrorSunat } from "@roulterp/core/cpe";
import { ZodError } from "zod";
import type { Permiso } from "@roulterp/servicios";
import type { EstadoForm } from "./formulario";

/**
 * El usuario tiene sesión y empresa, pero no este permiso.
 *
 * Vive aquí y no en `sesion.ts` para que traducir errores no arrastre
 * `next/headers`: así este módulo lo puede usar cualquier capa.
 */
export class NoAutorizado extends Error {
  constructor(readonly permiso: Permiso) {
    super("no tiene permiso para esta operación");
    this.name = "NoAutorizado";
  }
}

export type OpcionesMensaje = {
  /**
   * Qué se estaba haciendo. Sólo se usa en el registro del servidor cuando el
   * error no se reconoce, que es justo cuando hace falta saberlo.
   */
  contexto: string;
  /**
   * Traducciones de los índices únicos del módulo; gana la primera que case.
   * Postgres dice «duplicate key value violates unique constraint
   * "compras_uk"», y eso no es una frase que nadie deba leer.
   */
  choques?: readonly (readonly [RegExp, string])[];
  /**
   * Cómo llamar al documento en el aviso de SUNAT: «SUNAT rechazó la guía».
   * Por defecto, «el documento».
   */
  documento?: string;
};

const SIN_PERMISO = "No tiene permiso para esta operación.";
const GENERICO = "No se pudo completar la operación. Revise los datos e intente de nuevo.";

export function traducirError(e: unknown, opciones: OpcionesMensaje): EstadoForm {
  if (e instanceof NoAutorizado || e instanceof SinPermiso) return { error: SIN_PERMISO };

  if (e instanceof ErrorDeNegocio) {
    // La primera razón va arriba; la lista entera debajo. Quien carga una
    // factura con tres problemas prefiere verlos los tres de una vez que
    // descubrirlos de uno en uno, guardando entre medias.
    return { error: e.motivos[0]!, motivos: [...e.motivos] };
  }

  if (e instanceof ZodError) {
    const primero = e.issues[0];
    return {
      error: primero?.message ?? "Revise los datos ingresados.",
      ...(primero?.path[0] ? { campo: String(primero.path[0]) } : {}),
    };
  }

  if (e instanceof ErrorSunat) {
    // Que SUNAT no conteste no es culpa de quien factura, y se resuelve
    // reintentando; que rechace sí obliga a corregir. Son dos avisos distintos
    // porque llevan a dos acciones distintas.
    const doc = opciones.documento ?? "el documento";
    return {
      error: e.reintentable
        ? `SUNAT no respondió (${e.codigo}). ${doc[0]!.toUpperCase()}${doc.slice(1)} quedó registrado; reintente el envío en unos minutos.`
        : `SUNAT rechazó ${doc} con el error ${e.codigo}: ${e.message}`,
    };
  }

  if (e instanceof Error) {
    for (const [patron, texto] of opciones.choques ?? []) {
      if (patron.test(e.message)) return { error: texto };
    }
  }

  console.error(`error en ${opciones.contexto}`, e);
  return { error: GENERICO };
}

/** La misma decisión cuando quien llama sólo quiere la frase. */
export const fraseDeError = (e: unknown, opciones: OpcionesMensaje): string =>
  traducirError(e, opciones).error ?? GENERICO;
