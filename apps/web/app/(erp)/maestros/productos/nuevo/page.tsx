import { listarUnidades } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";
import { FormularioProducto } from "../formulario";

export const metadata = { title: "Nuevo producto · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevoProducto() {
  const unidades = await conEmpresa((db) => listarUnidades(db), "maestros:crear");

  return (
    <>
      <Encabezado titulo="Nuevo producto" />
      <Contenido>
        <FormularioProducto
          unidades={unidades}
          inicial={{
            codigo: "",
            descripcion: "",
            // NIU (unidad de bienes) es lo que corresponde a la enorme mayoría
            // del catálogo de una importadora de repuestos.
            unidadId: unidades.find((u) => u.codigo === "NIU")?.id ?? "",
            tipo: "bien",
            afectacionIgv: "10",
            codigoSunat: "",
            partidaArancelaria: "",
            pesoUnitario: "",
            volumenUnitario: "",
            stockMinimo: "0",
            controlLote: false,
            controlSerie: false,
          }}
        />
      </Contenido>
    </>
  );
}
