"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { recibirCheque, cambiarEstadoCheque } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "cheques recibidos",
  choques: [
    [/cheques_uk|duplicate key/, "Ya hay un cheque recibido con ese número en esa cuenta."],
  ],
});

export async function recibirAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        recibirCheque(db, s.empresaId, s.usuarioId, {
          cuentaId: texto(form, "cuentaId"),
          numero: texto(form, "numero"),
          fechaGiro: texto(form, "fechaGiro"),
          importe: texto(form, "importe") || "0",
          ...(texto(form, "fechaCobro") ? { fechaCobro: texto(form, "fechaCobro") } : {}),
          ...(texto(form, "clienteId") ? { clienteId: texto(form, "clienteId") } : {}),
          ...(texto(form, "girador") ? { girador: texto(form, "girador") } : {}),
          ...(texto(form, "bancoGirador") ? { bancoGirador: texto(form, "bancoGirador") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "cxc:crear",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxc/cheques");
  redirect(`/cxc/cheques?hecho=${encodeURIComponent("Cheque registrado.")}` as Route);
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
          ...(texto(form, "motivoRechazo")
            ? { motivoRechazo: texto(form, "motivoRechazo") }
            : {}),
        }),
      "cxc:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxc/cheques");
  redirect(`/cxc/cheques?hecho=${encodeURIComponent(`Cheque ${nuevo}.`)}` as Route);
}
