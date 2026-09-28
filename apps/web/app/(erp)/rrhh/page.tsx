import Link from "next/link";
import type { Route } from "next";
import { listarTrabajadores, contratosPorVencer } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Trabajadores · RoultERP" };
export const dynamic = "force-dynamic";

const nombre = (t: { apellidoPaterno: string; apellidoMaterno: string | null; nombres: string }) =>
  `${t.apellidoPaterno} ${t.apellidoMaterno ?? ""}`.trim() + `, ${t.nombres}`;

export default async function Trabajadores({
  searchParams,
}: {
  searchParams: Promise<{ situacion?: string }>;
}) {
  const { situacion = "activo" } = await searchParams;

  const { lista, avisos } = await conEmpresa(
    async (db) => ({
      lista: await listarTrabajadores(db, situacion === "todos" ? undefined : { situacion }),
      avisos: await contratosPorVencer(db, 60),
    }),
    "planillas:ver",
  );
  const puedeEditar = await tienePermiso("planillas:editar");
  const vencidos = avisos.filter((a) => a.vencido).length;

  return (
    <>
      <Encabezado
        titulo="Trabajadores"
        descripcion="El maestro del que salen las planillas, los contratos y las liquidaciones."
        acciones={
          <div className="flex items-center gap-2">
            <Link href={"/rrhh/contratos" as Route} className="boton boton-secundario">
              Contratos{avisos.length ? ` (${avisos.length})` : ""}
            </Link>
            {puedeEditar && (
              <Link href={"/rrhh/nuevo" as Route} className="boton boton-primario">
                Nuevo trabajador
              </Link>
            )}
          </div>
        }
      />
      <Contenido>
        {/*
          El aviso va arriba y no en su propia pantalla: un contrato que venció
          sin renovar convierte la relación en indeterminada por ley, y eso se
          descubre cuando el trabajador lo reclama.
        */}
        {vencidos > 0 && (
          <div className="aviso mb-5" role="alert">
            Hay {vencidos} contrato{vencidos === 1 ? "" : "s"} vencido{vencidos === 1 ? "" : "s"} sin
            renovar ni terminar.{" "}
            <Link href={"/rrhh/contratos" as Route} className="underline">
              Verlos
            </Link>
            .
          </div>
        )}

        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/rrhh">
          <div>
            <label className="etiqueta" htmlFor="situacion">Situación</label>
            <select id="situacion" name="situacion" className="campo" defaultValue={situacion}>
              <option value="activo">En planilla</option>
              <option value="cesado">Cesados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <button className="boton boton-secundario">Ver</button>
          <p className="ml-auto text-sm" style={{ color: "var(--texto-suave)" }}>
            {lista.length} trabajador{lista.length === 1 ? "" : "es"}
          </p>
        </form>

        <section className="tarjeta overflow-x-auto">
          {lista.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay trabajadores"
                descripcion="Dé de alta al primero para poder correr una planilla."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Trabajador</th>
                  <th>Cargo</th>
                  <th>Ingreso</th>
                  <th>Pensión</th>
                  <th className="text-right">Básico (S/)</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{t.numeroDocumento}</td>
                    <td>
                      <Link href={`/rrhh/${t.id}` as Route} className="font-medium underline">
                        {nombre(t)}
                      </Link>
                      {t.tieneHijos && (
                        <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          asig. familiar
                        </span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate">{t.cargo ?? "—"}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{t.fechaIngreso}</td>
                    <td className="text-xs">
                      {t.regimenPension === "afp"
                        ? `AFP ${t.afpCodigo ?? "?"} · ${t.afpComision ?? "flujo"}`
                        : t.regimenPension.toUpperCase()}
                    </td>
                    <td>
                      {t.basico ? (
                        <Importe valor={t.basico} />
                      ) : (
                        // Sin sueldo vigente no se puede calcular su boleta, y
                        // la planilla lo dirá. Mejor enterarse aquí.
                        <Insignia tono="peligro">sin fijar</Insignia>
                      )}
                    </td>
                    <td>
                      {t.situacion === "activo" ? (
                        <Insignia tono="exito">en planilla</Insignia>
                      ) : (
                        <Insignia>cesado {t.fechaCese}</Insignia>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </Contenido>
    </>
  );
}
