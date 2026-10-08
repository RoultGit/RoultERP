import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { cargarOrden, CompraInvalida } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe } from "@/components/ui";
import { Aprobar } from "./aprobar";

export const metadata = { title: "Orden de compra · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Orden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const orden = await cargarOrden(db, id).catch((e) => {
      if (e instanceof CompraInvalida) return null;
      throw e;
    });
    if (!orden) return null;

    const [proveedor] = await db
      .select({ razonSocial: schema.terceros.razonSocial, doc: schema.terceros.numeroDocumento })
      .from(schema.terceros)
      .where(eq(schema.terceros.id, orden.cabecera.proveedorId))
      .limit(1);

    // De dónde vino, si vino de algún sitio: es lo que contesta «¿por qué le
    // compramos a éste?» cuando alguien lo pregunte dentro de un año.
    const [origen] = orden.cabecera.cotizacionProveedorId
      ? await db
          .select({
            cotizacion: schema.cotizacionesProveedor.numero,
            solicitudId: schema.cotizacionesProveedor.solicitudId,
          })
          .from(schema.cotizacionesProveedor)
          .where(eq(schema.cotizacionesProveedor.id, orden.cabecera.cotizacionProveedorId))
          .limit(1)
      : [];

    const [requisicion] = orden.cabecera.requisicionId
      ? await db
          .select({ numero: schema.requisiciones.numero })
          .from(schema.requisiciones)
          .where(eq(schema.requisiciones.id, orden.cabecera.requisicionId))
          .limit(1)
      : [];

    return { ...orden, proveedor, origen, requisicion };
  }, "compras:ver");

  if (!datos) notFound();

  const { cabecera, lineas } = datos;
  const puedeAprobar = await tienePermiso("compras:aprobar");

  return (
    <>
      <Encabezado
        titulo={`Orden de compra ${cabecera.numero}`}
        descripcion={`${datos.proveedor?.razonSocial ?? ""} · ${datos.proveedor?.doc ?? ""}`}
        acciones={
          <>
            {puedeAprobar && cabecera.estado === "borrador" && <Aprobar id={cabecera.id} />}
            {/* La orden se imprime y se manda al proveedor: es un documento. */}
            <Link
              href={`/compras/ordenes/${cabecera.id}/impresion` as Route}
              className="boton boton-secundario"
            >
              Imprimir
            </Link>
            <Link href={"/compras?vista=ordenes" as Route} className="boton boton-secundario">
              Volver
            </Link>
          </>
        }
      />
      <Contenido>
        <section className="bloque mb-5 p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="etiqueta">Estado</dt>
              <dd><EstadoDoc estado={cabecera.estado} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Fecha</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fecha}</dd>
            </div>
            <div>
              <dt className="etiqueta">Entrega</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fechaEntrega ?? "—"}</dd>
            </div>
            <div>
              <dt className="etiqueta">Moneda</dt>
              <dd>{cabecera.moneda} · T.C. {money.toString(money.dec(cabecera.tipoCambio), 3)}</dd>
            </div>
            {cabecera.condicionPago && (
              <div>
                <dt className="etiqueta">Condición de pago</dt>
                <dd>{cabecera.condicionPago}</dd>
              </div>
            )}
            {datos.requisicion && (
              <div>
                <dt className="etiqueta">Requisición</dt>
                <dd className="cifra" style={{ textAlign: "left" }}>{datos.requisicion.numero}</dd>
              </div>
            )}
            {datos.origen && (
              <div>
                <dt className="etiqueta">Cotización elegida</dt>
                <dd>
                  <Link
                    href={`/compras/cotizaciones/${datos.origen.solicitudId}` as Route}
                    className="cifra underline"
                    style={{ textAlign: "left" }}
                  >
                    {datos.origen.cotizacion}
                  </Link>
                </dd>
              </div>
            )}
            {cabecera.observaciones && (
              <div className="sm:col-span-2">
                <dt className="etiqueta">Observaciones</dt>
                <dd>{cabecera.observaciones}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="bloque overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Detalle
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Producto</th>
                <th className="text-right">Pedido</th>
                <th className="text-right">Recibido</th>
                <th className="text-right">V. unitario</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td className="cifra">{l.linea}</td>
                  <td>
                    <span className="cifra mr-2" style={{ color: "var(--texto-suave)" }}>{l.codigo}</span>
                    {l.descripcion}
                  </td>
                  <td className="cifra">{money.toString(money.dec(l.cantidad), 2)}</td>
                  <td className="cifra">{money.toString(money.dec(l.cantidadRecibida), 2)}</td>
                  <td><Importe valor={l.valorUnitario} moneda={cabecera.moneda} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "var(--superficie-2)" }}>
                <td colSpan={4} className="px-3 py-1.5 text-right text-xs uppercase">Subtotal</td>
                <td><Importe valor={cabecera.subtotal} moneda={cabecera.moneda} /></td>
              </tr>
              <tr style={{ background: "var(--superficie-2)" }}>
                <td colSpan={4} className="px-3 py-1.5 text-right text-xs uppercase">IGV</td>
                <td><Importe valor={cabecera.igv} moneda={cabecera.moneda} /></td>
              </tr>
              <tr style={{ background: "var(--superficie-2)" }}>
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</td>
                <td className="font-semibold"><Importe valor={cabecera.total} moneda={cabecera.moneda} /></td>
              </tr>
            </tfoot>
          </table>
        </section>

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          La columna «recibido» la mueve el registro de la factura del proveedor. La orden no genera
          asiento ni entra al kardex: eso ocurre cuando llega el documento.
        </p>
      </Contenido>
    </>
  );
}
