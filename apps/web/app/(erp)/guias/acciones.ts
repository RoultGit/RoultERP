"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  emitirGuia, enviarGuiaASunat, recogerTicketGuia, guardarCredencialesGre, type LineaGuiaEntrada,
} from "@roulterp/servicios";

import { conEmpresa, exigirEmpresaCon } from "@/lib/sesion";
import { conexionApp, kekMaestra, kekMaestraId } from "@/lib/entorno";
import { type EstadoForm, texto, filas } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

const mensaje = (e: unknown) => traducirError(e, { contexto: "guías de remisión", documento: "la guía" });

/** Bienes que se trasladan. Mismo esquema de nombres que las otras capturas. */
function leerLineas(form: FormData): LineaGuiaEntrada[] {
  const lineas: LineaGuiaEntrada[] = [];
  for (const campo of filas(form, "cantidad")) {
    const cantidad = campo("cantidad");
    const productoId = campo("productoId");
    const descripcion = campo("descripcion");
    if (cantidad === "" || (productoId === "" && descripcion === "")) continue;
    lineas.push({
      cantidad,
      ...(productoId ? { productoId } : {}),
      ...(descripcion ? { descripcion } : {}),
      ...(campo("unidad") ? { unidad: campo("unidad") } : {}),
    });
  }
  return lineas;
}

export async function emitirGuiaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const lineas = leerLineas(form);
  if (lineas.length === 0) return { error: "Agregue al menos un bien que trasladar." };

  const publico = texto(form, "modoTransporte") === "01";
  let id: string;

  try {
    const r = await conEmpresa(
      (db, s) =>
        emitirGuia(db, s.empresaId, s.usuarioId, {
          serie: texto(form, "serie"),
          fechaEmision: texto(form, "fechaEmision"),
          destinatarioId: texto(form, "destinatarioId"),
          motivo: texto(form, "motivo"),
          descripcionMotivo: texto(form, "descripcionMotivo"),
          pesoBruto: texto(form, "pesoBruto") || "0",
          modoTransporte: texto(form, "modoTransporte"),
          fechaTraslado: texto(form, "fechaTraslado"),
          partida: {
            ubigeo: texto(form, "partidaUbigeo"),
            direccion: texto(form, "partidaDireccion"),
            ...(texto(form, "partidaEstablecimiento")
              ? { establecimiento: texto(form, "partidaEstablecimiento") }
              : {}),
          },
          llegada: {
            ubigeo: texto(form, "llegadaUbigeo"),
            direccion: texto(form, "llegadaDireccion"),
          },
          ...(texto(form, "bultos") ? { bultos: Number(texto(form, "bultos")) } : {}),
          ...(texto(form, "comprobanteId") ? { comprobanteId: texto(form, "comprobanteId") } : {}),
          ...(texto(form, "almacenId") ? { almacenId: texto(form, "almacenId") } : {}),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
          ...(publico
            ? {
                transportistaId: texto(form, "transportistaId"),
                ...(texto(form, "registroMtc") ? { registroMtc: texto(form, "registroMtc") } : {}),
              }
            : {
                placa: texto(form, "placa"),
                conductor: {
                  tipoDocumento: texto(form, "conductorTipoDoc") || "1",
                  numeroDocumento: texto(form, "conductorNumDoc"),
                  nombres: texto(form, "conductorNombres"),
                  apellidos: texto(form, "conductorApellidos"),
                  licencia: texto(form, "conductorLicencia"),
                },
              }),
          lineas,
        }),
      "ventas:crear",
    );
    id = r.guiaId;
  } catch (e) {
    return mensaje(e);
  }

  revalidatePath("/guias");
  redirect(`/guias/${id}` as Route);
}

export async function enviarGuiaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirEmpresaCon("cpe:crear");
  try {
    const r = await enviarGuiaASunat(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      texto(form, "guiaId"),
      kekMaestra,
    );
    revalidatePath("/guias");
    return r.ticket
      ? { exito: `Enviada. Ticket ${r.ticket}; consulte el resultado en un momento.` }
      : { error: `SUNAT rechazó la guía: ${r.mensaje ?? "sin detalle"}` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function recogerGuiaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const sesion = await exigirEmpresaCon("cpe:crear");
  try {
    const r = await recogerTicketGuia(
      conexionApp,
      { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId },
      texto(form, "guiaId"),
      kekMaestra,
    );
    revalidatePath("/guias");
    if (r.enProceso) {
      return { exito: "SUNAT todavía la está procesando. Consulte de nuevo en unos minutos." };
    }
    return r.estado === "aceptada"
      ? { exito: `Aceptada: ${r.mensaje ?? ""}` }
      : { error: `Rechazada (${r.codigo}): ${r.mensaje ?? "sin detalle"}` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function guardarCredencialesGreAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await conEmpresa(
      (db, s) =>
        guardarCredencialesGre(
          db,
          s.empresaId,
          { clientId: texto(form, "clientId"), clientSecret: texto(form, "clientSecret") },
          kekMaestra,
          kekMaestraId,
        ),
      "cpe:editar",
    );
  } catch (e) {
    return mensaje(e);
  }
  revalidatePath("/cpe");
  return { exito: "Credenciales de la GRE guardadas." };
}
