import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { cargarOrden, CompraInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Documento, Datos } from "@/components/documento";

export const metadata = { title: "Orden de compra · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * La orden de compra, en forma de documento.
 *
 * Es la hoja que se le manda al proveedor y la que el almacenero tiene delante
 * cuando llega la mercadería, así que lleva lo que hace falta para comprobar la
 * entrega: qué se pidió, cuánto, a qué precio y para cuándo.
 */
export default async function OrdenImpresa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const orden = await cargarOrden(db, id).catch((e) => {
      if (e instanceof CompraInvalida) return null;
      throw e;
    });
    if (!orden) return null;

    const [proveedor] = (await db.execute(sql`
      SELECT razon_social, numero_documento, direccion, telefono, email
      FROM terceros WHERE id = ${orden.cabecera.proveedorId}`)) as unknown as [
      {
        razon_social: string;
        numero_documento: string;
        direccion: string | null;
        telefono: string | null;
        email: string | null;
      },
    ];
    const [almacen] = orden.cabecera.almacenId
      ? ((await db.execute(sql`
          SELECT nombre FROM almacenes WHERE id = ${orden.cabecera.almacenId}`)) as unknown as [
          { nombre: string } | undefined,
        ])
      : [undefined];

    return { ...orden, proveedor, almacen };
  }, "compras:ver");

  if (!datos) notFound();
  const { cabecera, lineas, proveedor, almacen } = datos;

  return (
    <Documento
      titulo="Orden de compra"
      numero={cabecera.numero}
      fecha={cabecera.fecha}
      volverA={`/compras/ordenes/${id}`}
      volverTexto="Volver a la orden"
      firmas={["Solicitado por", "Aprobado por", "Conforme del proveedor"]}
    >
      <Datos
        pares={[
          ["Proveedor", proveedor?.razon_social ?? "—"],
          ["RUC", <span className="cifra">{proveedor?.numero_documento}</span>],
          ["Dirección", proveedor?.direccion ?? "—"],
          ["Contacto", [proveedor?.telefono, proveedor?.email].filter(Boolean).join(" · ") || "—"],
          ["Entregar en", almacen?.nombre ?? "—"],
          ["Fecha de entrega", cabecera.fechaEntrega ?? "por acordar"],
          ["Condición de pago", cabecera.condicionPago ?? "—"],
          [
            "Moneda",
            cabecera.moneda === "PEN"
              ? "Soles"
              : `${cabecera.moneda} · T/C ${money.toString(money.dec(cabecera.tipoCambio), 3)}`,
          ],
        ]}
      />

      <table className="tabla mt-3">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Código</th>
            <th>Descripción</th>
            <th className="text-right">Cantidad</th>
            <th className="text-right">V. unitario</th>
            <th className="text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.id}>
              <td className="cifra" style={{ textAlign: "left" }}>{l.linea}</td>
              <td className="cifra" style={{ textAlign: "left" }}>{l.codigo}</td>
              <td>{l.descripcion}</td>
              <td><Importe valor={l.cantidad} /></td>
              <td><Importe valor={l.valorUnitario} decimales={4} /></td>
              <td>
                <Importe
                  valor={money.toString(
                    money.sub(
                      money.round(money.mul(money.dec(l.cantidad), money.dec(l.valorUnitario)), 2),
                      money.dec(l.descuento ?? "0"),
                    ),
                    2,
                  )}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--texto-suave)" }}>Subtotal</dt>
            <dd><Importe valor={cabecera.subtotal} /></dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--texto-suave)" }}>IGV</dt>
            <dd><Importe valor={cabecera.igv} /></dd>
          </div>
          <div
            className="flex justify-between gap-4 border-t pt-1 font-semibold"
            style={{ borderColor: "var(--borde)" }}
          >
            <dt>Total</dt>
            <dd><Importe valor={cabecera.total} moneda={cabecera.moneda} /></dd>
          </div>
        </dl>
      </section>

      {cabecera.observaciones && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold">Observaciones</h2>
          <p className="text-sm">{cabecera.observaciones}</p>
        </section>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
        Esta orden no es un comprobante de pago. La factura del proveedor tiene que citar su número
        para poder recibirla contra ella.
      </p>
    </Documento>
  );
}
