import Link from "next/link";
import type { Route } from "next";
import {
  gastoPorAgencia, comprasPorProveedorExterior, articulosMasImportados,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Reportes de importaciones · RoultERP" };
export const dynamic = "force-dynamic";

/** Año en curso: el rango con el que se mira un histórico de compras. */
function anioActual(): { desde: string; hasta: string } {
  const a = new Date().getUTCFullYear();
  return { desde: `${a}-01-01`, hasta: `${a}-12-31` };
}

const fecha = (v: string | undefined, porDefecto: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : porDefecto;

/**
 * Los tres reportes de conjunto que pidió el cliente.
 *
 * Todas las cifras van en soles, con el tipo de cambio de cada operación. Sumar
 * dólares de enero con dólares de noviembre da un número que no significa nada,
 * y el equivalente en soles es además el que cuadra con la contabilidad.
 *
 * El FOB y el costo puesto en almacén se presentan en columnas separadas a
 * propósito, y el costo sólo cuenta los embarques liquidados —con su contador al
 * lado—. Mezclarlos daría un costo del año entero calculado con dos embarques.
 */
export default async function ReportesImportacion({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const p = await searchParams;
  const base = anioActual();
  const rango = { desde: fecha(p.desde, base.desde), hasta: fecha(p.hasta, base.hasta) };

  const { agencias, proveedores, articulos } = await conEmpresa(
    async (db) => ({
      agencias: await gastoPorAgencia(db, rango),
      proveedores: await comprasPorProveedorExterior(db, rango),
      articulos: await articulosMasImportados(db, rango),
    }),
    "importaciones:ver",
  );

  const suma = (xs: readonly string[]) => xs.reduce((a, v) => a + Number(v), 0).toFixed(2);

  return (
    <>
      <Encabezado
        titulo="Reportes de importaciones"
        descripcion="Gasto por agencia, compras por proveedor del exterior y artículos más importados."
        acciones={
          <div className="flex items-center gap-2">
            <Link href={"/importaciones/pendientes" as Route} className="boton boton-secundario">
              En camino
            </Link>
            <Link href={"/importaciones" as Route} className="boton boton-secundario">
              Embarques
            </Link>
          </div>
        }
      />
      <Contenido>
        <form
          className="bloque mb-5 flex flex-wrap items-end gap-3 p-4"
          action="/importaciones/reportes"
        >
          <div>
            <label className="etiqueta" htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={rango.desde} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={rango.hasta} className="campo" />
          </div>
          <button className="boton boton-primario">Ver</button>
          <p className="ml-auto max-w-md text-xs" style={{ color: "var(--texto-suave)" }}>
            El rango filtra por fecha de orden en los dos primeros cuadros y por fecha del gasto en
            el de agencias: un gasto de octubre sobre un embarque de agosto es gasto de octubre.
          </p>
        </form>

        {/* ─── Gasto por agencia de aduanas ─────────────────────────────── */}
        <section className="bloque mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Gasto por agencia de aduanas y servicios
          </h2>
          {agencias.length === 0 ? (
            <div className="p-4">
              <Vacio titulo="Sin gastos en el rango" descripcion="Cambie las fechas o registre gastos en un embarque." />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th className="text-right">Embarques</th>
                  <th className="text-right">Conceptos</th>
                  <th className="text-right">Gasto al costo (S/)</th>
                  <th className="text-right">Recuperable (S/)</th>
                </tr>
              </thead>
              <tbody>
                {agencias.map((a) => (
                  <tr key={a.proveedorId ?? "sin"}>
                    <td className="max-w-[320px] truncate">{a.proveedor}</td>
                    <td className="cifra">{a.embarques}</td>
                    <td className="cifra">{a.conceptos}</td>
                    <td className="font-medium"><Importe valor={a.importe} /></td>
                    <td style={{ color: "var(--texto-suave)" }}><Importe valor={a.importeRecuperable} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</td>
                  <td className="px-3 py-2 font-medium">
                    <Importe valor={suma(agencias.map((a) => a.importe))} />
                  </td>
                  <td className="px-3 py-2">
                    <Importe valor={suma(agencias.map((a) => a.importeRecuperable))} />
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            La columna recuperable es el IGV, el IPM y la percepción: es crédito fiscal y no lo que
            cobra la agencia. Sumarla haría parecer que cobra un 18 % más.
          </p>
        </section>

        {/* ─── Compras por proveedor del exterior ────────────────────────── */}
        <section className="bloque mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Compras por proveedor del exterior
          </h2>
          {proveedores.length === 0 ? (
            <div className="p-4">
              <Vacio titulo="Sin importaciones en el rango" descripcion="Cambie las fechas o dé de alta un embarque." />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>País</th>
                  <th className="text-right">Embarques</th>
                  <th className="text-right">FOB</th>
                  <th className="text-right">FOB (S/)</th>
                  <th className="text-right">Costo en almacén (S/)</th>
                  <th className="text-right">Liquidados</th>
                </tr>
              </thead>
              <tbody>
                {proveedores.map((p) => (
                  <tr key={p.proveedorId}>
                    <td className="max-w-[300px] truncate">{p.proveedor}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.pais}</td>
                    <td className="cifra">{p.embarques}</td>
                    <td>
                      <Importe valor={p.fob} /> <span className="text-xs">{p.moneda}</span>
                    </td>
                    <td className="font-medium"><Importe valor={p.fobSoles} /></td>
                    <td>
                      {p.embarquesLiquidados === 0 ? (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      ) : (
                        <Importe valor={p.costoAlmacen} />
                      )}
                    </td>
                    <td className="cifra" style={{ color: "var(--texto-suave)" }}>
                      {p.embarquesLiquidados} de {p.embarques}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            El FOB es lo que cobra el exportador; el costo en almacén sale de la liquidación, con
            flete, derechos y agencia prorrateados, y sólo cuenta los embarques liquidados. La última
            columna dice cuántos son: sin ella, doce embarques con dos liquidados darían un costo que
            parece del año entero.
          </p>
        </section>

        {/* ─── Artículos más importados ──────────────────────────────────── */}
        <section className="bloque overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Artículos más importados
          </h2>
          {articulos.length === 0 ? (
            <div className="p-4">
              <Vacio titulo="Sin artículos en el rango" descripcion="Cambie las fechas o agregue ítems a un embarque." />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Código</th>
                  <th>Artículo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Embarques</th>
                  <th className="text-right">FOB (S/)</th>
                  <th className="text-right">Costo en almacén (S/)</th>
                  <th className="text-right">Sobrecosto</th>
                </tr>
              </thead>
              <tbody>
                {articulos.map((a, i) => (
                  <tr key={a.productoId}>
                    <td className="cifra">{i + 1}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{a.codigo}</td>
                    <td className="max-w-[280px] truncate">
                      {a.nombre}
                      {a.unidad ? (
                        <span className="ml-1 text-xs" style={{ color: "var(--texto-suave)" }}>
                          {a.unidad}
                        </span>
                      ) : null}
                    </td>
                    <td className="cifra">{a.cantidad}</td>
                    <td className="cifra">{a.embarques}</td>
                    <td><Importe valor={a.fobSoles} /></td>
                    <td>
                      {a.sobrecosto === null ? (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      ) : (
                        <Importe valor={a.costoAlmacen} />
                      )}
                    </td>
                    <td className="cifra">
                      {a.sobrecosto === null ? (
                        <span
                          style={{ color: "var(--texto-suave)" }}
                          title="Ningún embarque de este artículo está liquidado todavía, así que no hay costo final que comparar."
                        >
                          sin liquidar
                        </span>
                      ) : (
                        <strong style={{ color: "var(--alerta)" }}>{a.sobrecosto} %</strong>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            El sobrecosto es cuánto encarece el viaje sobre el FOB, medido sólo con la parte
            liquidada. Sin liquidar sale en blanco y no en cero: un cero diría que importar no
            encarece nada, que es lo contrario de «aún no se sabe».
          </p>
        </section>
      </Contenido>
    </>
  );
}
