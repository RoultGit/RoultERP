import { listarTerceros, listarAlmacenes } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioImportacion } from "./formulario";

export const metadata = { title: "Nueva importación · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaImportacion() {
  const { proveedores, almacenes } = await conEmpresa(
    async (db) => ({
      proveedores: await listarTerceros(db, { rol: "proveedor" }),
      almacenes: await listarAlmacenes(db),
    }),
    "importaciones:crear",
  );

  // Sin proveedor no hay embarque que registrar, y mandar al usuario a un
  // formulario que no puede completar es peor que decírselo aquí.
  if (proveedores.length === 0) {
    return (
      <>
        <Encabezado titulo="Nueva importación" />
        <Contenido>
          <Vacio
            titulo="Primero registre un proveedor"
            descripcion="Una importación necesita un proveedor del exterior. Créelo en maestros y vuelva aquí."
            accion={<BotonEnlace href="/maestros/terceros/nuevo">Nuevo proveedor</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Nueva importación"
        descripcion="Registre la orden al proveedor del exterior. Los ítems y los gastos se agregan después."
      />
      <Contenido>
        <FormularioImportacion
          proveedores={proveedores.map((p) => ({
            id: p.id,
            nombre: p.razonSocial,
            pais: p.pais,
            domiciliado: p.esDomiciliado,
          }))}
          almacenes={almacenes
            .filter((a) => a.activo)
            .map((a) => ({ id: a.id, nombre: a.nombre, esTransito: a.esTransito }))}
        />
      </Contenido>
    </>
  );
}
