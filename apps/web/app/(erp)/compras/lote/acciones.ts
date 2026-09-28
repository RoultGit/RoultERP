"use server";

import { revalidatePath } from "next/cache";
import { analizarLote, registrarLote, type AnalisisLote, type ResultadoLote } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { type EstadoForm, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

export type EstadoLote = EstadoForm & {
  /** Lo pegado, para no perderlo entre el análisis y el registro. */
  hoja?: string;
  analisis?: AnalisisLote;
  resultado?: ResultadoLote;
};

export async function analizarAccion(_previo: EstadoLote, form: FormData): Promise<EstadoLote> {
  const hoja = String(form.get("hoja") ?? "");
  try {
    const analisis = await conEmpresa(
      (db, s) => analizarLote(db, s.empresaId, hoja),
      "compras:ver",
    );
    return { hoja, analisis };
  } catch (e) {
    return { hoja, ...traducirError(e, { contexto: "el análisis de la carga en serie" }) };
  }
}

/**
 * Registra lo que el análisis dio por bueno.
 *
 * Vuelve a analizar en vez de fiarse de lo que llegó del navegador. Cuesta una
 * consulta y compra dos cosas: que nadie pueda mandar un cuerpo fabricado a
 * mano, y que si alguien dio de alta el proveedor que faltaba —o registró una de
 * las facturas por otra pantalla— mientras el cuadro estaba abierto, se trabaje
 * con lo que hay ahora y no con lo que había hace diez minutos.
 */
export async function registrarAccion(_previo: EstadoLote, form: FormData): Promise<EstadoLote> {
  const hoja = String(form.get("hoja") ?? "");
  try {
    const { analisis, resultado } = await conEmpresa(async (db, s) => {
      const a = await analizarLote(db, s.empresaId, hoja);
      return { analisis: a, sesion: s };
    }, "compras:crear").then(async ({ analisis, sesion }) => ({
      analisis,
      // Cada factura en su propia transacción: una fila mala no puede tumbar a
      // las buenas. Por eso el registro recibe cómo abrir transacciones, y no
      // una conexión ya dentro de una.
      resultado: await registrarLote(
        (trabajo) => conEmpresa(trabajo, "compras:crear"),
        sesion.empresaId,
        sesion.usuarioId,
        analisis,
      ),
    }));

    revalidatePath("/compras");
    revalidatePath("/cxp");
    revalidatePath("/contabilidad/registros");
    return {
      hoja,
      analisis,
      resultado,
      ...(resultado.registradas.length
        ? {
            exito:
              `Se registraron ${resultado.registradas.length} facturas por S/ ${resultado.total}.` +
              (resultado.rechazadas.length
                ? ` Quedan ${resultado.rechazadas.length} por corregir.`
                : ""),
          }
        : { error: "No se registró ninguna factura. Revise los motivos de cada fila." }),
    };
  } catch (e) {
    return { hoja, ...traducirError(e, { contexto: "la carga en serie de compras" }) };
  }
}
