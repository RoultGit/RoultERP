import Link from "next/link";
import type { Route } from "next";
import {
  existenciasPorLote, seriesEnStock, listarProductos, listarAlmacenes,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioLote } from "./formulario";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Lotes y series · RoultERP" };
export const dynamic = "force-dynamic";

/** Días que faltan para una fecha. Negativo si ya pasó. */
function diasHasta(hoy: string, fecha: string): number {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
}

export default async function Lotes({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; almacen?: string; vence?: string; vista?: string }>;
}) {
  const { hecho, almacen, vence, vista } = await searchParams;
  const hoy = hoyEnPeru();
  const puedeEditar = await tienePermiso("inventario:editar");
  const enSeries = vista === "series";

  const datos = await conEmpresa(async (db) => {
    const [lotes, series, productos, almacenes] = await Promise.all([
      existenciasPorLote(db, {
        ...(almacen ? { almacenId: almacen } : {}),
        ...(vence ? { venceAntesDe: vence } : {}),
      }),
      seriesEnStock(db, almacen ? { almacenId: almacen } : undefined),
      listarProductos(db),
      listarAlmacenes(db),
    ]);
    return { lotes, series, productos, almacenes };
  }, "inventario:ver");

  const conControl = datos.productos.filter((p) => p.tipo === "bien" && p.activo);
  const vencidos = datos.lotes.filter(
    (l) => l.fecha_vencimiento !== null && l.fecha_vencimiento < hoy,
  );

  return (
    <>
      <Encabezado
        titulo="Lotes y series"
        descripcion="Qué hay, dónde y cuánto le queda antes de caducar. El saldo de cada lote sale del kardex: no se guarda dos veces."
        acciones={
          <Link href={"/inventario" as Route} className="boton boton-secundario">
            Existencias
          </Link>
        }
      />
      <Contenido>
        {hecho && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {hecho}
          </p>
        )}

        {vencidos.length > 0 && (
          <p className="aviso mb-4" role="alert">
            Hay {vencidos.length} {vencidos.length === 1 ? "lote vencido" : "lotes vencidos"} con
            existencias. Esa mercadería ya no se puede vender.
          </p>
        )}

        {puedeEditar && (
          <div className="mb-5">
            <FormularioLote
              productos={conControl.map((p) => ({
                id: p.id,
                etiqueta: `${p.codigo} — ${p.descripcion}`,
              }))}
            />
          </div>
        )}

        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/inventario/lotes">
          <input type="hidden" name="vista" value={enSeries ? "series" : ""} />
          <div className="min-w-[240px]">
            <label className="etiqueta" htmlFor="almacen">Almacén</label>
            <select id="almacen" name="almacen" className="campo" defaultValue={almacen ?? ""}>
              <option value="">Todos</option>
              {datos.almacenes
                .filter((a) => a.activo)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
            </select>
          </div>
          {!enSeries && (
            <div>
              <label className="etiqueta" htmlFor="vence">Vence antes de</label>
              <input id="vence" name="vence" type="date" defaultValue={vence ?? ""} className="campo" />
            </div>
          )}
          <button className="boton boton-primario">Filtrar</button>
          <div className="ml-auto flex gap-1.5">
            {[
              ["", "Lotes"],
              ["series", "Series"],
            ].map(([valor, texto]) => (
              <Link
                key={valor}
                href={(valor ? "/inventario/lotes?vista=series" : "/inventario/lotes") as Route}
                className="rounded border px-3 py-1 text-sm"
                style={{
                  borderColor: (vista ?? "") === valor ? "var(--acento)" : "var(--borde)",
                  background: (vista ?? "") === valor ? "var(--acento-suave)" : "var(--superficie)",
                  color: (vista ?? "") === valor ? "var(--acento)" : "var(--texto-suave)",
                }}
              >
                {texto}
              </Link>
            ))}
          </div>
        </form>

        {enSeries ? (
          <section className="tarjeta overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Series en stock
            </h2>
            {datos.series.length === 0 ? (
              <div className="p-4">
                <Vacio
                  titulo="No hay series en stock"
                  descripcion="Marque «controla serie» en la ficha del producto y cada unidad quedará identificada."
                />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Serie</th>
                    <th>Producto</th>
                    <th>Descripción</th>
                    <th>Lote</th>
                    <th>Almacén</th>
                    <th>Último movimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.series.map((s) => (
                    <tr key={`${s.codigo}-${s.serie}`}>
                      <td className="cifra" style={{ textAlign: "left" }}>{s.serie}</td>
                      <td className="cifra" style={{ textAlign: "left" }}>{s.codigo}</td>
                      <td className="max-w-[280px] truncate">{s.descripcion}</td>
                      <td className="cifra" style={{ textAlign: "left" }}>{s.lote ?? "—"}</td>
                      <td className="max-w-[160px] truncate">{s.almacen}</td>
                      <td className="cifra">{s.ultima_fecha}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ) : (
          <section className="tarjeta overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Existencias por lote
            </h2>
            {datos.lotes.length === 0 ? (
              <div className="p-4">
                <Vacio
                  titulo="No hay lotes con existencias"
                  descripcion="Marque «controla lote» en la ficha del producto; a partir de ahí, ningún movimiento suyo pasará sin lote."
                />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Producto</th>
                    <th>Descripción</th>
                    <th>Almacén</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Valor</th>
                    <th>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.lotes.map((l) => {
                    const dias = l.fecha_vencimiento ? diasHasta(hoy, l.fecha_vencimiento) : null;
                    return (
                      <tr key={`${l.producto_id}-${l.almacen_id}-${l.lote}`}>
                        <td className="cifra" style={{ textAlign: "left" }}>{l.lote}</td>
                        <td className="cifra" style={{ textAlign: "left" }}>{l.codigo}</td>
                        <td className="max-w-[240px] truncate">{l.descripcion}</td>
                        <td className="max-w-[140px] truncate">{l.almacen}</td>
                        <td className="cifra">{money.toString(money.dec(l.cantidad), 2)}</td>
                        <td><Importe valor={l.valor} /></td>
                        <td>
                          {l.fecha_vencimiento === null ? (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          ) : dias !== null && dias < 0 ? (
                            <Insignia tono="peligro">vencido</Insignia>
                          ) : dias !== null && dias <= 90 ? (
                            <Insignia tono="alerta">{l.fecha_vencimiento} · {dias} d</Insignia>
                          ) : (
                            <span className="cifra">{l.fecha_vencimiento}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
              Un lote sin fecha de vencimiento es un lote al que nadie le puso ficha: regístrelo
              arriba para que aparezca en los avisos.
            </p>
          </section>
        )}
      </Contenido>
    </>
  );
}
