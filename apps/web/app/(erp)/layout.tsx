import { sql } from "drizzle-orm";
import { exigirEmpresa, conEmpresa } from "@/lib/sesion";
import { Navegacion } from "@/components/navegacion";
import { salir } from "../entrar/acciones";

export default async function EsqueletoErp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirEmpresa();
  const permisos = sesion.actor.membresias.get(sesion.empresaId)!.permisos;

  const empresa = await conEmpresa(async (db) => {
    const filas = await db.execute(sql`SELECT razon_social, ruc FROM empresas`);
    return filas[0] as { razon_social: string; ruc: string } | undefined;
  });

  const variasEmpresas =
    [...sesion.actor.membresias.values()].filter((m) => m.activo).length > 1;

  return (
    <div className="flex min-h-screen">
      <aside
        className="flex w-60 shrink-0 flex-col border-r"
        style={{ background: "var(--superficie)", borderColor: "var(--borde)" }}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--borde)" }}>
          <div className="text-sm font-semibold tracking-tight">RoultERP</div>
          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--texto-suave)" }}>
            {empresa?.razon_social}
          </div>
          <div className="cifra text-xs" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
            RUC {empresa?.ruc}
          </div>
        </div>

        {/* La navegación se arma con los permisos del usuario: no se muestran
            módulos a los que no puede entrar. Es comodidad, no seguridad —
            quien fuerce la URL se topa igual con la comprobación del servidor. */}
        <Navegacion permisos={[...permisos]} />

        <div className="mt-auto border-t p-3 text-xs" style={{ borderColor: "var(--borde)" }}>
          <div className="mb-2 truncate" style={{ color: "var(--texto-suave)" }}>
            {sesion.nombre}
          </div>
          <div className="flex gap-2">
            <a href="/cuenta" className="boton boton-secundario flex-1 !py-1 !text-xs">
              Mi cuenta
            </a>
            {variasEmpresas && (
              <a href="/empresas" className="boton boton-secundario !py-1 !text-xs">
                Cambiar
              </a>
            )}
          </div>
          <form action={salir} className="mt-2">
            <button className="boton boton-secundario w-full !py-1 !text-xs">Salir</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
