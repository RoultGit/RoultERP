import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Compras · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Compras"
      descripcion="Del requerimiento a la factura del proveedor."
      incluye={["Requisición interna y solicitud de cotización",
        "Matriz comparativa de precios entre proveedores",
        "Orden de compra con seguimiento de recepciones parciales",
        "Registro de compras con detracción, retención y percepción",
        "Precios históricos por proveedor",
        "Valorización del ingreso al almacén"]}
    />
  );
}
