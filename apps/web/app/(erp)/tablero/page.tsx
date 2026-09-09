import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Tablero · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * Tablero gerencial (el módulo SIG del contrato).
 *
 * Muestra lo que un gerente de una importadora mira al empezar el día: qué
 * embarques están en camino, cuánto capital hay parado en inventario y qué se
 * vence esta semana. Nada de gráficos por decorar: cada cifra lleva a la
 * pantalla donde se opera sobre ella.
 */
export default async function Tablero() {
  const datos = await conEmpresa(async (db) => {
    const [inventario] = (await db.execute(sql`
      SELECT coalesce(sum(valor), 0)::text AS valor,
             count(*) FILTER (WHERE cantidad > 0)::int AS con_stock
      FROM saldos_inventario`)) as unknown as [{ valor: string; con_stock: number }];

    const embarques = (await db.execute(sql`
      SELECT i.id, i.numero, i.estado, i.fecha_llegada, t.razon_social AS proveedor,
             coalesce(sum(it.cantidad * it.fob_unitario), 0)::text AS fob
      FROM importaciones i
      JOIN terceros t ON t.id = i.proveedor_id
      LEFT JOIN importacion_items it ON it.importacion_id = i.id
      WHERE i.estado NOT IN ('liquidada', 'anulada')
      GROUP BY i.id, t.razon_social
      ORDER BY i.fecha_orden DESC
      LIMIT 8`)) as unknown as {
      id: string;
      numero: string;
      estado: string;
      fecha_llegada: string | null;
      proveedor: string;
      fob: string;
    }[];

    const [cxp] = (await db.execute(sql`
      SELECT coalesce(sum(saldo), 0)::text AS total,
             coalesce(sum(saldo) FILTER (WHERE fecha_vencimiento < current_date), 0)::text AS vencido,
             count(*) FILTER (WHERE fecha_vencimiento < current_date)::int AS docs_vencidos
      FROM documentos_cxp WHERE estado IN ('pendiente', 'parcial')`)) as unknown as [
      { total: string; vencido: string; docs_vencidos: number },
    ];

    const bajoStock = (await db.execute(sql`
      SELECT p.codigo, p.descripcion, p.stock_minimo::text AS minimo,
             coalesce(sum(s.cantidad), 0)::text AS actual
      FROM productos p
      LEFT JOIN saldos_inventario s ON s.producto_id = p.id
      WHERE p.activo AND p.stock_minimo > 0 AND p.tipo = 'bien'
      GROUP BY p.id
      HAVING coalesce(sum(s.cantidad), 0) < p.stock_minimo
      ORDER BY p.codigo
      LIMIT 8`)) as unknown as {
      codigo: string;
      descripcion: string;
      minimo: string;
      actual: string;
    }[];

    return { inventario, embarques, cxp, bajoStock };
  }, "sig:ver");

  const fobEnTransito = datos.embarques.reduce(
    (a, e) => money.add(a, money.dec(e.fob)),
    money.ZERO,
  );

  return (
    <>
      <Encabezado
        titulo="Tablero"
        descripcion="Resumen de la operación al día de hoy."
      />
      <Contenido>
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador
            titulo="Inventario valorizado"
            valor={datos.inventario.valor}
            detalle={`${datos.inventario.con_stock} productos con stock`}
            href={"/inventario" as Route}
          />
          <Indicador
            titulo="Embarques en curso"
            valor={money.toString(fobEnTransito, 2)}
            detalle={`${datos.embarques.length} importaciones sin liquidar · FOB`}
            href={"/importaciones" as Route}
          />
          <Indicador
            titulo="Por pagar"
            valor={datos.cxp.total}
            detalle="Saldo pendiente a proveedores"
            href={"/cxp" as Route}
          />
          <Indicador
            titulo="Vencido"
            valor={datos.cxp.vencido}
            detalle={`${datos.cxp.docs_vencidos} documentos pasados de fecha`}
            href={"/cxp" as Route}
            alerta={Number(datos.cxp.vencido) > 0}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="tarjeta overflow-hidden">
            <div
              className="flex items-center justify-between border-b px-4 py-2.5"
              style={{ borderColor: "var(--borde)" }}
            >
              <h2 className="text-sm font-semibold">Embarques en curso</h2>
              <Link href="/importaciones" className="text-xs underline">
                Ver todos
              </Link>
            </div>
            {datos.embarques.length === 0 ? (
              <div className="p-4">
                <Vacio titulo="Nada en tránsito" descripcion="No hay importaciones abiertas." />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Proveedor</th>
                    <th>Llegada</th>
                    <th className="text-right">FOB</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.embarques.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/importaciones/${e.id}` as Route} className="font-medium underline">
                          {e.numero}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate">{e.proveedor}</td>
                      <td className="cifra">{e.fecha_llegada ?? "—"}</td>
                      <td>
                        <Importe valor={e.fob} />
                      </td>
                      <td>
                        <EstadoDoc estado={e.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="tarjeta overflow-hidden">
            <div
              className="flex items-center justify-between border-b px-4 py-2.5"
              style={{ borderColor: "var(--borde)" }}
            >
              <h2 className="text-sm font-semibold">Productos bajo el mínimo</h2>
              <Link href="/inventario" className="text-xs underline">
                Ver inventario
              </Link>
            </div>
            {datos.bajoStock.length === 0 ? (
              <div className="p-4">
                <Vacio
                  titulo="Nada por reponer"
                  descripcion="Ningún producto con stock mínimo definido está por debajo."
                />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.bajoStock.map((p) => (
                    <tr key={p.codigo}>
                      <td className="cifra" style={{ textAlign: "left" }}>
                        {p.codigo}
                      </td>
                      <td className="max-w-[220px] truncate">{p.descripcion}</td>
                      <td>
                        <span className="cifra negativo">
                          <Importe valor={p.actual} />
                        </span>
                      </td>
                      <td>
                        <Importe valor={p.minimo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </Contenido>
    </>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  href,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  href: Route;
  alerta?: boolean;
}) {
  return (
    <Link href={href} className="tarjeta block p-4 transition-colors hover:bg-[var(--superficie-2)]">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
        {titulo}
      </div>
      <div
        className="cifra mt-1.5 text-2xl font-semibold"
        style={{ textAlign: "left", color: alerta ? "var(--peligro)" : undefined }}
      >
        <span className="mr-1 text-base opacity-60">S/</span>
        <Importe valor={valor} />
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
        {detalle}
      </div>
    </Link>
  );
}
