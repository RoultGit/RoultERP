"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  calcularPlanillaSueldos, cerrarPlanillaSueldos, anularPlanillaSueldos,
  guardarParametroLaboral, guardarConcepto,
  type TipoPlanilla, type ConceptoPlanilla,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, marcado, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type EstadoPlanilla = EstadoForm & { avisos?: string[] };

const mensaje = (e: unknown) => traducirError(e, { contexto: "planillas" });

export async function calcularAccion(
  _previo: EstadoPlanilla,
  form: FormData,
): Promise<EstadoPlanilla> {
  const quincena = texto(form, "quincena");
  let planillaId: string;
  let avisos: string[] = [];
  try {
    const r = await conEmpresa(
      (db, s) =>
        calcularPlanillaSueldos(db, s.empresaId, s.usuarioId, {
          numero: texto(form, "numero"),
          tipo: (texto(form, "tipo") || "mensual") as TipoPlanilla,
          periodo: texto(form, "periodo").replace("-", ""),
          ...(quincena ? { quincena: Number(quincena) as 1 | 2 } : {}),
          fecha: texto(form, "fecha"),
          ...(texto(form, "fechaPago") ? { fechaPago: texto(form, "fechaPago") } : {}),
          ...(marcado(form, "aportaSenati") ? { aportaSenati: true } : {}),
          observaciones: texto(form, "observaciones"),
        }),
      "planillas:crear",
    );
    planillaId = r.planillaId;
    avisos = [...r.avisos];
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/planillas");
  // Los avisos viajan en la URL porque la pantalla de destino es otra: una
  // planilla calculada con tres trabajadores fuera tiene que decirlo ahí.
  redirect(
    `/planillas/${planillaId}${avisos.length ? `?avisos=${encodeURIComponent(avisos.join("|"))}` : ""}` as Route,
  );
}

/**
 * Cierra la planilla y deja su asiento.
 *
 * Exige permiso de aprobación: cerrar contabiliza, y a partir de ahí la planilla
 * sólo se corrige extornando.
 */
export async function cerrarAccion(
  _previo: EstadoPlanilla,
  form: FormData,
): Promise<EstadoPlanilla> {
  const planillaId = texto(form, "planillaId");
  try {
    await conEmpresa(
      (db, s) => cerrarPlanillaSueldos(db, s.empresaId, s.usuarioId, planillaId),
      "planillas:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/planillas/${planillaId}`);
  revalidatePath("/planillas");
  revalidatePath("/contabilidad");
  return { exito: "Planilla cerrada y contabilizada." };
}

export async function anularAccion(
  _previo: EstadoPlanilla,
  form: FormData,
): Promise<EstadoPlanilla> {
  const planillaId = texto(form, "planillaId");
  const motivo = texto(form, "motivo");
  if (!motivo) return { error: "Indique por qué se anula." };
  try {
    await conEmpresa((db) => anularPlanillaSueldos(db, planillaId, motivo), "planillas:anular");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/planillas/${planillaId}`);
  revalidatePath("/planillas");
  return { exito: "Planilla anulada." };
}

export async function guardarParametroAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarParametroLaboral(db, s.empresaId, s.usuarioId, {
          clave: texto(form, "clave"),
          vigenteDesde: texto(form, "vigenteDesde"),
          valor: texto(form, "valor"),
          observaciones: texto(form, "observaciones"),
        }),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/planillas/configuracion");
  return { exito: "Parámetro guardado." };
}

export async function guardarConceptoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarConcepto(db, s.empresaId, s.usuarioId, {
          codigo: texto(form, "codigo").toUpperCase(),
          nombre: texto(form, "nombre"),
          tipo: texto(form, "tipo") as ConceptoPlanilla["tipo"],
          calculo: texto(form, "calculo") as ConceptoPlanilla["calculo"],
          remunerativo: marcado(form, "remunerativo"),
          afectaQuinta: marcado(form, "afectaQuinta"),
          computableCts: marcado(form, "computableCts"),
          ...(texto(form, "tasa") ? { tasa: texto(form, "tasa") } : {}),
          ...(texto(form, "cuenta") ? { cuenta: texto(form, "cuenta") } : {}),
          ...(texto(form, "orden") ? { orden: Number(texto(form, "orden")) } : {}),
          activo: !marcado(form, "desactivar"),
        }),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/planillas/configuracion");
  return { exito: "Concepto guardado." };
}
