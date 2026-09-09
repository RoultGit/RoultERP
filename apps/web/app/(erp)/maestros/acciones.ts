"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { ZodError } from "zod";
import { guardarProducto, guardarTercero, desactivarProducto, MaestroInvalido } from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

export type EstadoForm = { error?: string; campo?: string; exito?: string };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const marcado = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

export async function guardarProductoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = texto(form, "id") || undefined;
  try {
    await conEmpresa(
      (db, sesion) =>
        guardarProducto(
          db,
          sesion.empresaId,
          {
            codigo: texto(form, "codigo"),
            descripcion: texto(form, "descripcion"),
            unidadId: texto(form, "unidadId"),
            tipo: texto(form, "tipo") === "servicio" ? "servicio" : "bien",
            afectacionIgv: texto(form, "afectacionIgv"),
            codigoSunat: texto(form, "codigoSunat"),
            partidaArancelaria: texto(form, "partidaArancelaria"),
            pesoUnitario: texto(form, "pesoUnitario"),
            volumenUnitario: texto(form, "volumenUnitario"),
            stockMinimo: texto(form, "stockMinimo"),
            controlLote: marcado(form, "controlLote"),
            controlSerie: marcado(form, "controlSerie"),
          },
          id,
        ),
      id ? "maestros:editar" : "maestros:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/maestros/productos");
  redirect("/maestros/productos" as Route);
}

export async function guardarTerceroAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = texto(form, "id") || undefined;
  try {
    await conEmpresa(
      (db, sesion) =>
        guardarTercero(
          db,
          sesion.empresaId,
          {
            tipoDocumento: texto(form, "tipoDocumento") as "6",
            numeroDocumento: texto(form, "numeroDocumento"),
            razonSocial: texto(form, "razonSocial"),
            nombreComercial: texto(form, "nombreComercial"),
            direccion: texto(form, "direccion"),
            pais: texto(form, "pais") || "PE",
            email: texto(form, "email"),
            telefono: texto(form, "telefono"),
            esCliente: marcado(form, "esCliente"),
            esProveedor: marcado(form, "esProveedor"),
            esDomiciliado: marcado(form, "esDomiciliado"),
            diasCredito: Number(texto(form, "diasCredito") || "0"),
            limiteCredito: texto(form, "limiteCredito"),
            monedaLimite: texto(form, "monedaLimite") || "PEN",
          },
          id,
        ),
      id ? "maestros:editar" : "maestros:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/maestros/terceros");
  redirect("/maestros/terceros" as Route);
}

export async function desactivarProductoAccion(form: FormData): Promise<void> {
  const id = texto(form, "id");
  await conEmpresa((db) => desactivarProducto(db, id), "maestros:anular");
  revalidatePath("/maestros/productos");
}

/**
 * Convierte el error en algo accionable.
 *
 * De un ZodError se rescata el primer mensaje y el campo que lo produjo, para
 * poder resaltarlo en el formulario. Los errores inesperados van al registro
 * del servidor: el navegador sólo ve una frase genérica.
 */
function mensaje(e: unknown): EstadoForm {
  if (e instanceof NoAutorizado) return { error: "No tiene permiso para esta operación." };
  if (e instanceof MaestroInvalido) return { error: e.message };
  if (e instanceof ZodError) {
    const primero = e.issues[0];
    return {
      error: primero?.message ?? "Revise los datos ingresados.",
      ...(primero?.path[0] ? { campo: String(primero.path[0]) } : {}),
    };
  }
  console.error("error al guardar el maestro", e);
  return { error: "No se pudo guardar. Revise los datos e intente de nuevo." };
}
