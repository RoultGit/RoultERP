"use server";

import { revalidatePath } from "next/cache";
import { guardarAjustesEmpresa } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, marcado, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function guardarEmpresaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarAjustesEmpresa(db, s.empresaId, {
          nombreComercial: texto(form, "nombreComercial"),
          direccion: texto(form, "direccion"),
          ubigeo: texto(form, "ubigeo"),
          cuentaDetracciones: texto(form, "cuentaDetracciones"),
          metodoValorizacion: texto(form, "metodoValorizacion") as "promedio" | "peps",
          redondeoDetraccion: texto(form, "redondeoDetraccion") as "cercano" | "arriba",
          esAgenteRetencion: marcado(form, "esAgenteRetencion"),
          esAgentePercepcion: marcado(form, "esAgentePercepcion"),
        }),
      "maestros:editar",
    );
  } catch (e) {
    return traducirError(e, { contexto: "los datos de la empresa" });
  }
  // La cuenta de detracciones y la razón social salen en las hojas impresas, y
  // el método de valorización decide cómo se costea cada salida de almacén.
  revalidatePath("/maestros/empresa");
  revalidatePath("/ventas");
  revalidatePath("/inventario");
  return { exito: "Datos de la empresa guardados." };
}
