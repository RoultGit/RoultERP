"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { guardarParametrosContables, PARAMETROS_CONTABLES } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function guardarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  // Se envían todas las claves del catálogo, no sólo las tocadas: el servicio
  // se encarga de borrar la excepción cuando el valor vuelve a ser el de
  // partida, y así no hay que llevar la cuenta de qué cambió en la pantalla.
  const cambios: Record<string, string> = {};
  for (const p of PARAMETROS_CONTABLES) {
    const valor = String(form.get(p.clave) ?? "").trim();
    if (valor) cambios[p.clave] = valor;
  }

  try {
    await conEmpresa(
      (db, s) => guardarParametrosContables(db, s.empresaId, s.usuarioId, cambios),
      "contabilidad:editar",
    );
  } catch (e) {
    return traducirError(e, { contexto: "los parámetros contables" });
  }
  revalidatePath("/contabilidad/parametros");
  redirect("/contabilidad/parametros?hecho=1" as Route);
}
