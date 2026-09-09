import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Facturación electrónica · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Facturación electrónica"
      descripcion="Emisión de comprobantes ante SUNAT (módulo Factron)."
      incluye={["XML UBL 2.1 firmado con el certificado digital de la empresa",
        "Envío al billService de SUNAT y proceso del CDR",
        "Resumen diario de boletas y comunicación de baja",
        "Guía de remisión electrónica por su API REST",
        "Comprobantes de retención y de percepción",
        "Representación impresa con código QR"]}
    />
  );
}
