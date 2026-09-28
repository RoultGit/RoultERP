"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  guardarBorrador, contabilizarBorrador, eliminarBorrador,
  cerrarPeriodo, reabrirPeriodo, ajustarDiferenciaCambio, cerrarEjercicio,
  ContabilizacionInvalida,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { leerLineasAsiento } from "@/lib/formulario";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "contabilidad" });

const cabecera = (form: FormData) => ({
  periodo: texto(form, "periodo"),
  fecha: texto(form, "fecha"),
  subdiario: texto(form, "subdiario") || "08",
  glosa: texto(form, "glosa"),
  moneda: texto(form, "moneda") || "PEN",
  tipoCambio: texto(form, "tipoCambio") || "1",
});

/**
 * Guarda el borrador y, si el botón lo pide, lo contabiliza.
 *
 * Son dos operaciones en una acción porque son un solo gesto del contador:
 * escribe el asiento y lo asienta. Guardar y contabilizar viajan en la misma
 * transacción, de modo que un asiento que no cuadra no deja atrás un borrador
 * a medias con el que nadie contaba.
 */
export async function guardarAsientoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineasAsiento(form);
  if (lineas.length < 2) return { error: "Un asiento necesita al menos dos líneas con cuenta." };

  const id = texto(form, "asientoId");
  const contabilizar = texto(form, "intencion") === "contabilizar";
  let destino: string;

  try {
    destino = await conEmpresa(async (db, sesion) => {
      const { asientoId, motivos } = await guardarBorrador(
        db,
        sesion.empresaId,
        sesion.usuarioId,
        { ...cabecera(form), lineas },
        id || undefined,
      );
      if (contabilizar) {
        // Si no cuadra, esto lanza y el borrador tampoco se guarda: se vuelve
        // al formulario con lo escrito y el motivo, sin basura en la base.
        if (motivos.length > 0) throw new ContabilizacionInvalida(motivos);
        await contabilizarBorrador(db, asientoId);
      }
      return asientoId;
    }, "contabilidad:crear");
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/contabilidad");
  redirect(
    (contabilizar
      ? `/contabilidad?periodo=${texto(form, "periodo")}`
      : `/contabilidad/asiento?id=${destino}`) as Route,
  );
}

export async function contabilizarAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa((db) => contabilizarBorrador(db, texto(form, "asientoId")), "contabilidad:crear");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad");
  return { exito: "Asiento contabilizado." };
}

export async function eliminarBorradorAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa((db) => eliminarBorrador(db, texto(form, "asientoId")), "contabilidad:anular");
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad");
  redirect(`/contabilidad?periodo=${texto(form, "periodo")}` as Route);
}

export async function cerrarPeriodoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const periodo = texto(form, "periodo");
  try {
    await conEmpresa(
      (db, s) => cerrarPeriodo(db, s.empresaId, s.usuarioId, periodo),
      "contabilidad:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/periodos");
  return { exito: `Periodo ${periodo} cerrado.` };
}

export async function reabrirPeriodoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const periodo = texto(form, "periodo");
  try {
    await conEmpresa(
      (db, s) => reabrirPeriodo(db, s.empresaId, s.usuarioId, periodo),
      "contabilidad:aprobar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/contabilidad/periodos");
  return { exito: `Periodo ${periodo} reabierto.` };
}

export async function ajustarCambioAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const periodo = texto(form, "periodo");
  try {
    const r = await conEmpresa(
      (db, s) =>
        ajustarDiferenciaCambio(db, s.empresaId, s.usuarioId, {
          periodo,
          fecha: texto(form, "fecha"),
          tipoCambio: texto(form, "tipoCambio"),
        }),
      "contabilidad:aprobar",
    );
    revalidatePath("/contabilidad/periodos");
    return {
      exito:
        r.asientoId === null
          ? "No hay saldos en moneda extranjera que ajustar."
          : `Ajustadas ${r.ajustes.length} partidas del periodo ${periodo}.`,
    };
  } catch (e) {
    return mensaje(e);
  }
}

export async function cerrarEjercicioAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const ejercicio = texto(form, "ejercicio");
  try {
    const r = await conEmpresa(
      (db, s) => cerrarEjercicio(db, s.empresaId, s.usuarioId, ejercicio),
      "contabilidad:aprobar",
    );
    revalidatePath("/contabilidad/periodos");
    revalidatePath("/contabilidad");
    // El importe cruza a la interfaz como texto: un Dec es un bigint y no
    // sobrevive a la serialización de una acción de servidor.
    const hayUtilidad = money.gt(r.utilidad, money.ZERO);
    const magnitud = money.toString(hayUtilidad ? r.utilidad : money.neg(r.utilidad), 2);
    return {
      exito: `Ejercicio ${ejercicio} cerrado con ${hayUtilidad ? "utilidad" : "pérdida"} de ${magnitud}.`,
    };
  } catch (e) {
    return mensaje(e);
  }
}
