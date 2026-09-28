import { notFound } from "next/navigation";
import { chequeVoucher, CajaInvalida } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Importe, Insignia } from "@/components/ui";
import { Documento, Datos } from "@/components/documento";

export const metadata = { title: "Cheque-voucher · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "N. crédito", "08": "N. débito", "14": "Recibo",
};

/**
 * El cheque-voucher.
 *
 * El cheque lo imprime el banco en su talonario; esto es el comprobante que se
 * archiva con él: dice **qué se está pagando**, no sólo cuánto. Sin el detalle,
 * quien firma no tiene forma de saber si el cheque corresponde a las facturas
 * que autorizó, y el proveedor no sabe qué le cancelaron.
 *
 * Va con casillas de firma porque un egreso sin firma es la puerta por la que
 * se va el dinero de una empresa.
 */
export default async function Voucher({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const v = await conEmpresa(
    (db) =>
      chequeVoucher(db, id).catch((e) => {
        if (e instanceof CajaInvalida) return null;
        throw e;
      }),
    "caja_bancos:ver",
  );
  if (!v) notFound();

  const { cheque, pago, documentos, importeEnLetras } = v;
  const letras = importeEnLetras.startsWith("SON ") ? importeEnLetras : `SON ${importeEnLetras}`;

  return (
    <Documento
      titulo="Cheque-voucher"
      numero={cheque.numero}
      fecha={cheque.fechaGiro}
      volverA="/caja-bancos/cheques"
      volverTexto="Volver a cheques"
      firmas={["Elaborado por", "Revisado por", "Autorizado por", "Recibí conforme"]}
    >
      <Datos
        pares={[
          ["Páguese a", cheque.beneficiario],
          ["Banco", cheque.banco ?? cheque.cuenta],
          ["Cuenta", <span className="cifra">{cheque.numeroCuenta ?? cheque.cuentaContable}</span>],
          [
            "Fecha de giro",
            <span className="cifra">{cheque.fechaGiro}</span>,
          ],
          [
            "No negociable antes de",
            <span className="cifra">{cheque.fechaCobro ?? "a la vista"}</span>,
          ],
          ["Estado", <Insignia>{cheque.estado}</Insignia>],
          ...(pago
            ? ([
                ["Pago", <span className="cifra">{pago.numero}</span>],
                ["Referencia", pago.referencia ?? "—"],
              ] as [string, React.ReactNode][])
            : []),
        ]}
      />

      <section className="mt-4">
        <h2 className="mb-1 text-sm font-semibold">Documentos que cancela</h2>
        {documentos.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
            Este cheque no se giró contra documentos registrados. En la glosa tiene que quedar
            escrito el motivo del egreso, o el voucher no explica por qué salió el dinero.
          </p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Emisión</th>
                <th>Mon.</th>
                <th className="text-right">Total</th>
                <th className="text-right">Se cancela</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={`${d.serie}-${d.numero}`}>
                  <td className="cifra" style={{ textAlign: "left" }}>
                    {DOCUMENTO[d.tipoDocumento] ?? d.tipoDocumento} {d.serie}-{d.numero}
                  </td>
                  <td className="cifra">{d.fechaEmision}</td>
                  <td>{d.moneda}</td>
                  <td><Importe valor={d.total} /></td>
                  <td className="font-medium"><Importe valor={d.aplicado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section
        className="mt-4 flex items-end justify-between gap-6 border-t pt-3"
        style={{ borderColor: "var(--borde)" }}
      >
        <p className="text-sm font-medium">{letras}</p>
        <p className="text-xl font-semibold">
          <Importe valor={cheque.importe} moneda={cheque.moneda} />
        </p>
      </section>

      {cheque.observaciones && (
        <p className="mt-3 text-sm">{cheque.observaciones}</p>
      )}

      {cheque.estado === "anulado" && (
        <p className="mt-3 text-sm" style={{ color: "var(--peligro)" }}>
          Cheque anulado. El voucher se conserva porque la numeración del talonario no puede
          saltarse, pero no respalda ningún pago.
        </p>
      )}
    </Documento>
  );
}
