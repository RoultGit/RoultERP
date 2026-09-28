import Link from "next/link";
import type { Route } from "next";
import {
  listarCotizaciones, cargarCotizacion, listarTerceros, listarProductos,
  listarAlmacenes, vencerCotizaciones,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";
import { FormularioCotizacion } from "./formulario";
import { Acciones } from "./acciones-fila";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Cotizaciones · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Cotizaciones({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { hecho } = await searchParams;
  const puedeCrear = await tienePermiso("ventas:crear");
  const hoy = hoyEnPeru();

  const datos = await conEmpresa(async (db) => {
    // No hay proceso nocturno: se vencen al mirar la lista, que es cuando
    // importa que el estado diga la verdad.
    if (puedeCrear) await vencerCotizaciones(db, hoy);
    const [cotizaciones, clientes, productos, almacenes] = await Promise.all([
      listarCotizaciones(db),
      listarTerceros(db, { rol: "cliente" }),
      listarProductos(db),
      listarAlmacenes(db),
    ]);
    return { cotizaciones, clientes, productos, almacenes };
  }, "ventas:ver");

  return (
    <>
      <Encabezado
        titulo="Cotizaciones"
        descripcion="El precio que se le ofreció al cliente, con su fecha de caducidad. Cuando lo acepta, se convierte en pedido conservando esos precios."
        acciones={
          <Link href={"/ventas/pedidos" as Route} className="boton boton-secundario">
            Pedidos
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

        {puedeCrear && (
          <div className="mb-5">
            <FormularioCotizacion
              clientes={datos.clientes.map((c) => ({
                id: c.id,
                etiqueta: `${c.razonSocial} · ${c.numeroDocumento}`,
              }))}
              productos={datos.productos
                .filter((p) => p.activo)
                .map((p) => ({
                  id: p.id,
                  etiqueta: `${p.codigo} — ${p.descripcion}`,
                  descripcion: p.descripcion,
                  afectacion: p.afectacionIgv,
                }))}
            />
          </div>
        )}

        <section className="tarjeta overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Emitidas
          </h2>
          {datos.cotizaciones.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay cotizaciones"
                descripcion="Aquí queda lo que se le ofreció a cada cliente antes de facturar."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Válida hasta</th>
                  <th className="text-right">Total</th>
                  <th>Estado</th>
                  {puedeCrear && <th className="w-[280px]" />}
                </tr>
              </thead>
              <tbody>
                {datos.cotizaciones.map((c) => (
                  <tr key={c.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{c.numero}</td>
                    <td className="max-w-[240px] truncate">{c.cliente}</td>
                    <td className="cifra">{c.fecha}</td>
                    <td className="cifra">{c.validaHasta ?? "—"}</td>
                    <td><Importe valor={c.total} moneda={c.moneda} /></td>
                    <td><EstadoDoc estado={c.estado} /></td>
                    {puedeCrear && (
                      <td>
                        <Acciones
                          cotizacionId={c.id}
                          estado={c.estado}
                          hoy={hoy}
                          almacenes={datos.almacenes
                            .filter((a) => a.activo && !a.esTransito)
                            .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
                        />
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
