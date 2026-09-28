"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { registrarNota, type LineaNota } from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "notas de almacén" });

/** Artículos de la nota. Mismo esquema de nombres que las demás capturas. */
function leerLineas(form: FormData): LineaNota[] {
  const lineas: LineaNota[] = [];
  for (const campo of filas(form, "cantidad")) {
    const cantidad = campo("cantidad");
    const productoId = campo("productoId");
    if (!productoId || cantidad === "") continue;
    lineas.push({
      productoId,
      cantidad,
      ...(campo("costoUnitario")
        ? { costoUnitario: campo("costoUnitario") }
        : {}),
      ...(campo("lote") ? { lote: campo("lote") } : {}),
    });
  }
  return lineas;
}

export async function registrarNotaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos un artículo." };

  const tipo = texto(form, "tipo");
  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        registrarNota(db, s.empresaId, s.usuarioId, {
          tipo,
          fecha: texto(form, "fecha"),
          almacenId: texto(form, "almacenId"),
          glosa: texto(form, "glosa"),
          lineas,
          ...(texto(form, "almacenDestinoId")
            ? { almacenDestinoId: texto(form, "almacenDestinoId") }
            : {}),
          ...(texto(form, "cuentaContrapartida")
            ? { cuentaContrapartida: texto(form, "cuentaContrapartida") }
            : {}),
          ...(texto(form, "centroCostoId") ? { centroCostoId: texto(form, "centroCostoId") } : {}),
          ...(texto(form, "terceroId") ? { terceroId: texto(form, "terceroId") } : {}),
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
          ...(texto(form, "sentidoAjuste")
            ? { sentidoAjuste: texto(form, "sentidoAjuste") as "ingreso" | "salida" }
            : {}),
        }),
      "inventario:crear",
    );
    id = r.notaId;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/inventario");
  revalidatePath("/inventario/notas");
  revalidatePath("/contabilidad");
  redirect(`/inventario/notas?nota=${id}` as Route);
}
