import Link from "next/link";
import type { Route } from "next";
import {
  listarOrdenesPago, documentosOrdenables, listarTerceros, cuentasParaOperar,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioOrden } from "./formulario";

export const metadata = { title: "Órdenes de pago · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todas"],
  ["pendiente", "Por autorizar"],
  ["autorizada", "Autorizadas"],
  ["pagada", "Pagadas"],
  ["rechazada", "Rechazadas"],
  ["anulada", "Anuladas"],
] as const;

export default async function OrdenesPago({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; proveedor?: string }>;
}) {
  const { estado, proveedor } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const puedeCrear = await tienePermiso("cxp:crear");

  const datos = await conEmpresa(async (db) => {
    const [ordenes, proveedores, cuentas] = await Promise.all([
      listarOrdenesPago(db, filtro || undefined),
      listarTerceros(db, { rol: "proveedor" }),
      cuentasParaOperar(db),
    ]);
    const documentos = proveedor ? await documentosOrdenables(db, proveedor) : [];
    return { ordenes, proveedores, cuentas, documentos };
  }, "cxp:ver");

  return (
    <>
      <Encabezado
        titulo="Órdenes de pago"
        descripcion="Nadie paga una factura sin una orden autorizada. Separa a quien decide pagar de quien firma, y deja el rastro de por qué salió el dinero."
        acciones={
          <Link href={"/cxp" as Route} className="boton boton-secundario">
            Cuentas por pagar
          </Link>
        }
      />
      <Contenido>
        {puedeCrear && (
          <div className="mb-6">
            <FormularioOrden
              proveedorId={proveedor ?? ""}
              proveedores={datos.proveedores.map((p) => ({
                id: p.id,
                etiqueta: `${p.razonSocial} · ${p.numeroDocumento}`,
              }))}
              cuentas={datos.cuentas.map((c) => ({
                id: c.id,
                etiqueta: `${c.nombre} · ${c.moneda}`,
              }))}
              documentos={datos.documentos.map((d) => ({
                id: d.id,
                referencia: `${d.serie}-${d.numero}`,
                fechaEmision: d.fechaEmision,
                fechaVencimiento: d.fechaVencimiento,
                moneda: d.moneda,
                total: d.total,
                saldo: d.saldo,
                enOrden: d.enOrden,
                libre: d.libre,
              }))}
            />
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/cxp/ordenes-pago?estado=${valor}` : "/cxp/ordenes-pago") as Route}
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
          {datos.ordenes.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay órdenes de pago"
                descripcion="Elija un proveedor arriba, marque lo que se va a pagar y cree la orden."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Se paga el</th>
                  <th>Proveedor</th>
                  <th>Medio</th>
                  <th className="text-right">Importe</th>
                  <th>Solicitó</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.ordenes.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/cxp/ordenes-pago/${o.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {o.numero}
                      </Link>
                    </td>
                    <td className="cifra">{o.fecha}</td>
                    <td className="cifra">{o.fechaProgramada ?? "—"}</td>
                    <td className="max-w-[220px] truncate">{o.proveedor}</td>
                    <td><Insignia>{o.medioPago}</Insignia></td>
                    <td><Importe valor={o.importe} moneda={o.moneda} /></td>
                    <td className="max-w-[140px] truncate">{o.solicitante ?? "—"}</td>
                    <td>
                      <EstadoDoc estado={o.estado} />
                      {o.motivoRechazo && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          {o.motivoRechazo}
                        </p>
                      )}
                    </td>
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
