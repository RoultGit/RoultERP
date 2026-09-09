import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { balanceComprobacion } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Contabilidad · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Contabilidad({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const { balance, asientos, periodos } = await conEmpresa(async (db) => {
    const asientos = (await db.execute(sql`
      SELECT a.id, a.numero, a.fecha, a.glosa, a.subdiario, a.estado, a.moneda,
             a.origen_modulo,
             coalesce(sum(l.debe_funcional), 0)::text AS debe
      FROM asientos a
      LEFT JOIN asiento_lineas l ON l.asiento_id = a.id
      WHERE a.periodo = ${periodo}
      GROUP BY a.id
      ORDER BY a.numero`)) as unknown as {
      id: string;
      numero: string;
      fecha: string;
      glosa: string;
      subdiario: string;
      estado: string;
      moneda: string;
      origen_modulo: string | null;
      debe: string;
    }[];

    const periodos = (await db.execute(sql`
      SELECT DISTINCT periodo FROM asientos ORDER BY periodo DESC LIMIT 12`)) as unknown as {
      periodo: string;
    }[];

    return { balance: await balanceComprobacion(db, periodo), asientos, periodos };
  }, "contabilidad:ver");

  const totalDebe = balance.reduce((a, b) => money.add(a, money.dec(b.debe)), money.ZERO);
  const totalHaber = balance.reduce((a, b) => money.add(a, money.dec(b.haber)), money.ZERO);
  const descuadre = money.sub(totalDebe, totalHaber);
  const cuadra = money.isZero(money.round(descuadre, 2));

  return (
    <>
      <Encabezado
        titulo="Contabilidad"
        descripcion={`Balance de comprobación y asientos del periodo ${periodo}.`}
        acciones={
          <Link href={`/contabilidad/ple?periodo=${periodo}` as Route} className="boton boton-primario">
            Libros electrónicos
          </Link>
        }
      />
      <Contenido>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {periodos.length > 0 ? (
            periodos.map((p) => (
              <Link
                key={p.periodo}
                href={`/contabilidad?periodo=${p.periodo}` as Route}
                className="rounded border px-2.5 py-1 text-xs cifra transition-colors"
                style={{
                  borderColor: p.periodo === periodo ? "var(--acento)" : "var(--borde)",
                  background: p.periodo === periodo ? "var(--acento-suave)" : "var(--superficie)",
                  color: p.periodo === periodo ? "var(--acento)" : "var(--texto-suave)",
                }}
              >
                {p.periodo.slice(0, 4)}-{p.periodo.slice(4)}
              </Link>
            ))
          ) : null}

          <span className="ml-auto">
            {cuadra ? (
              <Insignia tono="exito">El balance cuadra</Insignia>
            ) : (
              <Insignia tono="peligro">
                Descuadre de {money.toString(descuadre, 2)}
              </Insignia>
            )}
          </span>
        </div>

        {balance.length === 0 ? (
          <Vacio
            titulo={`Sin asientos en el periodo ${periodo}`}
            descripcion="Los asientos nacen al registrar una compra o al confirmar una liquidación de importación."
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <section className="tarjeta overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Balance de comprobación
              </h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Descripción</th>
                    <th className="text-right">Debe</th>
                    <th className="text-right">Haber</th>
                    <th className="text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.map((b) => (
                    <tr key={b.cuenta}>
                      <td className="cifra" style={{ textAlign: "left" }}>
                        <Link href={`/contabilidad/mayor?cuenta=${b.cuenta}&periodo=${periodo}` as Route} className="underline">
                          {b.cuenta}
                        </Link>
                      </td>
                      <td className="max-w-[280px] truncate" style={{ color: "var(--texto-suave)" }}>
                        {b.descripcion ?? "—"}
                      </td>
                      <td><Importe valor={b.debe} /></td>
                      <td><Importe valor={b.haber} /></td>
                      <td><strong><Importe valor={b.saldo} /></strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--superficie-2)" }}>
                    <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                      Totales
                    </td>
                    <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(totalDebe, 2)} /></td>
                    <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(totalHaber, 2)} /></td>
                    <td className="px-3 py-2 font-semibold">
                      {/* Si esta celda no dice 0.00, hay un asiento roto y todo
                          lo que se derive de aquí es incorrecto. */}
                      <Importe valor={money.toString(descuadre, 2)} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>

            <section className="tarjeta overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Asientos del periodo
              </h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>N.º</th>
                    <th>Fecha</th>
                    <th>Glosa</th>
                    <th className="text-right">Importe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {asientos.map((a) => (
                    <tr key={a.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>{a.numero}</td>
                      <td className="cifra">{a.fecha}</td>
                      <td className="max-w-[220px] truncate">
                        {a.glosa}
                        {a.origen_modulo && (
                          <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                            {a.origen_modulo}
                          </span>
                        )}
                      </td>
                      <td><Importe valor={a.debe} /></td>
                      <td>
                        {a.estado === "extornado" ? (
                          <Insignia tono="alerta">extornado</Insignia>
                        ) : (
                          <Insignia tono="exito">contabilizado</Insignia>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          La captura manual de asientos, los estados financieros y el cierre de ejercicio están en
          el alcance y todavía no se han implementado.
        </p>
      </Contenido>
    </>
  );
}
