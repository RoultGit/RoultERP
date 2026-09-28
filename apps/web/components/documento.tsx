import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { conEmpresa } from "@/lib/sesion";
import { Imprimir } from "@/components/imprimir";

/**
 * La hoja de un documento imprimible.
 *
 * Lleva el membrete de la empresa, la caja con el tipo y el número —que es
 * donde la mira todo el mundo— y las casillas de firma. Existe para que la
 * orden de compra, el recibo de caja y la guía salgan con la misma cara: en
 * Starsoft los tres se imprimen y se archivan juntos, y tres formatos distintos
 * para el mismo archivador se notan enseguida.
 *
 * La barra de arriba no se imprime: es para operar la pantalla.
 */
export async function Documento({
  titulo,
  numero,
  fecha,
  volverA,
  volverTexto = "Volver",
  firmas = ["Entregado por", "Recibido por"],
  children,
}: {
  titulo: string;
  numero: string;
  fecha: string;
  volverA: string;
  volverTexto?: string;
  /** Casillas de firma al pie. Vacío para no imprimir ninguna. */
  firmas?: string[];
  children: React.ReactNode;
}) {
  const empresa = await conEmpresa(async (db) => {
    const filas = (await db.execute(sql`
      SELECT razon_social, nombre_comercial, ruc, direccion FROM empresas`)) as unknown as {
      razon_social: string;
      nombre_comercial: string | null;
      ruc: string;
      direccion: string | null;
    }[];
    return filas[0];
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="no-imprimir mb-5 flex justify-end gap-2">
        <Imprimir />
        <Link href={volverA as Route} className="boton boton-secundario">
          {volverTexto}
        </Link>
      </div>

      <header
        className="flex items-start justify-between gap-6 border-b pb-4"
        style={{ borderColor: "var(--borde-fuerte)" }}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{empresa?.razon_social}</h1>
          {empresa?.nombre_comercial && (
            <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
              {empresa.nombre_comercial}
            </p>
          )}
          {empresa?.direccion && <p className="text-sm">{empresa.direccion}</p>}
          <p className="cifra text-sm" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
            RUC {empresa?.ruc}
          </p>
        </div>
        <div
          className="shrink-0 border px-4 py-2 text-center"
          style={{ borderColor: "var(--borde-fuerte)" }}
        >
          <p className="text-sm font-semibold uppercase">{titulo}</p>
          <p className="cifra text-base font-medium" style={{ textAlign: "center" }}>
            {numero}
          </p>
          <p className="cifra text-xs" style={{ color: "var(--texto-suave)", textAlign: "center" }}>
            {fecha}
          </p>
        </div>
      </header>

      {children}

      {firmas.length > 0 && (
        <section
          className="mt-16 grid gap-16 text-center text-sm"
          style={{ gridTemplateColumns: `repeat(${firmas.length}, minmax(0, 1fr))` }}
        >
          {firmas.map((f) => (
            <div key={f}>
              <div className="border-t" style={{ borderColor: "var(--borde-fuerte)" }} />
              <p className="mt-1" style={{ color: "var(--texto-suave)" }}>{f}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Dos columnas de datos, que es como se leen las cabeceras de un documento. */
export function Datos({ pares }: { pares: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 border-b py-3 text-sm sm:grid-cols-2" style={{ borderColor: "var(--borde)" }}>
      {pares.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt style={{ color: "var(--texto-suave)" }}>{k}</dt>
          <dd className="min-w-0 truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
