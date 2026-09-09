import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Cuentas por pagar · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Cuentas por pagar"
      descripcion="Obligaciones con proveedores y su programación de pago."
      incluye={["Documentos por pagar con vencimientos y antigüedad",
        "Programación de pagos y órdenes de pago",
        "Aplicación de pagos parciales a varios documentos",
        "Letras por pagar: canje, renovación y protesto",
        "Retención de IGV al pagar",
        "Estado de cuenta por proveedor"]}
    />
  );
}
