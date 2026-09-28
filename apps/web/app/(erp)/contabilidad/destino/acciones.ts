"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { guardarReglas, contabilizarDestino, type DatosRegla } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "el asiento de destino" });

export async function guardarReglasAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const reglas: DatosRegla[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`reglas[${i}].cuentaDestino`);
    if (marca === null) break;
    const cuentaDestino = String(marca).trim();
    if (!cuentaDestino) continue;
    reglas.push({
      cuentaDestino,
      ...(texto(form, `reglas[${i}].cuenta`) ? { cuenta: texto(form, `reglas[${i}].cuenta`) } : {}),
      ...(texto(form, `reglas[${i}].centroCostoId`)
        ? { centroCostoId: texto(form, `reglas[${i}].centroCostoId`) }
        : {}),
    });
  }

  try {
    await conEmpresa(
      (db, s) => guardarReglas(db, s.empresaId, s.usuarioId, reglas),
      "contabilidad:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/destino");
  redirect("/contabilidad/destino?hecho=reglas" as Route);
}

export async function contabilizarAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const periodo = texto(form, "periodo");
  let resultado: { asientoId: string | null; importe: string };
  try {
    resultado = await conEmpresa(
      (db, s) => contabilizarDestino(db, s.empresaId, s.usuarioId, periodo),
      "contabilidad:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/destino");
  revalidatePath("/contabilidad/estados");
  redirect(
    `/contabilidad/destino?periodo=${periodo}&hecho=${
      resultado.asientoId ? `destinado-${resultado.importe}` : "nada"
    }` as Route,
  );
}
