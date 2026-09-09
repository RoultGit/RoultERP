import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Cuentas por cobrar · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Cuentas por cobrar"
      descripcion="Cartera de clientes y cobranza."
      incluye={["Estado de cuenta y antigüedad de saldos",
        "Letras por cobrar: canje, renovación, descuento y protesto",
        "Cheques diferidos y devueltos",
        "Límite de crédito y control de morosidad",
        "Proyección de cobranza"]}
    />
  );
}
