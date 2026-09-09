import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Contabilidad · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Contabilidad"
      descripcion="Libro mayor, estados financieros y libros electrónicos."
      incluye={["Captura y consulta de asientos, con extorno",
        "Balance de comprobación y mayor por cuenta",
        "Estados financieros analíticos y comparativos",
        "Libros electrónicos PLE: 5.1, 6.1, 8.1, 8.2, 12.1, 13.1 y 14.1",
        "Ajuste automático por diferencia de cambio",
        "Cierre de periodo y de ejercicio"]}
    />
  );
}
