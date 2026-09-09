import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Ventas · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Ventas"
      descripcion="Del pedido del cliente a la factura."
      incluye={["Cotización, pedido y guía de remisión",
        "Factura, boleta, nota de crédito y nota de débito",
        "Control de límite de crédito del cliente",
        "Estadísticas y ranking por producto y por cliente",
        "Rentabilidad de la venta contra el costo del kardex"]}
    />
  );
}
