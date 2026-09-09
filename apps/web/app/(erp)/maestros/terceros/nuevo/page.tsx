import { exigirEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";
import { FormularioTercero } from "../formulario";

export const metadata = { title: "Nuevo tercero · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevoTercero() {
  await exigirEmpresa();
  return (
    <>
      <Encabezado titulo="Nuevo cliente o proveedor" />
      <Contenido>
        <FormularioTercero
          inicial={{
            tipoDocumento: "6",
            numeroDocumento: "",
            razonSocial: "",
            nombreComercial: "",
            direccion: "",
            pais: "PE",
            email: "",
            telefono: "",
            esCliente: true,
            esProveedor: false,
            esDomiciliado: true,
            diasCredito: 0,
            limiteCredito: "0",
            monedaLimite: "PEN",
          }}
        />
      </Contenido>
    </>
  );
}
