import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { existencias } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Inventario · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Inventario({
  searchParams,
}: {
  searchParams: Promise<{ almacen?: string }>;
}) {
  const { almacen } = await searchParams;

  const { saldos, almacenes, metodo } = await conEmpresa(async (db) => {
    const almacenes = (await db.execute(sql`
      SELECT id, codigo, nombre, es_transito FROM almacenes WHERE activo ORDER BY codigo`)) as unknown as {
      id: string;
      codigo: string;
      nombre: string;
      es_transito: boolean;
    }[];
    const [emp] = (await db.execute(
      sql`SELECT metodo_valorizacion FROM empresas`,
    )) as unknown as [{ metodo_valorizacion: string }];
    return {
      saldos: await existencias(db, almacen),
      almacenes,
      metodo: emp?.metodo_valorizacion ?? "promedio",
    };
  }, "inventario:ver");

  const total = saldos.reduce((a, s) => money.add(a, money.dec(s.valor)), money.ZERO);

  return (
    <>
      <Encabezado
        titulo="Inventario"
        descripcion={`Existencias valorizadas por ${
          metodo === "peps" ? "primeras entradas, primeras salidas (PEPS)" : "promedio ponderado móvil"
        }.`}
        acciones={
          <Link href={"/inventario/notas" as Route} className="boton boton-primario">
            Notas de almacén
          </Link>
        }
      />
      <Contenido>
        <div className="flex flex-wrap items-center gap-2">
          <Filtro href="/inventario" activo={!almacen}>
            Todos los almacenes
          </Filtro>
          {almacenes.map((a) => (
            <Filtro key={a.id} href={{ pathname: "/inventario", query: { almacen: a.id } }} activo={almacen === a.id}>
              {a.nombre}
              {a.es_transito && " (tránsito)"}
            </Filtro>
          ))}
        </div>

        {saldos.length === 0 ? (
          <Vacio
            titulo="Sin existencias"
            descripcion="Todavía no ha ingresado mercadería a este almacén. Los ingresos llegan al liquidar una importación o al recibir una compra."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Almacén</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Costo unitario</th>
                  <th className="text-right">Valor</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {saldos.map((s) => (
                  <tr key={`${s.almacenId}-${s.productoId}`}>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {s.codigo}
                    </td>
                    <td className="max-w-[280px] truncate">{s.descripcion}</td>
                    <td style={{ color: "var(--texto-suave)" }}>{s.almacen}</td>
                    <td>
                      <Importe valor={s.cantidad} />
                    </td>
                    <td>
                      <Importe
                        valor={
                          money.isZero(money.dec(s.cantidad))
                            ? "0"
                            : money.toString(
                                money.div(money.dec(s.valor), money.dec(s.cantidad)),
                                4,
                              )
                        }
                        decimales={4}
                      />
                    </td>
                    <td>
                      <Importe valor={s.valor} />
                    </td>
                    <td>
                      <Link
                        href={{
                          pathname: "/inventario/kardex",
                          query: { producto: s.productoId, almacen: s.almacenId },
                        }}
                        className="text-xs underline"
                      >
                        Kardex
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Total valorizado
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(total, 2)} moneda="PEN" />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}

function Filtro({
  href,
  activo,
  children,
}: {
  href: React.ComponentProps<typeof Link>["href"];
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded border px-2.5 py-1 text-xs transition-colors"
      style={{
        borderColor: activo ? "var(--acento)" : "var(--borde)",
        background: activo ? "var(--acento-suave)" : "var(--superficie)",
        color: activo ? "var(--acento)" : "var(--texto-suave)",
      }}
    >
      {children}
    </Link>
  );
}
