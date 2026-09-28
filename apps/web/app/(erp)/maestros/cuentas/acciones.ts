"use server";

import { revalidatePath } from "next/cache";
import { sincronizarPlanCuentas } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

/**
 * Pone al día el plan de cuentas de la empresa.
 *
 * El plan se siembra al dar de alta la empresa; cuando el catálogo crece, las
 * empresas ya existentes se quedan atrás y descubren que les falta una cuenta
 * el día que intentan asentar la planilla. Esto lo reconcilia sin tocar lo que
 * la empresa haya añadido por su cuenta.
 */
export async function sincronizarAccion(
  _previo: EstadoForm,
  _form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, s) => sincronizarPlanCuentas(db, s.empresaId),
      "maestros:editar",
    );
    revalidatePath("/maestros/cuentas");
    return {
      exito:
        r.agregadas.length === 0
          ? "El plan ya estaba al día."
          : `Se añadieron ${r.agregadas.length} cuentas: ${r.agregadas.slice(0, 8).join(", ")}${
              r.agregadas.length > 8 ? "…" : ""
            }`,
    };
  } catch (e) {
    return traducirError(e, { contexto: "la sincronización del plan de cuentas" });
  }
}
