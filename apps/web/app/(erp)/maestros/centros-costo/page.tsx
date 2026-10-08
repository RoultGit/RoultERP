import { sql } from "drizzle-orm";
import { listarCentrosCosto } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";
import { CambiarEstado, NuevoCentro } from "./formularios";

export const metadata = { title: "Centros de costo · RoultERP" };
export const dynamic = "force-dynamic";

export default async function CentrosCosto() {
  const [datos, puedeEditar] = await Promise.all([
    conEmpresa(async (db) => {
      // Cuánto se ha imputado a cada uno: es lo que hace útil la pantalla, y
      // lo que dice si un centro sigue vivo antes de desactivarlo.
      const gasto = (await db.execute(sql`
        SELECT l.centro_costo_id AS id,
               sum(l.debe_funcional - l.haber_funcional)::text AS importe,
               count(*)::int AS lineas
        FROM asiento_lineas l
        JOIN asientos a ON a.id = l.asiento_id
        WHERE l.centro_costo_id IS NOT NULL AND a.estado <> 'borrador'
        GROUP BY l.centro_costo_id`)) as unknown as {
        id: string; importe: string; lineas: number;
      }[];
      return {
        centros: await listarCentrosCosto(db),
        gasto: new Map([...gasto].map((g) => [g.id, g])),
      };
    }, "maestros:ver"),
    tienePermiso("maestros:editar"),
  ]);

  return (
    <>
      <Encabezado
        titulo="Centros de costo"
        descripcion="A dónde se imputa cada gasto. Varias cuentas del plan lo exigen al contabilizar, así que sin al menos uno no se puede registrar un gasto."
        acciones={<BotonEnlace href="/maestros" variante="secundario">Maestros</BotonEnlace>}
      />
      <Contenido>
        {puedeEditar && (
          <section className="bloque mb-5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Nuevo centro de costo</h2>
            <NuevoCentro />
          </section>
        )}

        {datos.centros.length === 0 ? (
          <Vacio
            titulo="Sin centros de costo"
            descripcion="Créelos según cómo quiera analizar sus gastos: por área, por sucursal o por línea de negocio."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th className="text-right">Líneas imputadas</th>
                  <th className="text-right">Acumulado S/</th>
                  <th>Estado</th>
                  {puedeEditar && <th className="text-right">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {datos.centros.map((c) => {
                  const g = datos.gasto.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>{c.codigo}</td>
                      <td>{c.nombre}</td>
                      <td className="cifra text-right">{g?.lineas ?? 0}</td>
                      <td><Importe valor={g?.importe ?? "0"} /></td>
                      <td>
                        {c.activo ? (
                          <Insignia tono="exito">activo</Insignia>
                        ) : (
                          <Insignia tono="peligro">inactivo</Insignia>
                        )}
                      </td>
                      {puedeEditar && (
                        <td className="text-right">
                          <CambiarEstado
                            id={c.id}
                            codigo={c.codigo}
                            nombre={c.nombre}
                            activo={c.activo}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
