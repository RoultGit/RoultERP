import { listarTerceros, listarProductos, listarAlmacenes } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioOrden } from "./formulario";

export const metadata = { title: "Nueva orden de compra · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaOrden() {
  const datos = await conEmpresa(async (db) => {
    const [proveedores, productos, almacenes] = await Promise.all([
      listarTerceros(db, { rol: "proveedor" }),
      listarProductos(db),
      listarAlmacenes(db),
    ]);
    return { proveedores, productos, almacenes };
  }, "compras:crear");

  if (datos.proveedores.length === 0) {
    return (
      <>
        <Encabezado titulo="Nueva orden de compra" />
        <Contenido>
          <Vacio
            titulo="Primero registre un proveedor"
            descripcion="Una orden de compra se emite a alguien."
            accion={<BotonEnlace href="/maestros/terceros/nuevo">Nuevo proveedor</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Nueva orden de compra"
        descripcion="El compromiso con el proveedor. Sirve para saber qué está pedido y comparar contra lo que llega."
      />
      <Contenido>
        <FormularioOrden
          proveedores={datos.proveedores.map((p) => ({
            id: p.id,
            etiqueta: `${p.razonSocial} · ${p.numeroDocumento}`,
          }))}
          productos={datos.productos
            .filter((p) => p.activo)
            .map((p) => ({
              id: p.id,
              etiqueta: `${p.codigo} — ${p.descripcion}`,
              descripcion: p.descripcion,
            }))}
          almacenes={datos.almacenes
            .filter((a) => a.activo)
            .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
        />
      </Contenido>
    </>
  );
}
