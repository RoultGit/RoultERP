import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { exigirSesion } from "@/lib/sesion";
import { conexionApp } from "@/lib/entorno";
import { enEmpresa } from "@roulterp/db";
import { elegirEmpresa, salir } from "../entrar/acciones";

export const metadata = { title: "Elegir empresa · RoultERP" };

/**
 * Selector de empresa.
 *
 * Se consulta el nombre de cada empresa entrando en su propio contexto de RLS,
 * una por una. Es menos eficiente que un solo SELECT, y es a propósito: no hay
 * ninguna consulta en el sistema capaz de leer varias empresas a la vez, ni
 * siquiera esta.
 */
export default async function Empresas() {
  const sesion = await exigirSesion();
  const visibles = [...sesion.actor.membresias.values()].filter((m) => m.activo);

  if (visibles.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="bloque max-w-md p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">Sin acceso a ninguna empresa</h1>
          <p className="mb-4 text-sm" style={{ color: "var(--texto-suave)" }}>
            Su cuenta existe pero no está asignada a ninguna empresa. Pida a un administrador
            que le dé acceso.
          </p>
          <form action={salir}>
            <button className="boton boton-secundario">Salir</button>
          </form>
        </div>
      </main>
    );
  }

  if (visibles.length === 1) redirect("/tablero");

  const empresas = await Promise.all(
    visibles.map(async (m) => {
      const filas = await enEmpresa(
        conexionApp,
        { empresaId: m.empresaId, usuarioId: sesion.usuarioId },
        (db) => db.execute(sql`SELECT id, ruc, razon_social FROM empresas`),
      );
      return filas[0] as { id: string; ruc: string; razon_social: string } | undefined;
    }),
  );

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-4 text-center text-lg font-semibold">Elija una empresa</h1>
        <div className="bloque divide-y" style={{ borderColor: "var(--borde)" }}>
          {empresas.filter(Boolean).map((e) => (
            <form key={e!.id} action={elegirEmpresa}>
              <input type="hidden" name="empresaId" value={e!.id} />
              <button
                type="submit"
                className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--superficie-2)]"
              >
                <div className="font-medium">{e!.razon_social}</div>
                <div className="cifra text-xs" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
                  RUC {e!.ruc}
                </div>
              </button>
            </form>
          ))}
        </div>
        <form action={salir} className="mt-4 text-center">
          <button className="text-xs underline" style={{ color: "var(--texto-suave)" }}>
            Salir
          </button>
        </form>
      </div>
    </main>
  );
}
