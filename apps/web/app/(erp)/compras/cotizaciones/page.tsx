import Link from "next/link";
import type { Route } from "next";
import { listarSolicitudes } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Vacio } from "@/components/ui";

export const metadata = { title: "Cotizaciones de compra · RoultERP" };
export const dynamic = "force-dynamic";

export default async function SolicitudesCotizacion() {
  const solicitudes = await conEmpresa((db) => listarSolicitudes(db), "compras:ver");
  const puedeCrear = await tienePermiso("compras:crear");

  return (
    <>
      <Encabezado
        titulo="Cotizaciones de compra"
        descripcion="Lo que se pidió al mercado y lo que respondió cada proveedor. El cuadro comparativo lleva todas las ofertas a soles antes de compararlas."
        acciones={
          <Link href={"/compras/requisiciones" as Route} className="boton boton-secundario">
            Requisiciones
          </Link>
        }
      />
      <Contenido>
        <section className="bloque overflow-x-auto">
          {solicitudes.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay solicitudes de cotización"
                descripcion="Una solicitud nace de una requisición aprobada: apruébela y pulse «Salir a cotizar»."
                accion={
                  puedeCrear ? (
                    <Link href={"/compras/requisiciones" as Route} className="boton boton-primario">
                      Ir a requisiciones
                    </Link>
                  ) : null
                }
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Límite</th>
                  <th>Requisición</th>
                  <th className="text-right">Respuestas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {solicitudes.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link
                        href={`/compras/cotizaciones/${s.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {s.numero}
                      </Link>
                    </td>
                    <td className="cifra">{s.fecha}</td>
                    <td className="cifra">{s.fechaLimite ?? "—"}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{s.requisicion ?? "—"}</td>
                    <td className="cifra">{s.respuestas}</td>
                    <td><EstadoDoc estado={s.estado} /></td>
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
