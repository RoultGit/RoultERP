"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  crearOrdenPago, resolverOrdenPago, anularOrdenPago, ejecutarOrdenPago,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "órdenes de pago" });

export async function crearOrdenAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  // Sólo entran los documentos marcados. El importe en blanco significa
  // «lo que quede libre», que es lo que se hace nueve de cada diez veces.
  const documentos: { documentoId: string; importe?: string }[] = [];
  for (const id of form.getAll("documentoId").map(String)) {
    const importe = texto(form, `importe-${id}`);
    documentos.push({ documentoId: id, ...(importe ? { importe } : {}) });
  }
  if (documentos.length === 0) return { error: "Marque al menos un documento." };

  let id: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        crearOrdenPago(db, s.empresaId, s.usuarioId, {
          proveedorId: texto(form, "proveedorId"),
          fecha: texto(form, "fecha"),
          documentos,
          ...(texto(form, "fechaProgramada")
            ? { fechaProgramada: texto(form, "fechaProgramada") }
            : {}),
          ...(texto(form, "medioPago") ? { medioPago: texto(form, "medioPago") } : {}),
          ...(texto(form, "cuentaEfectivoId")
            ? { cuentaEfectivoId: texto(form, "cuentaEfectivoId") }
            : {}),
          ...(form.get("retenerIgv") !== null ? { retenerIgv: true } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "cxp:crear",
    );
    id = r.id;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxp/ordenes-pago");
  redirect(`/cxp/ordenes-pago/${id}` as Route);
}

export async function resolverAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const ordenId = texto(form, "ordenId");
  const estado = texto(form, "estado") as "autorizada" | "rechazada";
  try {
    await conEmpresa(
      (db, s) =>
        resolverOrdenPago(db, ordenId, s.usuarioId, {
          estado,
          ...(texto(form, "motivo") ? { motivo: texto(form, "motivo") } : {}),
        }),
      // Autorizar un desembolso no es capturarlo: es el permiso de aprobación.
      "cxp:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/cxp/ordenes-pago/${ordenId}`);
  revalidatePath("/cxp/ordenes-pago");
  redirect(`/cxp/ordenes-pago/${ordenId}?hecho=${estado}` as Route);
}

export async function anularAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const ordenId = texto(form, "ordenId");
  try {
    await conEmpresa((db) => anularOrdenPago(db, ordenId), "cxp:anular");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cxp/ordenes-pago");
  redirect("/cxp/ordenes-pago" as Route);
}

export async function ejecutarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const ordenId = texto(form, "ordenId");
  try {
    await conEmpresa(
      (db, s) =>
        ejecutarOrdenPago(db, s.empresaId, s.usuarioId, ordenId, {
          fecha: texto(form, "fecha"),
          ...(texto(form, "tipoCambio") ? { tipoCambio: texto(form, "tipoCambio") } : {}),
          ...(texto(form, "cuentaEfectivoId")
            ? { cuentaEfectivoId: texto(form, "cuentaEfectivoId") }
            : {}),
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
        }),
      "cxp:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/cxp/ordenes-pago/${ordenId}`);
  revalidatePath("/cxp");
  revalidatePath("/caja-bancos");
  revalidatePath("/contabilidad");
  redirect(`/cxp/ordenes-pago/${ordenId}?hecho=pagada` as Route);
}
