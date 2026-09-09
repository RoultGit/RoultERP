import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { listarUnidades } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";
import { FormularioProducto } from "../formulario";

export const dynamic = "force-dynamic";

export default async function EditarProducto({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const [producto] = await db
      .select()
      .from(schema.productos)
      .where(eq(schema.productos.id, id))
      .limit(1);
    // RLS ya filtró por empresa: si no aparece, o no existe o es de otra, y
    // desde aquí las dos cosas deben ser indistinguibles.
    if (!producto) return null;
    return { producto, unidades: await listarUnidades(db) };
  }, "maestros:ver");

  if (!datos) notFound();
  const { producto, unidades } = datos;

  return (
    <>
      <Encabezado titulo={`Producto ${producto.codigo}`} descripcion={producto.descripcion} />
      <Contenido>
        <FormularioProducto
          unidades={unidades}
          inicial={{
            id: producto.id,
            codigo: producto.codigo,
            descripcion: producto.descripcion,
            unidadId: producto.unidadId,
            tipo: producto.tipo,
            afectacionIgv: producto.afectacionIgv,
            codigoSunat: producto.codigoSunat ?? "",
            partidaArancelaria: producto.partidaArancelaria ?? "",
            pesoUnitario: producto.pesoUnitario ?? "",
            volumenUnitario: producto.volumenUnitario ?? "",
            stockMinimo: producto.stockMinimo,
            controlLote: producto.controlLote,
            controlSerie: producto.controlSerie,
          }}
        />
      </Contenido>
    </>
  );
}
