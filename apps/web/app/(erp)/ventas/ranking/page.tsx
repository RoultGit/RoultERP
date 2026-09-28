import Link from "next/link";
import type { Route } from "next";
import { rankingVentas } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Ranking de ventas · RoultERP" };
export const dynamic = "force-dynamic";

/** Primer y último día del mes en curso, que es el rango que se mira. */
function mesActual(): { desde: string; hasta: string } {
  const d = new Date();
  const a = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const ultimo = new Date(Date.UTC(a, d.getUTCMonth() + 1, 0)).getUTCDate();
  return { desde: `${a}-${m}-01`, hasta: `${a}-${m}-${ultimo}` };
}

export default async function Ranking({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; por?: string }>;
}) {
  const params = await searchParams;
  const base = mesActual();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(params.desde ?? "") ? params.desde! : base.desde;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(params.hasta ?? "") ? params.hasta! : base.hasta;
  const por = params.por === "cliente" ? "cliente" : "articulo";

  const r = await conEmpresa((db) => rankingVentas(db, { desde, hasta }, por), "ventas:ver");

  return (
    <>
      <Encabezado
        titulo="Ranking de ventas"
        descripcion="Qué se vendió más y con cuánto margen. El costo es el mismo que fue al asiento como costo de ventas, así que este margen y el del estado de resultados coinciden."
        acciones={
          <Link href={"/ventas" as Route} className="boton boton-secundario">
            Comprobantes
          </Link>
        }
      />
      <Contenido>
        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/ventas/ranking">
          <div>
            <label className="etiqueta" htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={desde} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="por">Agrupar por</label>
            <select id="por" name="por" className="campo" defaultValue={por}>
              <option value="articulo">Artículo</option>
              <option value="cliente">Cliente</option>
            </select>
          </div>
          <button className="boton boton-primario">Ver</button>

          <dl className="ml-auto flex gap-6 text-right">
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Venta</dt>
              <dd className="text-lg font-medium"><Importe valor={r.total.venta} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Costo</dt>
              <dd className="text-lg"><Importe valor={r.total.costo} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Margen</dt>
              <dd className="text-lg font-medium" style={{ color: "var(--exito)" }}>
                <Importe valor={r.total.margen} />
              </dd>
            </div>
          </dl>
        </form>

        <section className="tarjeta overflow-x-auto">
          {r.lineas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay ventas en el rango"
                descripcion="Cambie las fechas o emita un comprobante."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>{por === "cliente" ? "RUC / DNI" : "Código"}</th>
                  <th>{por === "cliente" ? "Cliente" : "Descripción"}</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Venta</th>
                  <th className="text-right">Costo</th>
                  <th className="text-right">Margen</th>
                  <th className="text-right">%</th>
                  <th className="text-right">Participación</th>
                </tr>
              </thead>
              <tbody>
                {r.lineas.map((l, i) => (
                  <tr key={l.id}>
                    <td className="cifra">{i + 1}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{l.codigo}</td>
                    <td className="max-w-[280px] truncate">{l.nombre}</td>
                    <td className="cifra">{l.cantidad}</td>
                    <td><Importe valor={l.venta} /></td>
                    <td><Importe valor={l.costo} /></td>
                    <td
                      className="font-medium"
                      style={
                        Number(l.margen) < 0 ? { color: "var(--peligro)" } : undefined
                      }
                    >
                      <Importe valor={l.margen} />
                    </td>
                    <td className="cifra">{l.margenPorcentaje} %</td>
                    <td className="cifra" style={{ color: "var(--texto-suave)" }}>
                      {l.participacion} %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            Las cifras son valor de venta, sin IGV: es lo comparable entre facturas y boletas. Las
            notas de crédito descuentan y las de débito suman.
          </p>
        </section>
      </Contenido>
    </>
  );
}
