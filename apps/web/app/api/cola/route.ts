import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { enviarPendientes, estadoDeLaCola } from "@roulterp/servicios";
import { conexionApp, kekMaestra } from "@/lib/entorno";
import { conEmpresa, exigirEmpresaCon } from "@/lib/sesion";

export const dynamic = "force-dynamic";
/* Vaciar la cola puede tardar: cada envío a SUNAT se lleva hasta un minuto. */
export const maxDuration = 300;

/**
 * Vacía la cola de envío a SUNAT.
 *
 * Tiene dos formas de llamarse, y las dos hacen falta:
 *
 * **Un programador de tareas**, con la cabecera `Authorization: Bearer …`. Es
 * la que importa: mantiene la cola vacía sin que nadie esté pendiente. Se
 * configura fuera, cada pocos minutos.
 *
 * **Una persona desde la pantalla**, con su sesión. Sirve para el «mándalo
 * ahora» cuando no se quiere esperar al siguiente turno.
 *
 * El programador tiene que decir de qué empresa se ocupa: no hay sesión de la
 * que deducirlo, y recorrer todas las empresas desde una sola petición sería
 * darle a un secreto compartido la llave de todas a la vez.
 */
export async function POST(peticion: Request): Promise<NextResponse> {
  const url = new URL(peticion.url);
  const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 10, 1), 50);

  const secreto = process.env["ROULTERP_COLA_SECRETO"];
  const cabecera = peticion.headers.get("authorization") ?? "";
  const porTarea = secreto !== undefined && cabecera.startsWith("Bearer ");

  let ctx: { empresaId: string; usuarioId: string };

  if (porTarea) {
    /*
     * Comparación en tiempo constante.
     *
     * Con `===`, el tiempo que tarda en decir que no depende de cuántos
     * caracteres coincidieron, y eso deja adivinar el secreto letra a letra.
     * `timingSafeEqual` exige longitudes iguales, de ahí el rodeo.
     */
    const dado = Buffer.from(cabecera.slice("Bearer ".length));
    const bueno = Buffer.from(secreto);
    const valido =
      dado.length === bueno.length && timingSafeEqual(new Uint8Array(dado), new Uint8Array(bueno));
    const empresaId = url.searchParams.get("empresa");
    if (!valido || !empresaId) {
      return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    }
    // El usuario que figura en la bitácora es la propia tarea, no una persona.
    ctx = { empresaId, usuarioId: empresaId };
  } else {
    try {
      const sesion = await exigirEmpresaCon("cpe:crear");
      ctx = { empresaId: sesion.empresaId, usuarioId: sesion.usuarioId };
    } catch {
      return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    }
  }

  const r = await enviarPendientes(conexionApp, ctx, kekMaestra, { limite });
  return NextResponse.json(r);
}

/** Qué hay esperando. Sólo para quien tiene sesión. */
export async function GET(): Promise<NextResponse> {
  try {
    const sesion = await exigirEmpresaCon("cpe:ver");
    const cola = await estadoDeLaCola(conexionApp, {
      empresaId: sesion.empresaId,
      usuarioId: sesion.usuarioId,
    });
    return NextResponse.json({
      pendientes: cola.length,
      atascados: cola.filter((c) => c.atascado).length,
      cola,
    });
  } catch {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
}
