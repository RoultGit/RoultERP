"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { girarCheque, cambiarEstadoCheque } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "cheques girados",
  choques: [
    [/cheques_uk|duplicate key/, "Esa cuenta ya tiene un cheque con ese número."],
  ],
});

export async function girarChequeAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        girarCheque(db, s.empresaId, s.usuarioId, {
          cuentaId: texto(form, "cuentaId"),
          numero: texto(form, "numero"),
          fechaGiro: texto(form, "fechaGiro"),
          importe: texto(form, "importe") || "0",
          ...(texto(form, "fechaCobro") ? { fechaCobro: texto(form, "fechaCobro") } : {}),
          ...(texto(form, "beneficiarioId")
            ? { beneficiarioId: texto(form, "beneficiarioId") }
            : {}),
          ...(texto(form, "beneficiario") ? { beneficiario: texto(form, "beneficiario") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "caja_bancos:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/caja-bancos/cheques");
  redirect(`/caja-bancos/cheques?hecho=${encodeURIComponent("Cheque girado.")}` as Route);
}

export async function cambiarEstadoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const nuevo = texto(form, "estado");
  try {
    await conEmpresa(
      (db) =>
        cambiarEstadoCheque(db, texto(form, "chequeId"), nuevo, {
          ...(texto(form, "fechaCobrado") ? { fechaCobrado: texto(form, "fechaCobrado") } : {}),
        }),
      "caja_bancos:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/caja-bancos/cheques");
  redirect(`/caja-bancos/cheques?hecho=${encodeURIComponent(`Cheque ${nuevo}.`)}` as Route);
}
