import { sql } from "drizzle-orm";
import { exigirEmpresa, conEmpresa } from "@/lib/sesion";
import { Navegacion } from "@/components/navegacion";
import { Logo } from "@/components/logo";
import { InterruptorTema } from "@/components/tema";
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

  /*
   * Barra fija de 252px y el contenido con su propio scroll.
   *
   * Es el modelo de Notion, y la razón es práctica: en una tabla de doscientas
   * filas la barra tiene que quedarse quieta. Si scrollea la página entera, el
   * menú desaparece por arriba y volver a otro módulo obliga a subir del todo.
   *
   * Bajo 1024px la rejilla se deshace y la barra pasa arriba: en un portátil de
   * trece pulgadas, 252px de menú fijo se comen el ancho de la tabla.
   */
  return (
    /*
     * `grid-rows-[minmax(0,1fr)]` no es decorativo: sin él, el fondo de todas
     * las pantallas quedaba inalcanzable.
     *
     * La rejilla tiene `h-[100dvh]` y `overflow-hidden`, pero su única fila se
     * dimensionaba por el más alto de sus dos hijos. En una ventana de 700px la
     * barra lateral pide 864 —su menú no cabe—, así que la fila medía 864, el
     * `main` medía 864, y el `overflow-hidden` recortaba los 164 de más. Se
     * llegaba al final del scroll del `main` y la última fila de la tabla seguía
     * fuera de la pantalla, sin forma de alcanzarla.
     *
     * Con la fila atada a `minmax(0,1fr)` los dos hijos reciben los 700 reales y
     * cada uno desplaza lo suyo por dentro: el menú su lista, el `main` su
     * contenido. `min-h-0` en los hijos es la otra mitad de lo mismo, porque un
     * hijo de rejilla tampoco se encoge por debajo de su contenido sin él.
     */
    <div className="lg:grid lg:h-[100dvh] lg:grid-cols-[252px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <aside
        className="flex flex-col border-b lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r"
        style={{ background: "var(--rail)", borderColor: "var(--borde-fuerte)" }}
      >
        <div className="px-5 pb-4 pt-5">
          <Logo className="text-[26px]" />
        </div>

        {/* La empresa activa, en su propio panel. No es decoración: quien
            trabaja con dos empresas necesita ver en cuál está antes de emitir
            un comprobante, y el RUC es la forma de no equivocarse. */}
        <div className="bloque mx-3.5 mb-3 px-3 py-2.5">
          <div className="text-[12.5px]" style={{ color: "var(--texto-tenue)" }}>
            Empresa activa
          </div>
          <div className="mt-0.5 truncate text-[14px] font-semibold tracking-[-0.015em]">
            {empresa?.razon_social}
          </div>
          <div className="cifra mt-px text-[12.5px]" style={{ color: "var(--texto-tenue)", textAlign: "left" }}>
            RUC {empresa?.ruc}
          </div>
        </div>

        {/* La navegación se arma con los permisos del usuario: no se muestran
            módulos a los que no puede entrar. Es comodidad, no seguridad —
            quien fuerce la URL se topa igual con la comprobación del servidor. */}
        <Navegacion permisos={[...permisos]} />

        <div
          className="grid gap-2 border-t px-3.5 py-3"
          style={{ borderColor: "var(--borde)" }}
        >
          <div className="min-w-0 px-1">
            <div className="truncate text-[13.5px] font-medium tracking-[-0.01em]">
              {sesion.nombre}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <a href="/cuenta" className="boton boton-secundario boton-chico">
              Mi cuenta
            </a>
            {variasEmpresas && (
              <a href="/empresas" className="boton boton-secundario boton-chico">
                Cambiar
              </a>
            )}
            <InterruptorTema />
            <form action={salir}>
              <button className="boton boton-secundario boton-chico w-full">
                Salir
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* El scroll vive aquí dentro, no en la página. */}
      <main className="min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto">{children}</main>
    </div>
  );
}
