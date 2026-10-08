import Link from "next/link";
import type { Route } from "next";
import { listarPedidos, cargarPedido } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";
import { Anular } from "./anular";

export const metadata = { title: "Pedidos de venta · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todos"],
  ["pendiente", "Pendientes"],
  ["parcial", "Parciales"],
  ["atendido", "Atendidos"],
  ["anulado", "Anulados"],
] as const;

/** Porcentaje despachado, para que la lista se lea de un vistazo. */
function avance(lineas: { cantidad: string; cantidadAtendida: string }[]): string {
  const pedido = lineas.reduce((a, l) => money.add(a, money.dec(l.cantidad)), money.ZERO);
  const atendido = lineas.reduce((a, l) => money.add(a, money.dec(l.cantidadAtendida)), money.ZERO);
  if (money.isZero(pedido)) return "—";
  return `${money.toString(money.mul(money.div(atendido, pedido), money.dec("100")), 0)} %`;
}

export default async function Pedidos({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; estado?: string }>;
}) {
  const { hecho, estado } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const puedeCrear = await tienePermiso("ventas:crear");

  const pedidos = await conEmpresa(async (db) => {
    const filas = await listarPedidos(db, filtro || undefined);
    // El avance necesita el detalle. Son 300 pedidos como máximo y sólo en esta
    // pantalla: no justifica una vista ni un contador denormalizado.
    return Promise.all(
      filas.map(async (p) => {
        const { lineas } = await cargarPedido(db, p.id);
        return { ...p, avance: avance(lineas), lineas: lineas.length };
      }),
    );
  }, "ventas:ver");

  return (
    <>
      <Encabezado
        titulo="Pedidos de venta"
        descripcion="Lo que el cliente encargó y todavía no se le facturó. Se despacha contra el pedido: la factura descuenta su saldo y lo cierra cuando llega a cero."
        acciones={
          <Link href={"/ventas/cotizaciones" as Route} className="boton boton-secundario">
            Cotizaciones
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

        <div className="flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/ventas/pedidos?estado=${valor}` : "/ventas/pedidos") as Route}
              className="rounded border px-3 py-1 text-sm"
              style={{
                borderColor: filtro === valor ? "var(--acento)" : "var(--borde)",
                background: filtro === valor ? "var(--acento-suave)" : "var(--superficie)",
                color: filtro === valor ? "var(--acento)" : "var(--texto-suave)",
              }}
              aria-current={filtro === valor ? "true" : undefined}
            >
              {texto}
            </Link>
          ))}
        </div>

        <section className="bloque overflow-x-auto">
          {pedidos.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay pedidos"
                descripcion="Un pedido nace de una cotización aceptada, o se registra directo desde la pantalla de cotizaciones."
                accion={
                  <Link href={"/ventas/cotizaciones" as Route} className="boton boton-primario">
                    Ir a cotizaciones
                  </Link>
                }
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Entrega</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Despachado</th>
                  <th>Estado</th>
                  {puedeCrear && <th className="w-[200px]" />}
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.numero}</td>
                    <td className="max-w-[240px] truncate">{p.cliente}</td>
                    <td className="cifra">{p.fecha}</td>
                    <td className="cifra">{p.fechaEntrega ?? "—"}</td>
                    <td><Importe valor={p.total} moneda={p.moneda} /></td>
                    <td className="cifra">{p.avance}</td>
                    <td><EstadoDoc estado={p.estado} /></td>
                    {puedeCrear && (
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(p.estado === "pendiente" || p.estado === "parcial") && (
                            <Link
                              href={`/ventas/nueva?pedido=${p.id}` as Route}
                              className="boton boton-primario boton-chico"
                            >
                              Facturar
                            </Link>
                          )}
                          {p.estado === "pendiente" && <Anular pedidoId={p.id} />}
                        </div>
                      </td>
                    )}
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
