import Link from "next/link";
import { listarCobranzas } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Cobranzas · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Cobranzas() {
  const cobranzas = await conEmpresa((db) => listarCobranzas(db), "cxc:ver");
  const puedeCrear = await tienePermiso("cxc:crear");
  const total = cobranzas.reduce((a, c) => money.add(a, money.dec(c.importe)), money.ZERO);

  return (
    <>
      <Encabezado
        titulo="Cobranzas"
        descripcion="Ingresos aplicados a comprobantes por cobrar."
        acciones={
          <>
            <Link href="/cxc" className="boton boton-secundario">Cuentas por cobrar</Link>
            {puedeCrear && <Link href="/cxc/cobrar" className="boton boton-primario">Registrar cobranza</Link>}
          </>
        }
      />
      <Contenido>
        {cobranzas.length === 0 ? (
          <Vacio
            titulo="Todavía no hay cobranzas"
            descripcion="Registrar una cobranza baja el saldo de los comprobantes y contabiliza el ingreso."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Medio</th>
                  <th>Referencia</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {cobranzas.map((c) => (
                  <tr key={c.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{c.numero}</td>
                    <td className="max-w-[260px] truncate">{c.cliente}</td>
                    <td className="cifra">{c.fecha}</td>
                    <td><Insignia>{c.medioCobro}</Insignia></td>
                    <td style={{ color: "var(--texto-suave)" }}>{c.referencia ?? "—"}</td>
                    <td><strong><Importe valor={c.importe} /></strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Total cobrado
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(total, 2)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
