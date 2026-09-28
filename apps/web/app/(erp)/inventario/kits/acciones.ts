"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  definirComposicion, armar, desarmar, type LineaComposicion,
} from "@roulterp/servicios";

import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "kits y composiciones" });

export async function definirAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const lineas: LineaComposicion[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`lineas[${i}].cantidad`);
    if (marca === null) break;
    const cantidad = String(marca).trim();
    const componenteId = texto(form, `lineas[${i}].componenteId`);
    if (!componenteId || cantidad === "") continue;
    lineas.push({ componenteId, cantidad });
  }
  if (lineas.length === 0) return { error: "Agregue al menos un componente." };

  const productoId = texto(form, "productoId");
  try {
    await conEmpresa(
      (db, s) =>
        definirComposicion(db, s.empresaId, s.usuarioId, productoId, texto(form, "tipo"), lineas),
      "inventario:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/inventario/kits");
  redirect(
    `/inventario/kits?producto=${productoId}&hecho=${encodeURIComponent("Composición guardada.")}` as Route,
  );
}

export async function procesarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const desarma = texto(form, "operacion") === "desarmar";
  let numero: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        (desarma ? desarmar : armar)(db, s.empresaId, s.usuarioId, {
          productoId: texto(form, "productoId"),
          cantidad: texto(form, "cantidad") || "0",
          fecha: texto(form, "fecha"),
          almacenId: texto(form, "almacenId"),
          ...(texto(form, "glosa") ? { glosa: texto(form, "glosa") } : {}),
        }),
      "inventario:crear",
    );
    numero = r.numero;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/inventario");
  revalidatePath("/inventario/kits");
  revalidatePath("/inventario/notas");
  redirect(
    `/inventario/kits?hecho=${encodeURIComponent(
      `${desarma ? "Desarmado" : "Armado"} ${numero} registrado.`,
    )}` as Route,
  );
}
