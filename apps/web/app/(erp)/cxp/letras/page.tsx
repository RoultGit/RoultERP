import { sql } from "drizzle-orm";
import { listarLetras } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";
import { RenovarLetra } from "./renovar";

export const metadata = { title: "Letras por pagar · RoultERP" };
export const dynamic = "force-dynamic";

const TONO: Record<string, "exito" | "alerta" | "peligro" | "neutro"> = {
  cobrada: "exito",
  protestada: "peligro",
  renovada: "neutro",
  girada: "alerta",
  aceptada: "alerta",
  en_cartera: "alerta",
};

export default async function Letras() {
  const { letras, hoy } = await conEmpresa(async (db) => {
    const [fila] = (await db.execute(sql`SELECT current_date::text AS hoy`)) as unknown as [
      { hoy: string },
    ];
    return {
      letras: await listarLetras(db, "pagar"),
      hoy: fila?.hoy ?? new Date().toISOString().slice(0, 10),
    };
  }, "cxp:ver");

  const puedeOperar = await tienePermiso("cxp:crear");
  const abiertas = letras.filter((l) => !money.isZero(money.dec(l.saldo)));
  const saldo = abiertas.reduce((a, l) => money.add(a, money.dec(l.saldo)), money.ZERO);

  const dias = (v: string) =>
    Math.round((Date.parse(`${v}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);

  return (
    <>
      <Encabezado
        titulo="Letras por pagar"
        descripcion="Deuda canjeada por letra, con su propio vencimiento."
        acciones={
          <>
            <BotonEnlace href="/cxp" variante="secundario">Cuentas por pagar</BotonEnlace>
            {puedeOperar && <BotonEnlace href="/cxp/pagar">Canjear por letra</BotonEnlace>}
          </>
        }
      />
      <Contenido>
        {letras.length === 0 ? (
          <Vacio
            titulo="Sin letras"
            descripcion="Canjear una factura por una letra no cancela la deuda: la cambia de forma, con un vencimiento nuevo."
            accion={puedeOperar ? <BotonEnlace href="/cxp/pagar">Canjear por letra</BotonEnlace> : null}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Proveedor</th>
                  <th>Giro</th>
                  <th>Vencimiento</th>
                  <th>Mon.</th>
                  <th className="text-right">Importe</th>
                  <th className="text-right">Saldo</th>
                  <th>Estado</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {letras.map((l) => {
                  const n = dias(l.fechaVencimiento);
                  const abierta = !money.isZero(money.dec(l.saldo));
                  return (
                    <tr key={l.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>{l.numero}</td>
                      <td className="max-w-[220px] truncate">{l.tercero}</td>
                      <td className="cifra">{l.fechaGiro}</td>
                      <td>
                        <span className="cifra">{l.fechaVencimiento}</span>
                        {abierta && n < 0 && (
                          <span className="ml-1.5">
                            <Insignia tono="peligro">{-n} d vencida</Insignia>
                          </span>
                        )}
                      </td>
                      <td>{l.moneda}</td>
                      <td><Importe valor={l.importe} /></td>
                      <td><strong><Importe valor={l.saldo} /></strong></td>
                      <td><Insignia tono={TONO[l.estado] ?? "neutro"}>{l.estado}</Insignia></td>
                      <td>
                        {puedeOperar && abierta && l.estado !== "renovada" && (
                          <RenovarLetra
                            letraId={l.id}
                            numeroActual={l.numero}
                            saldo={l.saldo}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Saldo en cartera
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(saldo, 2)} />
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          Falta implementar el pago de la letra al vencimiento y el registro del protesto.
        </p>
      </Contenido>
    </>
  );
}
