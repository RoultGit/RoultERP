"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  guardarPresupuesto, aprobarPresupuesto, reabrirPresupuesto, cerrarPresupuesto, eliminarPresupuesto, type PartidaPresupuesto,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "presupuestos" });

function leerPartidas(form: FormData): PartidaPresupuesto[] {
  const partidas: PartidaPresupuesto[] = [];
  for (let i = 0; ; i++) {
    const marca = form.get(`partidas[${i}].cuenta`);
    if (marca === null) break;
    const cuenta = String(marca).trim();
    const importe = texto(form, `partidas[${i}].importe`);
    if (!cuenta || importe === "") continue;
    const mes = texto(form, `partidas[${i}].mes`);
    partidas.push({
      cuenta,
      importe,
      // Sin mes, el importe es anual y el servicio lo reparte en doceavas.
      ...(mes ? { mes: Number(mes) } : {}),
      ...(texto(form, `partidas[${i}].centroCostoId`)
        ? { centroCostoId: texto(form, `partidas[${i}].centroCostoId`) }
        : {}),
    });
  }
  return partidas;
}

export async function guardarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const partidas = leerPartidas(form);
  if (partidas.length === 0) return { error: "Agregue al menos una partida." };

  let id: string;
  try {
    id = await conEmpresa(
      (db, s) =>
        guardarPresupuesto(db, s.empresaId, s.usuarioId, {
          codigo: texto(form, "codigo"),
          nombre: texto(form, "nombre"),
          ejercicio: Number(texto(form, "ejercicio")),
          partidas,
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "contabilidad:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/presupuesto");
  redirect(`/contabilidad/presupuesto?presupuesto=${id}&hecho=guardado` as Route);
}

export async function estadoAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const id = texto(form, "presupuestoId");
  const accion = texto(form, "accion");
  try {
    await conEmpresa(async (db, s) => {
      if (accion === "aprobar") return aprobarPresupuesto(db, id, s.usuarioId);
      if (accion === "reabrir") return reabrirPresupuesto(db, id);
      if (accion === "cerrar") return cerrarPresupuesto(db, id);
      return eliminarPresupuesto(db, id);
    }, "contabilidad:editar");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/presupuesto");
  redirect(
    accion === "eliminar"
      ? ("/contabilidad/presupuesto" as Route)
      : (`/contabilidad/presupuesto?presupuesto=${id}&hecho=${accion}` as Route),
  );
}
