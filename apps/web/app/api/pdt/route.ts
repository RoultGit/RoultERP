import { NextResponse, type NextRequest } from "next/server";
import { exportarLiquidacion, aLatin1 } from "@roulterp/servicios";
import { conEmpresa, NoAutorizado } from "@/lib/sesion";

/**
 * La liquidación del mes en CSV, para llevarla al PDT.
 *
 * En Latin-1 como los libros: un Excel en español abre el CSV con la
 * codificación del sistema, y en UTF-8 las tildes llegan partidas.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const periodo = p.get("periodo") ?? "";
  if (!/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "periodo inválido; use AAAAMM" }, { status: 400 });
  }

  const opciones = {
    ...(p.get("saldo") ? { saldoAFavorAnterior: p.get("saldo")! } : {}),
    ...(p.get("tasa") ? { tasaRenta: p.get("tasa")! } : {}),
  };

  try {
    const r = await conEmpresa(
      (db, s) => exportarLiquidacion(db, s.empresaId, periodo, opciones),
      "contabilidad:ver",
    );
    return new NextResponse(new Uint8Array(aLatin1(r.contenido)), {
      headers: {
        "Content-Type": "text/csv; charset=iso-8859-1",
        "Content-Disposition": `attachment; filename="${r.nombre}"`,
        "Cache-Control": "no-store",
        "X-Filas": String(r.filas),
      },
    });
  } catch (e) {
    if (e instanceof NoAutorizado) {
      return NextResponse.json({ error: "no autorizado" }, { status: 403 });
    }
    console.error("error exportando la liquidación", e);
    return NextResponse.json({ error: "no se pudo exportar" }, { status: 500 });
  }
}
