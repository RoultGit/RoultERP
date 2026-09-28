"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  guardarTrabajador, guardarRemuneracion, guardarContrato, renovarContrato, cesarTrabajador,
  type MotivoCese,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, marcado, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "recursos humanos" });

export async function guardarTrabajadorAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = texto(form, "trabajadorId");
  let nuevo: string;
  try {
    nuevo = await conEmpresa(
      (db, s) =>
        guardarTrabajador(
          db,
          s.empresaId,
          s.usuarioId,
          {
            tipoDocumento: texto(form, "tipoDocumento") || "1",
            numeroDocumento: texto(form, "numeroDocumento"),
            apellidoPaterno: texto(form, "apellidoPaterno"),
            apellidoMaterno: texto(form, "apellidoMaterno"),
            nombres: texto(form, "nombres"),
            fechaNacimiento: texto(form, "fechaNacimiento"),
            sexo: texto(form, "sexo"),
            email: texto(form, "email"),
            telefono: texto(form, "telefono"),
            direccion: texto(form, "direccion"),
            fechaIngreso: texto(form, "fechaIngreso"),
            cargo: texto(form, "cargo"),
            area: texto(form, "area"),
            centroCostoId: texto(form, "centroCostoId"),
            regimenPension: (texto(form, "regimenPension") || "onp") as "onp" | "afp" | "ninguno",
            afpCodigo: texto(form, "afpCodigo"),
            afpComision: (texto(form, "afpComision") || "flujo") as "flujo" | "mixta",
            cuspp: texto(form, "cuspp"),
            tieneHijos: marcado(form, "tieneHijos"),
            afiliadoEps: marcado(form, "afiliadoEps"),
            cci: texto(form, "cci"),
            banco: texto(form, "banco"),
            ctsBanco: texto(form, "ctsBanco"),
            ctsCuenta: texto(form, "ctsCuenta"),
            observaciones: texto(form, "observaciones"),
            // Sólo al dar de alta: después el sueldo se cambia por el historial,
            // que es lo que deja constancia de cuándo y por qué.
            ...(id ? {} : { basico: texto(form, "basico") }),
          },
          id || undefined,
        ),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/rrhh");
  redirect(`/rrhh/${nuevo}` as Route);
}

export async function guardarRemuneracionAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const trabajadorId = texto(form, "trabajadorId");
  try {
    await conEmpresa(
      (db, s) =>
        guardarRemuneracion(db, s.empresaId, s.usuarioId, {
          trabajadorId,
          vigenteDesde: texto(form, "vigenteDesde"),
          basico: texto(form, "basico"),
          motivo: texto(form, "motivo"),
        }),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/rrhh/${trabajadorId}`);
  return { exito: "Remuneración registrada." };
}

export async function guardarContratoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const trabajadorId = texto(form, "trabajadorId");
  try {
    await conEmpresa(
      (db, s) =>
        guardarContrato(db, s.empresaId, s.usuarioId, {
          trabajadorId,
          tipo: texto(form, "tipo"),
          modalidad: texto(form, "modalidad"),
          fechaInicio: texto(form, "fechaInicio"),
          fechaFin: texto(form, "fechaFin"),
          cargo: texto(form, "cargo"),
          jornadaHoras: texto(form, "jornadaHoras"),
          observaciones: texto(form, "observaciones"),
        }),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath(`/rrhh/${trabajadorId}`);
  revalidatePath("/rrhh/contratos");
  return { exito: "Contrato guardado." };
}

export async function renovarContratoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        renovarContrato(db, s.empresaId, s.usuarioId, texto(form, "contratoId"), {
          fechaInicio: texto(form, "fechaInicio"),
          fechaFin: texto(form, "fechaFin"),
          cargo: texto(form, "cargo"),
          observaciones: texto(form, "observaciones"),
        }),
      "planillas:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/rrhh/contratos");
  revalidatePath(`/rrhh/${texto(form, "trabajadorId")}`);
  return { exito: "Contrato renovado." };
}

/**
 * Da de baja al trabajador y genera su liquidación.
 *
 * Las dos cosas en la misma transacción, dentro del servicio. Exige permiso de
 * aprobación: cesar a alguien es irreversible desde la pantalla, y su
 * liquidación es dinero.
 */
export async function cesarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  const trabajadorId = texto(form, "trabajadorId");
  let planillaId: string;
  try {
    const r = await conEmpresa(
      (db, s) =>
        cesarTrabajador(db, s.empresaId, s.usuarioId, {
          trabajadorId,
          fechaCese: texto(form, "fechaCese"),
          motivo: texto(form, "motivo") as MotivoCese,
          ...(texto(form, "diasDelMes") ? { diasDelMes: Number(texto(form, "diasDelMes")) } : {}),
          ...(texto(form, "diasVacacionesPendientes")
            ? { diasVacacionesPendientes: Number(texto(form, "diasVacacionesPendientes")) }
            : {}),
          observaciones: texto(form, "observaciones"),
        }),
      "planillas:aprobar",
    );
    planillaId = r.planillaId;
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/rrhh");
  revalidatePath(`/rrhh/${trabajadorId}`);
  revalidatePath("/planillas");
  redirect(`/planillas/${planillaId}` as Route);
}
