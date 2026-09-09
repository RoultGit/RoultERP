import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Mi cuenta · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Mi cuenta"
      descripcion="Sus datos, su contraseña y su segundo factor."
      incluye={["Cambio de contraseña, que cierra las demás sesiones",
        "Activación de segundo factor con app de autenticación",
        "Códigos de respaldo de un solo uso",
        "Sesiones abiertas y cierre remoto"]}
    />
  );
}
