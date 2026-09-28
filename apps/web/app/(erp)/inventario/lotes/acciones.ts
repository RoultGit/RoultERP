"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { guardarLote } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function guardarLoteAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarLote(db, s.empresaId, s.usuarioId, {
          productoId: texto(form, "productoId"),
          codigo: texto(form, "codigo"),
          ...(texto(form, "fechaFabricacion")
            ? { fechaFabricacion: texto(form, "fechaFabricacion") }
            : {}),
          ...(texto(form, "fechaVencimiento")
            ? { fechaVencimiento: texto(form, "fechaVencimiento") }
            : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "inventario:editar",
    );
  } catch (e) {
    return traducirError(e, { contexto: "lotes y series" });
  }
  revalidatePath("/inventario/lotes");
  redirect(`/inventario/lotes?hecho=${encodeURIComponent("Lote guardado.")}` as Route);
}
