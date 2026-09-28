import Link from "next/link";
import type { Route } from "next";
import { Contenido, Encabezado } from "@/components/ui";
import { exigirEmpresa, tienePermiso } from "@/lib/sesion";
import { SinPermiso } from "@/components/ui";
import { CargaEnSerie } from "./formulario";

export const metadata = { title: "Carga en serie de compras · RoultERP" };
export const dynamic = "force-dynamic";

export default async function LoteCompras() {
  await exigirEmpresa();
  if (!(await tienePermiso("compras:ver"))) return <SinPermiso />;

  return (
    <>
      <Encabezado
        titulo="Carga en serie de compras"
        descripcion="Para el grueso de facturas de gasto de una sola línea. Se pega la hoja, se revisa el cuadro y se registra."
        acciones={
          <div className="flex items-center gap-2">
            <Link href={"/compras/nueva" as Route} className="boton boton-secundario">
              Registrar una
            </Link>
            <Link href={"/compras" as Route} className="boton boton-secundario">
              Compras
            </Link>
          </div>
        }
      />
      <Contenido>
        <CargaEnSerie />
      </Contenido>
    </>
  );
}
