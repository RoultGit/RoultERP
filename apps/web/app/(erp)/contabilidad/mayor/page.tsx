import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { mayorDeCuenta } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Mayor · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Mayor({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; periodo?: string }>;
}) {
  const { cuenta, periodo } = await searchParams;
  if (!cuenta) notFound();

  const filas = (await conEmpresa(
    (db) => mayorDeCuenta(db, cuenta, periodo),
    "contabilidad:ver",
  )) as unknown as {
    fecha: string;
    numero: string;
    glosa_asiento: string;
    glosa: string | null;
    debe: string;
    haber: string;
    documento_tipo: string | null;
    documento_serie: string | null;
    documento_numero: string | null;
  }[];

  // El saldo corrido se calcula recorriendo el mayor, que es como se lee: cada
  // línea muestra en qué quedó la cuenta después de ese movimiento.
  let saldo = money.ZERO;
  const conSaldo = filas.map((f) => {
    saldo = money.add(saldo, money.sub(money.dec(f.debe), money.dec(f.haber)));
    return { ...f, saldo };
  });

  return (
    <>
      <Encabezado
        titulo={`Mayor de la cuenta ${cuenta}`}
        descripcion={periodo ? `Periodo ${periodo}` : "Todos los periodos"}
        acciones={
          <Link
            href={(periodo ? `/contabilidad?periodo=${periodo}` : "/contabilidad") as Route}
            className="boton boton-secundario"
          >
            Volver al balance
          </Link>
        }
      />
      <Contenido>
        {conSaldo.length === 0 ? (
          <Vacio titulo="Sin movimientos" descripcion="Esta cuenta no tiene asientos en el periodo." />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Asiento</th>
                  <th>Glosa</th>
                  <th>Documento</th>
                  <th className="text-right">Debe</th>
                  <th className="text-right">Haber</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {conSaldo.map((f, i) => (
                  <tr key={`${f.numero}-${i}`}>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.fecha}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.numero}</td>
                    <td className="max-w-[300px] truncate">{f.glosa ?? f.glosa_asiento}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {f.documento_serie ? `${f.documento_serie}-${f.documento_numero}` : "—"}
                    </td>
                    <td><Importe valor={f.debe} /></td>
                    <td><Importe valor={f.haber} /></td>
                    <td><strong><Importe valor={money.toString(f.saldo, 2)} /></strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
