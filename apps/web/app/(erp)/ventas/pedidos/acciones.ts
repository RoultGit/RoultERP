"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { anularPedido } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

export async function anularPedidoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = String(form.get("pedidoId") ?? "").trim();
  try {
    await conEmpresa((db) => anularPedido(db, id), "ventas:crear");
  } catch (e) {
    return traducirError(e, { contexto: "la anulación de un pedido" });
  }
  revalidatePath("/ventas/pedidos");
  redirect(`/ventas/pedidos?hecho=${encodeURIComponent("Pedido anulado.")}` as Route);
}
