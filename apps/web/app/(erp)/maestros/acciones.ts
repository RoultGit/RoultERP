"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { ZodError } from "zod";
import {
  guardarProducto, guardarTercero, desactivarProducto, guardarSucursal,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto, marcado } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

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
const mensaje = (e: unknown) => traducirError(e, { contexto: "el alta de maestros" });

/**
 * Alta y edición de una sucursal.
 *
 * Sin esta pantalla la sucursal se creaba junto con la empresa y ya no había
 * forma de completarla: el ubigeo quedaba vacío para siempre y cada guía de
 * remisión obligaba a teclear el punto de partida a mano.
 */
export async function guardarSucursalAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = texto(form, "id") || undefined;
  try {
    await conEmpresa(
      (db, sesion) =>
        guardarSucursal(db, sesion.empresaId, sesion.usuarioId, {
          ...(id ? { id } : {}),
          codigo: texto(form, "codigo"),
          nombre: texto(form, "nombre"),
          direccion: texto(form, "direccion"),
          ubigeo: texto(form, "ubigeo"),
          codigoSunat: texto(form, "codigoSunat"),
        }),
      id ? "maestros:editar" : "maestros:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/maestros/almacenes");
  redirect("/maestros/almacenes?hecho=sucursal" as Route);
}
