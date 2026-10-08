import Link from "next/link";
import type { Route } from "next";
import { rotacionInventario, stockMensual, listarAlmacenes } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Rotación y stock mensual · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Primer y último día de un periodo AAAAMM. */
function limites(periodo: string): { desde: string; hasta: string } {
  const a = Number(periodo.slice(0, 4));
  const m = Number(periodo.slice(4, 6));
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${ultimo}` };
}

export default async function Rotacion({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; almacen?: string; vista?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();
  const almacen = params.almacen;
  const enStock = params.vista === "stock";
  const rango = limites(periodo);

  const datos = await conEmpresa(async (db) => {
    const [rotacion, stock, almacenes] = await Promise.all([
      rotacionInventario(db, rango, almacen),
      stockMensual(db, periodo, almacen),
      listarAlmacenes(db),
    ]);
    return { rotacion, stock, almacenes };
  }, "inventario:ver");

  const dormido = datos.rotacion.filter((r) => r.sinMovimiento);
  const inmovilizado = dormido.reduce(
    (a, r) => money.add(a, money.dec(r.stockPromedio)),
    money.ZERO,
  );

  return (
    <>
      <Encabezado
        titulo="Rotación y stock mensual"
        descripcion="Cuánto tiempo duerme la mercadería antes de venderse. Un artículo con cero vueltas y stock es capital inmovilizado que en el balance figura como activo."
        acciones={
          <Link href={"/inventario" as Route} className="boton boton-secundario">
            Existencias
          </Link>
        }
      />
      <Contenido>
        <form className="bloque mb-5 flex flex-wrap items-end gap-3 p-4" action="/inventario/rotacion">
          <input type="hidden" name="vista" value={enStock ? "stock" : ""} />
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} placeholder="202609" />
          </div>
          <div className="min-w-[220px]">
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
          <button className="boton boton-primario">Ver</button>

          <div className="ml-auto flex gap-1.5">
            {[
              ["", "Rotación"],
              ["stock", "Stock mensual"],
            ].map(([valor, texto]) => (
              <Link
                key={valor}
                href={
                  (valor
                    ? `/inventario/rotacion?periodo=${periodo}&vista=stock`
                    : `/inventario/rotacion?periodo=${periodo}`) as Route
                }
                className="rounded border px-3 py-1 text-sm"
                style={{
                  borderColor: (params.vista ?? "") === valor ? "var(--acento)" : "var(--borde)",
                  background:
                    (params.vista ?? "") === valor ? "var(--acento-suave)" : "var(--superficie)",
                  color: (params.vista ?? "") === valor ? "var(--acento)" : "var(--texto-suave)",
                }}
              >
                {texto}
              </Link>
            ))}
          </div>
        </form>

        {!enStock && dormido.length > 0 && (
          <section className="bloque mb-5 p-4">
            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
              Capital inmovilizado — {dormido.length}{" "}
              {dormido.length === 1 ? "artículo sin salidas" : "artículos sin salidas"} en el periodo
            </div>
            <div className="text-lg font-medium" style={{ color: "var(--alerta)" }}>
              <Importe valor={money.toString(inmovilizado, 2)} />
            </div>
          </section>
        )}

        <section className="bloque overflow-x-auto">
          {enStock ? (
            datos.stock.length === 0 ? (
              <div className="p-4">
                <Vacio titulo="Sin movimientos ni saldos" descripcion={`Nada que mostrar en ${periodo}.`} />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Almacén</th>
                    <th className="text-right">Inicial</th>
                    <th className="text-right">Entradas</th>
                    <th className="text-right">Salidas</th>
                    <th className="text-right">Final</th>
                    <th className="text-right">Valor final</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.stock.map((s) => (
                    <tr key={`${s.productoId}-${s.almacen}`}>
                      <td className="cifra" style={{ textAlign: "left" }}>{s.codigo}</td>
                      <td className="max-w-[260px] truncate">{s.descripcion}</td>
                      <td className="max-w-[140px] truncate">{s.almacen}</td>
                      <td className="cifra">{s.inicial}</td>
                      <td className="cifra">{s.ingresos}</td>
                      <td className="cifra">{s.salidas}</td>
                      <td className="cifra font-medium">{s.final}</td>
                      <td><Importe valor={s.valorFinal} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : datos.rotacion.length === 0 ? (
            <div className="p-4">
              <Vacio titulo="Sin existencias ni consumo" descripcion={`Nada que medir en ${periodo}.`} />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th className="text-right">Consumo</th>
                  <th className="text-right">Stock promedio</th>
                  <th className="text-right">Vueltas</th>
                  <th className="text-right">Días en almacén</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datos.rotacion.map((r) => (
                  <tr key={r.productoId}>
                    <td className="cifra" style={{ textAlign: "left" }}>{r.codigo}</td>
                    <td className="max-w-[280px] truncate">{r.descripcion}</td>
                    <td><Importe valor={r.consumo} /></td>
                    <td><Importe valor={r.stockPromedio} /></td>
                    <td className="cifra font-medium">{r.vueltas}</td>
                    <td className="cifra">
                      {r.diasEnAlmacen === "0.0" ? "—" : r.diasEnAlmacen}
                    </td>
                    <td>
                      {r.sinMovimiento && <Insignia tono="alerta">sin movimiento</Insignia>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            La rotación se mide sobre costos, no sobre precios de venta: mezclarlos infla el
            resultado por el margen.
          </p>
        </section>
      </Contenido>
    </>
  );
}
