"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  analizarApertura, registrarApertura,
  type AnalisisApertura, type HojasApertura,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type EstadoApertura = EstadoForm & {
  hojas?: HojasApertura;
  fecha?: string;
  analisis?: AnalisisApertura;
};

const hojasDe = (form: FormData): HojasApertura => ({
  cxc: String(form.get("cxc") ?? ""),
  cxp: String(form.get("cxp") ?? ""),
  stock: String(form.get("stock") ?? ""),
});

export async function analizarAccion(
  _previo: EstadoApertura,
  form: FormData,
): Promise<EstadoApertura> {
  const hojas = hojasDe(form);
  const fecha = texto(form, "fecha");
  try {
    const analisis = await conEmpresa(
      (db, s) => analizarApertura(db, s.empresaId, hojas),
      "maestros:ver",
    );
    return { hojas, fecha, analisis };
  } catch (e) {
    return { hojas, fecha, ...traducirError(e, { contexto: "el análisis de los saldos de apertura" }) };
  }
}

/**
 * Carga los saldos. Una sola vez y todo junto.
 *
 * Vuelve a analizar en lugar de fiarse de lo que llegó del navegador: cuesta
 * una consulta y evita que un cuerpo fabricado a mano —o un maestro que cambió
 * mientras el cuadro estaba abierto— acabe en el balance de apertura.
 */
export async function cargarAccion(
  _previo: EstadoApertura,
  form: FormData,
): Promise<EstadoApertura> {
  const hojas = hojasDe(form);
  const fecha = texto(form, "fecha");
  try {
    await conEmpresa(
      (db, s) =>
        registrarApertura(db, s.empresaId, s.usuarioId, hojas, {
          fecha,
          ...(texto(form, "glosa") ? { glosa: texto(form, "glosa") } : {}),
        }),
      "maestros:editar",
    );
  } catch (e) {
    return { hojas, fecha, ...traducirError(e, { contexto: "la carga de saldos de apertura" }) };
  }
  // La apertura toca todo: cartera, deuda, almacén y balance.
  for (const r of ["/cxc", "/cxp", "/inventario", "/contabilidad", "/maestros/apertura"]) {
    revalidatePath(r);
  }
  redirect("/maestros/apertura?hecho=1" as Route);
}
