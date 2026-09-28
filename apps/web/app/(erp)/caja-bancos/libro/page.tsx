import Link from "next/link";
import type { Route } from "next";
import { libroBancos, cuentasConSaldo } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Libro de bancos · RoultERP" };
export const dynamic = "force-dynamic";

/** Primer y último día del mes en curso, que es como se lleva el libro. */
function mesActual(): { desde: string; hasta: string } {
  const d = new Date();
  const a = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { desde: iso(new Date(Date.UTC(a, m, 1))), hasta: iso(new Date(Date.UTC(a, m + 1, 0))) };
}

const esFecha = (v: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

export default async function Libro({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; desde?: string; hasta?: string }>;
}) {
  const p = await searchParams;
  const mes = mesActual();
  const desde = esFecha(p.desde) ? p.desde! : mes.desde;
  const hasta = esFecha(p.hasta) ? p.hasta! : mes.hasta;

  const datos = await conEmpresa(async (db) => {
    const cuentas = await cuentasConSaldo(db);
    const cuentaId = p.cuenta ?? cuentas[0]?.id ?? null;
    return {
      cuentas,
      libro: cuentaId ? await libroBancos(db, cuentaId, { desde, hasta }) : null,
    };
  }, "caja_bancos:ver");

  const l = datos.libro;

  return (
    <>
      <Encabezado
        titulo="Libro de bancos"
        descripcion="El auxiliar de una cuenta: saldo inicial, movimientos del periodo y saldo final, contrastado contra la cuenta contable."
        acciones={
          <>
            <Imprimir />
            <Link href={"/caja-bancos" as Route} className="boton boton-secundario">
              Caja y bancos
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="tarjeta filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/caja-bancos/libro">
          <div className="min-w-[260px]">
            <label className="etiqueta" htmlFor="cuenta">Cuenta</label>
            <select id="cuenta" name="cuenta" className="campo" defaultValue={l?.cuenta.id ?? ""}>
              {datos.cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.nombre} · {c.moneda}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={desde} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta} className="campo" />
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {!l ? (
          <Vacio
            titulo="No hay cuentas de efectivo"
            descripcion="Cree una cuenta de caja o de banco para llevar su libro."
          />
        ) : (
          <>
            <div className="tarjeta mb-5 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Saldo inicial", l.saldoInicial],
                ["Ingresos", l.ingresos],
                ["Egresos", l.egresos],
                ["Saldo final", l.saldoFinal],
                [`Cuenta ${l.cuenta.cuentaContable}`, l.saldoContable],
              ].map(([titulo, valor]) => (
                <div key={titulo}>
                  <p className="text-xs" style={{ color: "var(--texto-suave)" }}>{titulo}</p>
                  <p className="text-lg font-medium">
                    <Importe valor={valor} moneda={l.cuenta.moneda} />
                  </p>
                </div>
              ))}
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
              {l.cuadra ? (
                <Insignia tono="exito">El libro cuadra con la contabilidad</Insignia>
              ) : (
                <Insignia tono="peligro">
                  Diferencia de {l.diferencia} contra la cuenta {l.cuenta.cuentaContable}
                </Insignia>
              )}
              {l.cuenta.banco && (
                <span style={{ color: "var(--texto-suave)" }}>
                  {l.cuenta.banco} {l.cuenta.numeroCuenta ?? ""}
                </span>
              )}
            </div>

            {l.avisos.length > 0 && (
              <div
                className="tarjeta mb-5 p-4 text-sm"
                style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
              >
                <p className="font-medium" style={{ color: "var(--alerta)" }}>Revise antes de archivar</p>
                <ul className="mt-1.5 space-y-1" style={{ color: "var(--texto-suave)" }}>
                  {l.avisos.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
            )}

            <section className="tarjeta overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Referencia</th>
                    <th>Tercero</th>
                    <th className="text-right">Ingreso</th>
                    <th className="text-right">Egreso</th>
                    <th className="text-right">Saldo</th>
                    <th>Conciliado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "var(--superficie-2)" }}>
                    <td className="cifra" style={{ textAlign: "left" }}>{l.desde}</td>
                    <td colSpan={5} className="font-medium">Saldo que viene</td>
                    <td className="font-medium"><Importe valor={l.saldoInicial} /></td>
                    <td />
                  </tr>
                  {l.lineas.map((m, i) => (
                    <tr key={`${m.fecha}-${i}`}>
                      <td className="cifra" style={{ textAlign: "left" }}>{m.fecha}</td>
                      <td className="max-w-[280px] truncate">{m.concepto}</td>
                      <td className="cifra" style={{ textAlign: "left" }}>{m.referencia ?? "—"}</td>
                      <td className="max-w-[180px] truncate">{m.tercero ?? "—"}</td>
                      <td>{m.ingreso ? <Importe valor={m.ingreso} /> : null}</td>
                      <td>{m.egreso ? <Importe valor={m.egreso} /> : null}</td>
                      <td><Importe valor={m.saldo} /></td>
                      <td>
                        {m.conciliado ? (
                          <Insignia tono="exito">sí</Insignia>
                        ) : (
                          <span style={{ color: "var(--texto-suave)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--superficie-2)" }}>
                    <td className="cifra px-3 py-2" style={{ textAlign: "left" }}>{l.hasta}</td>
                    <td colSpan={3} className="px-3 py-2 text-xs font-semibold uppercase">
                      Saldo que pasa
                    </td>
                    <td className="px-3 py-2 font-semibold"><Importe valor={l.ingresos} /></td>
                    <td className="px-3 py-2 font-semibold"><Importe valor={l.egresos} /></td>
                    <td className="px-3 py-2 font-semibold"><Importe valor={l.saldoFinal} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </section>

            <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
              El libro sale de los movimientos de la cuenta y el mayor sale de los asientos: son dos
              caminos distintos para el mismo dinero. Si no coinciden, hay un movimiento sin asiento
              o un asiento sin movimiento, y conviene enterarse aquí y no al cerrar el ejercicio.
            </p>
          </>
        )}
      </Contenido>
    </>
  );
}
