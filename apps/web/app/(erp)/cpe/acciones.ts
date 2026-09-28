"use server";

import { revalidatePath } from "next/cache";
import { cargarCertificado, guardarCredencialesSol } from "@roulterp/servicios";

import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { kekMaestra, kekMaestraId } from "@/lib/entorno";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type { EstadoForm };

/** Un certificado tributario pesa unos pocos kilobytes; medio mega es de sobra. */
const MAXIMO_PFX = 512 * 1024;

export async function subirCertificadoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const archivo = form.get("pfx");
  const password = String(form.get("password") ?? "");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Elija el archivo .pfx del certificado." };
  }
  if (archivo.size > MAXIMO_PFX) {
    return { error: "El archivo es demasiado grande para ser un certificado." };
  }
  if (password === "") {
    return { error: "Indique la contraseña del certificado." };
  }

  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const r = await conEmpresa(
      (db, sesion) =>
        cargarCertificado(
          db, sesion.empresaId, sesion.usuarioId, bytes, password, kekMaestra, kekMaestraId,
        ),
      "cpe:editar",
    );
    revalidatePath("/cpe");
    revalidatePath("/ventas");
    return {
      exito: `Certificado cargado. RUC ${r.ruc ?? "no declarado"}, vigente hasta ${r.vigenteHasta ?? "sin fecha"}.`,
    };
  } catch (e) {
    return mensaje(e);
  }
}

export async function guardarCredencialesAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const usuarioSol = texto(form, "usuarioSol");
  const claveSol = String(form.get("claveSol") ?? "");
  const entorno = texto(form, "entorno") === "produccion" ? "produccion" : "beta";

  if (claveSol === "") return { error: "Indique la clave SOL." };

  try {
    await conEmpresa(
      (db, sesion) =>
        guardarCredencialesSol(
          db, sesion.empresaId, sesion.usuarioId,
          { usuarioSol, claveSol, entorno },
          kekMaestra, kekMaestraId,
        ),
      "cpe:editar",
    );
    revalidatePath("/cpe");
    return {
      exito:
        entorno === "produccion"
          ? "Credenciales guardadas. Los comprobantes se enviarán a producción."
          : "Credenciales guardadas para el entorno de pruebas.",
    };
  } catch (e) {
    return mensaje(e);
  }
}

export async function crearSerieAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const tipoDocumento = texto(form, "tipoDocumento");
  const serie = texto(form, "serie").toUpperCase();

  // SUNAT exige que la serie de una factura empiece por F y la de una boleta
  // por B, seguidas de tres caracteres alfanuméricos.
  const inicial = tipoDocumento === "03" ? "B" : "F";
  if (!new RegExp(`^${inicial}[A-Z0-9]{3}$`).test(serie)) {
    return {
      error: `Una serie de ${tipoDocumento === "03" ? "boleta" : "factura"} empieza por ${inicial} y lleva tres caracteres más. Por ejemplo: ${inicial}001.`,
    };
  }

  try {
    await conEmpresa(
      (db, sesion) =>
        db
          .insert(schema.seriesDocumento)
          .values({
            empresaId: sesion.empresaId,
            tipoDocumento,
            serie,
            correlativo: 0,
            creadoPor: sesion.usuarioId,
          })
          .onConflictDoNothing(),
      "cpe:editar",
    );
    revalidatePath("/cpe");
    return { exito: `Serie ${serie} registrada.` };
  } catch (e) {
    return mensaje(e);
  }
}

const mensaje = (e: unknown) => traducirError(e, { contexto: "la configuración de emisión electrónica" });
