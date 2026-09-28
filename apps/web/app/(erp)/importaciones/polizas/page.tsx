import Link from "next/link";
import type { Route } from "next";
import { listarPolizas, listarTerceros } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Vacio } from "@/components/ui";
import { FormularioPoliza } from "./formulario";

export const metadata = { title: "Pólizas · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Polizas() {
  const puedeCrear = await tienePermiso("importaciones:crear");

  const datos = await conEmpresa(async (db) => {
    const [polizas, proveedores] = await Promise.all([
      listarPolizas(db),
      listarTerceros(db, { rol: "proveedor" }),
    ]);
    return { polizas, proveedores };
  }, "importaciones:ver");

  return (
    <>
      <Encabezado
        titulo="Pólizas de importación"
        descripcion="La DUA con la que se nacionaliza un despacho. Una sola póliza ampara varios embarques, y sus gastos —agenciamiento, almacenaje, flete interno— se reparten entre todos."
        acciones={
          <Link href={"/importaciones" as Route} className="boton boton-secundario">
            Embarques
          </Link>
        }
      />
      <Contenido>
        {puedeCrear && (
          <div className="mb-5">
            <FormularioPoliza
              agentes={datos.proveedores
                .filter((p) => p.esDomiciliado)
                .map((p) => ({ id: p.id, etiqueta: `${p.razonSocial} · ${p.numeroDocumento}` }))}
            />
          </div>
        )}

        <section className="tarjeta overflow-x-auto">
          {datos.polizas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay pólizas"
                descripcion="Abra una con el número de la DUA y agrúpele los embarques que ampara. Los gastos comunes se repartirán entre ellos al liquidar."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>DUA</th>
                  <th>Fecha</th>
                  <th>Aduana</th>
                  <th>Régimen</th>
                  <th>Agente</th>
                  <th className="text-right">T.C.</th>
                  <th className="text-right">Embarques</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.polizas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/importaciones/polizas/${p.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {p.numero}
                      </Link>
                    </td>
                    <td className="cifra">{p.fecha}</td>
                    <td className="cifra">{p.aduana ?? "—"}</td>
                    <td className="max-w-[180px] truncate">{p.regimen ?? "—"}</td>
                    <td className="max-w-[220px] truncate">{p.agente ?? "—"}</td>
                    <td className="cifra">{money.toString(money.dec(p.tipoCambio), 3)}</td>
                    <td className="cifra">{p.embarques}</td>
                    <td><EstadoDoc estado={p.estado} /></td>
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
