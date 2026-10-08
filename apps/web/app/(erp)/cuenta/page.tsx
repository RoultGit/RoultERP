import { sql } from "drizzle-orm";
import { exigirSesion } from "@/lib/sesion";
import { conexionAuth } from "@/lib/entorno";
import { enAuth } from "@roulterp/db";
import { Contenido, Encabezado, Insignia } from "@/components/ui";
import { ActivarMfa, CambiarPassword, CerrarSesiones, DesactivarMfa } from "./formularios";

export const metadata = { title: "Mi cuenta · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Cuenta() {
  const sesion = await exigirSesion();

  const datos = await enAuth(conexionAuth, async (db) => {
    const [usuario] = (await db.execute(sql`
      SELECT mfa_activo, coalesce(array_length(mfa_respaldos, 1), 0) AS respaldos,
             ultimo_acceso_en::text AS ultimo_acceso
      FROM usuarios WHERE id = ${sesion.usuarioId}`)) as unknown as [
      { mfa_activo: boolean; respaldos: number; ultimo_acceso: string | null },
    ];
    const abiertas = (await db.execute(sql`
      SELECT count(*)::int AS n FROM sesiones
      WHERE usuario_id = ${sesion.usuarioId} AND expira_en > now() AND revocada_en IS NULL`)) as unknown as [
      { n: number },
    ];
    return { usuario, sesiones: abiertas[0]!.n };
  });

  return (
    <>
      <Encabezado
        titulo="Mi cuenta"
        descripcion={`${sesion.nombre} · ${sesion.email}`}
      />
      <Contenido>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bloque p-4">
            <h2 className="mb-3 text-sm font-semibold">Contraseña</h2>
            <CambiarPassword />
          </section>

          <section className="bloque p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Segundo factor</h2>
              {datos.usuario.mfa_activo ? (
                <Insignia tono="exito">activo</Insignia>
              ) : (
                <Insignia tono="alerta">inactivo</Insignia>
              )}
            </div>

            {datos.usuario.mfa_activo ? (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
                  Quedan {datos.usuario.respaldos} códigos de respaldo sin usar.
                </p>
                <DesactivarMfa />
              </>
            ) : (
              <>
                <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
                  Una contraseña robada deja de bastar para entrar. Necesita una app de
                  autenticación en el teléfono.
                </p>
                <ActivarMfa />
              </>
            )}
          </section>

          <section className="bloque p-4">
            <h2 className="mb-1 text-sm font-semibold">Sesiones</h2>
            <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>
              {datos.sesiones === 1
                ? "Sólo esta sesión está abierta."
                : `${datos.sesiones} sesiones abiertas, incluida ésta.`}
              {datos.usuario.ultimo_acceso &&
                ` Último acceso: ${datos.usuario.ultimo_acceso.slice(0, 16).replace("T", " ")}.`}
            </p>
            <CerrarSesiones />
          </section>
        </div>
      </Contenido>
    </>
  );
}
