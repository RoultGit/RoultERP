import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cuentasConSaldo, movimientosDe, listarArqueos, listarCuentas } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioMovimiento, FormularioArqueo } from "../formularios";

export const dynamic = "force-dynamic";

export default async function DetalleCuenta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const cuentas = await cuentasConSaldo(db);
    const cuenta = cuentas.find((c) => c.id === id);
    if (!cuenta) return null;
    return {
      cuenta,
      movimientos: await movimientosDe(db, id),
      arqueos: await listarArqueos(db, id),
      contrapartidas: (await listarCuentas(db, true)).filter(
        (c) => !c.cuenta.startsWith("10"),
      ),
    };
  }, "caja_bancos:ver");

  if (!datos) notFound();
  const { cuenta, movimientos, arqueos, contrapartidas } = datos;
  const puedeCrear = await tienePermiso("caja_bancos:crear");

  // El saldo corrido se reconstruye recorriendo los movimientos: es como se lee
  // un libro de caja, línea a línea.
  let saldo = money.ZERO;
  const filas = movimientos.map((m) => {
    saldo =
      m.sentido === "ingreso"
        ? money.add(saldo, money.dec(m.importe))
        : money.sub(saldo, money.dec(m.importe));
    return { m, saldo };
  });

  return (
    <>
      <Encabezado
        titulo={cuenta.nombre}
        descripcion={[
          cuenta.banco,
          cuenta.numero_cuenta,
          `cuenta contable ${cuenta.cuenta_contable}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        acciones={
          <>
            <Link href="/caja-bancos" className="boton boton-secundario">Volver</Link>
            {cuenta.tipo === "banco" && (
              <Link href={`/caja-bancos/conciliar?cuenta=${cuenta.id}` as Route} className="boton boton-primario">
                Conciliar
              </Link>
            )}
          </>
        }
      />
      <Contenido>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Tarjeta titulo="Saldo" valor={cuenta.saldo} moneda={cuenta.moneda} />
          {cuenta.tipo === "caja_chica" && (
            <Tarjeta titulo="Fondo fijo" valor={cuenta.fondo_fijo} moneda={cuenta.moneda} />
          )}
          <Tarjeta
            titulo="Sin conciliar"
            valor={String(cuenta.sin_conciliar)}
            crudo
            alerta={cuenta.sin_conciliar > 0}
          />
        </div>

        <section className="tarjeta mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Movimientos
          </h2>
          {filas.length === 0 ? (
            <div className="p-4"><Vacio titulo="Sin movimientos" /></div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Origen</th>
                  <th>Referencia</th>
                  <th className="text-right">Ingreso</th>
                  <th className="text-right">Egreso</th>
                  <th className="text-right">Saldo</th>
                  <th>Concil.</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ m, saldo: s }) => (
                  <tr key={m.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{m.fecha}</td>
                    <td className="max-w-[280px] truncate">
                      {m.concepto}
                      {m.tercero && (
                        <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          {m.tercero}
                        </span>
                      )}
                    </td>
                    <td style={{ color: "var(--texto-suave)" }}>{m.origenModulo ?? "—"}</td>
                    <td className="cifra" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                      {m.referencia ?? "—"}
                    </td>
                    <td>{m.sentido === "ingreso" ? <Importe valor={m.importe} /> : null}</td>
                    <td>{m.sentido === "egreso" ? <Importe valor={m.importe} /> : null}</td>
                    <td><strong><Importe valor={money.toString(s, 2)} /></strong></td>
                    <td>
                      {m.conciliadoEn ? (
                        <Insignia tono="exito">sí</Insignia>
                      ) : (
                        <Insignia tono="alerta">no</Insignia>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {puedeCrear && (
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="tarjeta p-4">
              <h2 className="mb-1 text-sm font-semibold">Registrar movimiento</h2>
              <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
                Para lo que no viene de otro módulo: comisiones, ITF, intereses, aportes. Los pagos
                y las cobranzas generan su propio movimiento.
              </p>
              <FormularioMovimiento
                cuentaId={cuenta.id}
                contrapartidas={contrapartidas.map((c) => ({
                  cuenta: c.cuenta,
                  etiqueta: `${c.cuenta} — ${c.descripcion}`,
                }))}
              />
            </section>

            <section className="tarjeta p-4">
              <h2 className="mb-1 text-sm font-semibold">Arqueo</h2>
              <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
                Cuente el efectivo y anótelo. La diferencia se contabiliza y se ajusta en el libro,
                para que el próximo arqueo no vuelva a encontrarla.
              </p>
              <FormularioArqueo cuentaId={cuenta.id} saldoActual={cuenta.saldo} />

              {arqueos.length > 0 && (
                <table className="tabla mt-4">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="text-right">Libro</th>
                      <th className="text-right">Contado</th>
                      <th className="text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arqueos.map((a) => (
                      <tr key={a.id}>
                        <td className="cifra" style={{ textAlign: "left" }}>{a.fecha}</td>
                        <td><Importe valor={a.saldoLibro} /></td>
                        <td><Importe valor={a.saldoContado} /></td>
                        <td><Importe valor={a.diferencia} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </Contenido>
    </>
  );
}

function Tarjeta({
  titulo,
  valor,
  moneda,
  crudo,
  alerta,
}: {
  titulo: string;
  valor: string;
  moneda?: string;
  crudo?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="tarjeta p-4">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
        {titulo}
      </div>
      <div
        className="cifra mt-1.5 text-2xl font-semibold"
        style={{ textAlign: "left", color: alerta ? "var(--peligro)" : undefined }}
      >
        {crudo ? valor : <Importe valor={valor} moneda={moneda} />}
      </div>
    </div>
  );
}
