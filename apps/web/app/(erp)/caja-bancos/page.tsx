import Link from "next/link";
import type { Route } from "next";
import { cuentasConSaldo, listarCuentas } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioCuenta } from "./formularios";

export const metadata = { title: "Caja y bancos · RoultERP" };
export const dynamic = "force-dynamic";

const TIPO: Record<string, string> = {
  caja: "Caja",
  caja_chica: "Caja chica",
  banco: "Banco",
};

export default async function CajaBancos() {
  const { cuentas, contables } = await conEmpresa(
    async (db) => ({
      cuentas: await cuentasConSaldo(db),
      // Sólo las divisionarias del elemento 10: efectivo y equivalentes.
      contables: (await listarCuentas(db, true)).filter((c) => c.cuenta.startsWith("10")),
    }),
    "caja_bancos:ver",
  );

  const puedeCrear = await tienePermiso("caja_bancos:crear");
  const activas = cuentas.filter((c) => c.activa);
  const total = activas
    .filter((c) => c.moneda === "PEN")
    .reduce((a, c) => money.add(a, money.dec(c.saldo)), money.ZERO);
  const sinConciliar = activas.reduce((a, c) => a + c.sin_conciliar, 0);

  return (
    <>
      <Encabezado
        titulo="Caja y bancos"
        descripcion="Cuentas de efectivo, sus saldos y el estado de la conciliación."
        acciones={
          sinConciliar > 0 ? (
            <Insignia tono="alerta">{sinConciliar} movimientos sin conciliar</Insignia>
          ) : null
        }
      />
      <Contenido>
        {activas.length === 0 ? (
          <Vacio
            titulo="Sin cuentas de efectivo"
            descripcion="Registre las cajas y las cuentas bancarias de la empresa para poder pagar, cobrar y conciliar."
          />
        ) : (
          <div className="tarjeta mb-5 overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th>Cta. contable</th>
                  <th>Mon.</th>
                  <th className="text-right">Saldo</th>
                  <th>Conciliación</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {activas.map((c) => (
                  <tr key={c.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{c.codigo}</td>
                    <td>
                      <Link href={`/caja-bancos/${c.id}` as Route} className="font-medium underline">
                        {c.nombre}
                      </Link>
                      {c.numero_cuenta && (
                        <div className="cifra text-xs" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
                          {c.banco} · {c.numero_cuenta}
                        </div>
                      )}
                    </td>
                    <td><Insignia>{TIPO[c.tipo] ?? c.tipo}</Insignia></td>
                    <td className="cifra" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                      {c.cuenta_contable}
                    </td>
                    <td>{c.moneda}</td>
                    <td><strong><Importe valor={c.saldo} /></strong></td>
                    <td>
                      {c.sin_conciliar === 0 ? (
                        <Insignia tono="exito">al día</Insignia>
                      ) : (
                        <Insignia tono="alerta">{c.sin_conciliar} pendientes</Insignia>
                      )}
                    </td>
                    <td>
                      {c.tipo === "banco" && (
                        <Link
                          href={`/caja-bancos/conciliar?cuenta=${c.id}` as Route}
                          className="text-xs underline"
                        >
                          Conciliar
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Total en soles
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(total, 2)} />
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {puedeCrear && (
          <section className="tarjeta p-4">
            <h2 className="mb-3 text-sm font-semibold">Nueva cuenta</h2>
            <FormularioCuenta
              cuentasContables={contables.map((c) => ({
                cuenta: c.cuenta,
                etiqueta: `${c.cuenta} — ${c.descripcion}`,
              }))}
            />
          </section>
        )}
      </Contenido>
    </>
  );
}
