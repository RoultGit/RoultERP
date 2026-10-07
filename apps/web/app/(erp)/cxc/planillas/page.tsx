import Link from "next/link";
import type { Route } from "next";
import { listarPlanillas, cobrablesLibres } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioPlanilla } from "./formulario";

export const metadata = { title: "Planillas de cobranza · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todas"],
  ["abierta", "Abiertas"],
  ["cerrada", "Cerradas"],
  ["anulada", "Anuladas"],
] as const;

export default async function Planillas({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { estado } = params;
  const pagina = paginaDe(params.pagina);
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const puedeCrear = await tienePermiso("cxc:crear");

  const datos = await conEmpresa(async (db) => {
    const [planillas, cobrables] = await Promise.all([
      listarPlanillas(db, filtro || undefined),
      puedeCrear ? cobrablesLibres(db) : Promise.resolve([]),
    ]);
    return { planillas, cobrables };
  }, "cxc:ver");

  return (
    <>
      <Encabezado
        titulo="Planillas de cobranza"
        descripcion="La hoja con la que se sale a cobrar. Dice en manos de quién está cada documento, que es lo que falta cuando una factura lleva tres semanas «en gestión»."
        acciones={
          <Link href={"/cxc" as Route} className="boton boton-secundario">
            Cuentas por cobrar
          </Link>
        }
      />
      <Contenido>
        {puedeCrear && (
          <div className="mb-6">
            <FormularioPlanilla
              cobrables={datos.cobrables.map((c) => ({
                marca: `${c.clase}:${c.id}`,
                clase: c.clase,
                documento: c.documento,
                cliente: c.cliente,
                vencimiento: c.vencimiento,
                moneda: c.moneda,
                libre: c.libre,
              }))}
            />
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/cxc/planillas?estado=${valor}` : "/cxc/planillas") as Route}
              className="rounded border px-3 py-1 text-sm"
              style={{
                borderColor: filtro === valor ? "var(--acento)" : "var(--borde)",
                background: filtro === valor ? "var(--acento-suave)" : "var(--superficie)",
                color: filtro === valor ? "var(--acento)" : "var(--texto-suave)",
              }}
            >
              {texto}
            </Link>
          ))}
        </div>

        <section className="tarjeta overflow-x-auto">
          {datos.planillas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay planillas de cobranza"
                descripcion="Marque arriba lo que se sale a cobrar, diga a quién se le entrega y cree la planilla."
              />
            </div>
          ) : (
            <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Se entregó a</th>
                  <th>Tipo</th>
                  <th className="text-right">Documentos</th>
                  <th className="text-right">Importe</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rodaja(datos.planillas, pagina).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/cxc/planillas/${p.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {p.numero}
                      </Link>
                    </td>
                    <td className="cifra">{p.fecha}</td>
                    <td className="max-w-[220px] truncate">{p.responsable}</td>
                    <td><Insignia>{p.tipo}</Insignia></td>
                    <td className="cifra">{p.documentos}</td>
                    <td><Importe valor={p.importe} moneda={p.moneda} /></td>
                    <td><EstadoDoc estado={p.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginacion
              total={datos.planillas.length}
              pagina={pagina}
              params={params}
              etiqueta="planillas"
            />
            </>
          )}
        </section>
      </Contenido>
    </>
  );
}
