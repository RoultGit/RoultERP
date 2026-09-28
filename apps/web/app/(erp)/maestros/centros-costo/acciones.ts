"use server";

import { revalidatePath } from "next/cache";
import { guardarCentroCosto } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function guardarCentroAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarCentroCosto(db, s.empresaId, {
          ...(texto(form, "id") ? { id: texto(form, "id") } : {}),
          codigo: texto(form, "codigo"),
          nombre: texto(form, "nombre"),
          ...(form.has("activo") ? { activo: form.get("activo") === "1" } : {}),
        }),
      "maestros:editar",
    );
  } catch (e) {
    return traducirError(e, {
      contexto: "centros de costo",
      choques: [[/centros_costo_uk|duplicate key/, "Ya existe un centro de costo con ese código."]],
    });
  }
  revalidatePath("/maestros/centros-costo");
  return { exito: "Centro de costo guardado." };
}
