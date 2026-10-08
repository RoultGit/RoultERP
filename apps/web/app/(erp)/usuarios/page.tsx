import { usuariosDeEmpresa, rolesDeEmpresa, MODULOS, ACCIONES } from "@roulterp/servicios";
import { exigirEmpresa, tienePermiso } from "@/lib/sesion";
import { entornoAuth } from "@/lib/entorno";
import { Contenido, Encabezado, Insignia, SinPermiso } from "@/components/ui";
import { AccionesUsuario, EditorRol, InvitarUsuario, type RolOpcion } from "./formularios";

export const metadata = { title: "Usuarios y roles · RoultERP" };
export const dynamic = "force-dynamic";

const NOMBRE_MODULO: Record<string, string> = {
  empresas: "Empresas",
  usuarios: "Usuarios",
  maestros: "Maestros",
  compras: "Compras",
  importaciones: "Importaciones",
  inventario: "Inventario",
  ventas: "Ventas",
  cxc: "Cuentas por cobrar",
  cxp: "Cuentas por pagar",
  caja_bancos: "Caja y bancos",
  contabilidad: "Contabilidad",
  cpe: "Facturación electrónica",
  sig: "SIG",
};

const NOMBRE_ACCION: Record<string, string> = {
  ver: "Ver",
  crear: "Crear",
  editar: "Editar",
  anular: "Anular",
  aprobar: "Aprobar",
};

export default async function Usuarios() {
  const sesion = await exigirEmpresa();
  if (!(await tienePermiso("usuarios:ver"))) return <SinPermiso />;

  const puedeEditar = await tienePermiso("usuarios:editar");
  const [usuarios, roles] = await Promise.all([
    usuariosDeEmpresa(entornoAuth, sesion.empresaId),
    rolesDeEmpresa(entornoAuth, sesion.empresaId),
  ]);

  const opciones: RolOpcion[] = roles.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    permisos: r.permisos,
    esSistema: r.esSistema,
  }));

  const modulos = MODULOS.map((m) => ({ codigo: m, nombre: NOMBRE_MODULO[m] ?? m }));
  const acciones = ACCIONES.map((a) => ({ codigo: a, nombre: NOMBRE_ACCION[a] ?? a }));

  return (
    <>
      <Encabezado
        titulo="Usuarios y roles"
        descripcion="Quién entra a esta empresa y qué puede hacer dentro."
      />
      <Contenido>
        {puedeEditar && (
          <section className="bloque mb-5 p-4">
            <h2 className="mb-1 text-sm font-semibold">Invitar a alguien</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              La cuenta no sirve hasta que la persona acepte la invitación y elija su contraseña.
              Si ya tenía cuenta en otra empresa, se le da acceso a ésta sin tocar su contraseña.
            </p>
            <InvitarUsuario roles={opciones} />
          </section>
        )}

        <section className="bloque overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Con acceso a esta empresa
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Segundo factor</th>
                <th>Último acceso</th>
                {puedeEditar && <th className="text-right">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const rol = opciones.find((r) => r.id === u.rolId);
                const esAdministrador = rol?.permisos.includes("usuarios:editar") ?? false;
                return (
                  <tr key={u.usuarioId}>
                    <td>
                      {u.nombre}
                      {u.usuarioId === sesion.usuarioId && (
                        <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          (usted)
                        </span>
                      )}
                    </td>
                    <td style={{ color: "var(--texto-suave)" }}>{u.email}</td>
                    <td>
                      <Insignia tono={esAdministrador ? "alerta" : "neutro"}>
                        {u.rolNombre}
                      </Insignia>
                    </td>
                    <td>
                      {!u.activo ? (
                        <Insignia tono="peligro">revocado</Insignia>
                      ) : !u.activoCuenta ? (
                        <Insignia tono="alerta">sin aceptar</Insignia>
                      ) : (
                        <Insignia tono="exito">activo</Insignia>
                      )}
                    </td>
                    <td>
                      {u.mfaActivo ? (
                        <Insignia tono="exito">activo</Insignia>
                      ) : (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      )}
                    </td>
                    <td className="cifra">
                      {u.ultimoAcceso ? u.ultimoAcceso.toISOString().slice(0, 10) : "—"}
                    </td>
                    {puedeEditar && (
                      <td className="text-right">
                        <AccionesUsuario
                          usuarioId={u.usuarioId}
                          email={u.email}
                          rolId={u.rolId}
                          activo={u.activo}
                          esAdministrador={esAdministrador}
                          esUnoMismo={u.usuarioId === sesion.usuarioId}
                          roles={opciones}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="bloque mt-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Roles
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Rol</th>
                <th>Código</th>
                <th className="text-right">Permisos</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {opciones.map((r) => (
                <tr key={r.id}>
                  <td>{r.nombre}</td>
                  <td className="cifra" style={{ textAlign: "left" }}>{r.codigo}</td>
                  <td className="cifra text-right">{r.permisos.length}</td>
                  <td>
                    {r.esSistema ? (
                      <Insignia>del sistema</Insignia>
                    ) : (
                      <Insignia tono="exito">propio</Insignia>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {puedeEditar && (
          <section className="bloque mt-5 p-4">
            <h2 className="mb-1 text-sm font-semibold">Crear un rol propio</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              Los roles del sistema no se editan: son el punto de partida de cada empresa nueva y
              cambiarlos haría que «contador» significara algo distinto en cada una. Cree uno
              propio y marque lo que necesite. Pulse el nombre de un módulo para marcarlo entero.
            </p>
            <EditorRol modulos={modulos} acciones={acciones} />
          </section>
        )}
      </Contenido>
    </>
  );
}
