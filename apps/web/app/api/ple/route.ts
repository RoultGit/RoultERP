import { NextResponse, type NextRequest } from "next/server";
import { registroCompras, inventarioValorizado, aLatin1, LIBROS } from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

/**
 * Descarga de un libro electrónico.
 *
 * El archivo se entrega en Latin-1 y con saltos CRLF porque el validador de
 * SUNAT es exigente con ambas cosas: en UTF-8, una razón social con tilde llega
 * partida y el archivo rebota.
 *
 * La ruta pasa por `conEmpresa`, así que hereda la sesión, el permiso y el
 * aislamiento de RLS: no hay forma de descargar el libro de otra empresa
 * cambiando un parámetro.
 */
export const dynamic = "force-dynamic";

const GENERADORES = {
  [LIBROS.COMPRAS]: registroCompras,
  [LIBROS.INVENTARIO_VALORIZADO]: inventarioValorizado,
} as const;

export async function GET(req: NextRequest) {
  const periodo = req.nextUrl.searchParams.get("periodo") ?? "";
  const libro = req.nextUrl.searchParams.get("libro") ?? "";

  if (!/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "periodo inválido; use AAAAMM" }, { status: 400 });
  }
  const generar = GENERADORES[libro as keyof typeof GENERADORES];
  if (!generar) {
    return NextResponse.json(
      { error: "libro no disponible", disponibles: Object.keys(GENERADORES) },
      { status: 400 },
    );
  }

  try {
    const resultado = await conEmpresa(
      (db, sesion) => generar(db, sesion.empresaId, periodo),
      "contabilidad:ver",
    );

    return new NextResponse(new Uint8Array(aLatin1(resultado.contenido)), {
      headers: {
        "Content-Type": "text/plain; charset=iso-8859-1",
        "Content-Disposition": `attachment; filename="${resultado.nombre}"`,
        // Un libro se arma con los datos del momento; no debe cachearse.
        "Cache-Control": "no-store",
        "X-Filas": String(resultado.filas),
      },
    });
  } catch (e) {
    if (e instanceof NoAutorizado) {
      return NextResponse.json({ error: "no autorizado" }, { status: 403 });
    }
    console.error("error generando el libro electrónico", e);
    return NextResponse.json({ error: "no se pudo generar el libro" }, { status: 500 });
  }
}
