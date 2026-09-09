import Link from "next/link";
import { listar } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio, BotonEnlace } from "@/components/ui";

export const metadata = { title: "Importaciones · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Importaciones() {
  const filas = await conEmpresa((db) => listar(db), "importaciones:ver");
  const puedeCrear = await tienePermiso("importaciones:crear");

  return (
    <>
      <Encabezado
        titulo="Importaciones"
        descripcion="Órdenes al exterior, seguimiento de embarques y liquidación de costos."
        acciones={
          puedeCrear ? <BotonEnlace href="/importaciones/nueva">Nueva importación</BotonEnlace> : null
        }
      />
      <Contenido>
        {filas.length === 0 ? (
          <Vacio
            titulo="Todavía no hay importaciones"
            descripcion="Registre una orden al proveedor del exterior para empezar a seguir el embarque y acumular sus gastos."
            accion={puedeCrear ? <BotonEnlace href="/importaciones/nueva">Nueva importación</BotonEnlace> : null}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Proveedor</th>
                  <th>Orden</th>
                  <th>Llegada</th>
                  <th>DUA</th>
                  <th>Almacén</th>
                  <th className="text-right">T.C.</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/importaciones/${f.id}`} className="font-medium underline">
                        {f.numero}
                      </Link>
                    </td>
                    <td>{f.proveedor}</td>
                    <td className="cifra">{f.fechaOrden}</td>
                    <td className="cifra">{f.fechaLlegada ?? "—"}</td>
                    <td className="cifra">{f.duaNumero ?? "—"}</td>
                    <td>{f.almacen ?? "—"}</td>
                    <td>
                      <Importe valor={f.tipoCambio} decimales={3} />
                    </td>
                    <td>
                      <EstadoDoc estado={f.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
