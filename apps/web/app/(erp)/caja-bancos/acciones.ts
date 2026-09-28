"use server";

import { revalidatePath } from "next/cache";
import {
  crearCuenta, registrarMovimientoEfectivo, importarExtracto, confirmarConciliacion, registrarArqueo,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type { EstadoForm };

export async function crearCuentaAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const tipo = texto(form, "tipo") as "caja" | "caja_chica" | "banco";
  try {
    await conEmpresa(
      (db, sesion) =>
        crearCuenta(db, sesion.empresaId, sesion.usuarioId, {
          codigo: texto(form, "codigo").toUpperCase(),
          nombre: texto(form, "nombre"),
          tipo,
          moneda: texto(form, "moneda") || "PEN",
          cuentaContable: texto(form, "cuentaContable"),
          ...(texto(form, "banco") ? { banco: texto(form, "banco") } : {}),
          ...(texto(form, "numeroCuenta") ? { numeroCuenta: texto(form, "numeroCuenta") } : {}),
          ...(texto(form, "cci") ? { cci: texto(form, "cci") } : {}),
          ...(tipo === "caja_chica" && texto(form, "fondoFijo")
            ? { fondoFijo: texto(form, "fondoFijo") }
            : {}),
        }),
      "caja_bancos:crear",
    );
    revalidatePath("/caja-bancos");
    return { exito: "Cuenta creada." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function registrarMovimientoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        registrarMovimientoEfectivo(db, sesion.empresaId, sesion.usuarioId, {
          cuentaId: texto(form, "cuentaId"),
          fecha: texto(form, "fecha"),
          sentido: texto(form, "sentido") === "ingreso" ? "ingreso" : "egreso",
          concepto: texto(form, "concepto"),
          importe: texto(form, "importe"),
          cuentaContrapartida: texto(form, "cuentaContrapartida"),
          ...(texto(form, "referencia") ? { referencia: texto(form, "referencia") } : {}),
        }),
      "caja_bancos:crear",
    );
    revalidatePath(`/caja-bancos/${texto(form, "cuentaId")}`);
    revalidatePath("/caja-bancos");
    return { exito: `Movimiento registrado (asiento ${r.asientoId.slice(0, 8)}).` };
  } catch (e) {
    return mensaje(e);
  }
}

/**
 * Importa el extracto pegado como texto.
 *
 * Se acepta pegar directamente lo que el banco entrega en CSV separado por
 * punto y coma o por tabulador, que es lo que sale de exportar desde la banca
 * por internet. Pedir un formato propio obligaría al usuario a transformar el
 * archivo a mano cada mes.
 */
export async function importarExtractoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const cuentaId = texto(form, "cuentaId");
  const contenido = String(form.get("contenido") ?? "");

  const lineas: { fecha: string; descripcion: string; importe: string; referencia?: string }[] = [];
  const errores: string[] = [];

  contenido.split(/\r?\n/).forEach((linea, i) => {
    const l = linea.trim();
    if (l === "") return;
    const campos = l.split(/[;\t]/).map((c) => c.trim());
    if (campos.length < 3) {
      errores.push(`línea ${i + 1}: se esperaban al menos fecha, descripción e importe`);
      return;
    }
    const [fecha, descripcion, importe, referencia] = campos;
    // Se admite AAAA-MM-DD y DD/MM/AAAA, que es como lo dan casi todos los bancos.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(fecha!)
      ? fecha!
      : /^(\d{2})\/(\d{2})\/(\d{4})$/.test(fecha!)
        ? fecha!.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")
        : null;
    if (!iso) {
      errores.push(`línea ${i + 1}: la fecha «${fecha}» no se entiende`);
      return;
    }
    const monto = importe!.replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(monto)) {
      errores.push(`línea ${i + 1}: el importe «${importe}» no es un número`);
      return;
    }
    lineas.push({
      fecha: iso,
      descripcion: descripcion!,
      importe: monto,
      ...(referencia ? { referencia } : {}),
    });
  });

  if (errores.length > 0) {
    return { error: `No se importó nada. ${errores.slice(0, 3).join("; ")}` };
  }
  if (lineas.length === 0) return { error: "Pegue las líneas del extracto." };

  try {
    const r = await conEmpresa(
      (db, sesion) => importarExtracto(db, sesion.empresaId, sesion.usuarioId, cuentaId, lineas),
      "caja_bancos:crear",
    );
    revalidatePath(`/caja-bancos/conciliar?cuenta=${cuentaId}`);
    return { exito: `${r.importadas} líneas importadas.` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function conciliarAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const cuentaId = texto(form, "cuentaId");
  const fecha = texto(form, "fecha") || hoyEnPeru();

  // Sólo se concilia lo que la persona marcó: aparear automático lo que no es
  // seguro escondería justamente los errores que la conciliación busca.
  const parejas: { extractoId: string; movimientoId: string }[] = [];
  for (const [clave, valor] of form.entries()) {
    const m = /^confirmar\[(.+)\]$/.exec(clave);
    if (m && valor === "on") {
      const [extractoId, movimientoId] = m[1]!.split("|");
      if (extractoId && movimientoId) parejas.push({ extractoId, movimientoId });
    }
  }

  if (parejas.length === 0) return { error: "Marque las parejas que desea conciliar." };

  try {
    const r = await conEmpresa(
      (db) => confirmarConciliacion(db, parejas, fecha),
      "caja_bancos:aprobar",
    );
    revalidatePath(`/caja-bancos/conciliar?cuenta=${cuentaId}`);
    return { exito: `${r.conciliados} movimientos conciliados.` };
  } catch (e) {
    return mensaje(e);
  }
}

export async function registrarArqueoAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await conEmpresa(
      (db, sesion) =>
        registrarArqueo(db, sesion.empresaId, sesion.usuarioId, {
          cuentaId: texto(form, "cuentaId"),
          fecha: texto(form, "fecha"),
          saldoContado: texto(form, "saldoContado"),
          ...(texto(form, "observaciones") ? { observaciones: texto(form, "observaciones") } : {}),
        }),
      "caja_bancos:crear",
    );
    revalidatePath(`/caja-bancos/${texto(form, "cuentaId")}`);

    if (r.diferencia === "0.00") {
      return { exito: `Arqueo sin diferencias. Saldo: ${r.saldoLibro}.` };
    }
    const falta = r.diferencia.startsWith("-");
    return {
      exito: `Arqueo registrado. ${falta ? "Faltante" : "Sobrante"} de ${r.diferencia.replace("-", "")}, contabilizado y ajustado en el libro.`,
    };
  } catch (e) {
    return mensaje(e);
  }
}

const mensaje = (e: unknown) => traducirError(e, {
  contexto: "caja y bancos",
  choques: [
    [/cuentas_efectivo_uk|duplicate key/, "Ya existe una cuenta con ese código."],
  ],
});
