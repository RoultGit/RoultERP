import { listarPagos } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";

export const metadata = { title: "Pagos · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Pagos() {
  const pagos = await conEmpresa((db) => listarPagos(db), "cxp:ver");
  const puedeCrear = await tienePermiso("cxp:crear");

  const bruto = pagos.reduce((a, p) => money.add(a, money.dec(p.importeBruto)), money.ZERO);
  const retenido = pagos.reduce((a, p) => money.add(a, money.dec(p.retencionMonto)), money.ZERO);

  return (
    <>
      <Encabezado
        titulo="Pagos a proveedores"
        descripcion="Egresos aplicados a documentos por pagar."
        acciones={
          <>
            <BotonEnlace href="/cxp" variante="secundario">Cuentas por pagar</BotonEnlace>
            {puedeCrear && <BotonEnlace href="/cxp/pagar">Registrar pago</BotonEnlace>}
          </>
        }
      />
      <Contenido>
        {pagos.length === 0 ? (
          <Vacio
            titulo="Todavía no hay pagos"
            descripcion="Registrar un pago baja el saldo de los documentos, contabiliza la salida de fondos y, si corresponde, retiene el IGV."
            accion={puedeCrear ? <BotonEnlace href="/cxp/pagar">Registrar pago</BotonEnlace> : null}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Proveedor</th>
                  <th>Fecha</th>
                  <th>Medio</th>
                  <th>Referencia</th>
                  <th className="text-right">Bruto</th>
                  <th className="text-right">Retención</th>
                  <th className="text-right">Neto pagado</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.numero}</td>
                    <td className="max-w-[240px] truncate">{p.proveedor}</td>
                    <td className="cifra">{p.fecha}</td>
                    <td><Insignia>{p.medioPago}</Insignia></td>
                    <td style={{ color: "var(--texto-suave)" }}>{p.referencia ?? "—"}</td>
                    <td><Importe valor={p.importeBruto} /></td>
                    <td>
                      {money.isZero(money.dec(p.retencionMonto)) ? (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      ) : (
                        <Importe valor={p.retencionMonto} />
                      )}
                    </td>
                    <td><strong><Importe valor={p.importeNeto} /></strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Totales
                  </td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(bruto, 2)} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(retenido, 2)} /></td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(money.sub(bruto, retenido), 2)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!money.isZero(retenido) && (
          <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
            Lo retenido queda en la cuenta 40114 hasta entregarlo a SUNAT. Falta implementar la
            emisión del comprobante de retención.
          </p>
        )}
      </Contenido>
    </>
  );
}
