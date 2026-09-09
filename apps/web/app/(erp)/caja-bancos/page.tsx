import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Caja y bancos · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Caja y bancos"
      descripcion="Movimiento de efectivo y cuentas bancarias."
      incluye={["Caja chica con rendición y arqueo",
        "Múltiples cuentas bancarias en soles y en dólares",
        "Conciliación bancaria con importación del extracto",
        "Cheque-voucher y control de chequeras",
        "Recibos de ingreso y de egreso"]}
    />
  );
}
