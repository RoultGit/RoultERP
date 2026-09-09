import { Pendiente } from "@/components/pendiente";
import { exigirEmpresa } from "@/lib/sesion";

export const metadata = { title: "Usuarios y roles · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagina() {
  await exigirEmpresa();
  return (
    <Pendiente
      titulo="Usuarios y roles"
      descripcion="Quién entra y qué puede hacer en esta empresa."
      incluye={["Invitación de usuarios por correo",
        "Roles con permisos por módulo y acción",
        "Revocación de acceso sin borrar la cuenta",
        "Consulta de la bitácora de auditoría"]}
    />
  );
}
