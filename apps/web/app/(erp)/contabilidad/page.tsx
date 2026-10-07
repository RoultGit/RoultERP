import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { balanceComprobacion, listarAsientos, listarPeriodos } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";

export const metadata = { title: "Contabilidad · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Contabilidad({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const [{ balance, asientos, periodos, estadosPeriodo }, puedeCrear] = await Promise.all([
    conEmpresa(async (db) => {
      const disponibles = (await db.execute(sql`
        SELECT DISTINCT periodo FROM asientos ORDER BY periodo DESC LIMIT 12`)) as unknown as {
        periodo: string;
      }[];
      return {
        balance: await balanceComprobacion(db, periodo),
        asientos: await listarAsientos(db, periodo),
        periodos: [...disponibles].map((d) => d.periodo),
        estadosPeriodo: await listarPeriodos(db),
      };
    }, "contabilidad:ver"),
    tienePermiso("contabilidad:crear"),
  ]);

  const cerrado = estadosPeriodo.some((p) => p.periodo === periodo && p.estado === "cerrado");
  const borradores = asientos.filter((a) => a.estado === "borrador").length;

  /*
   * Los asientos del periodo se paginan; el balance no.
   *
   * No es una distinción estética. El balance de comprobación se lee y se
   * imprime completo porque sus totales tienen que cuadrar: partirlo en páginas
   * rompe justamente lo que se va a revisar. La lista de asientos es lo
   * contrario, un registro que sólo crece y del que se mira un trozo; en
   * setiembre eran ciento siete y la tabla medía casi cinco mil píxeles.
   */
  const pagina = paginaDe(params.pagina);
  const asientosPagina = rodaja(asientos, pagina);

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
          <div className="flex flex-wrap gap-2">
            <Link href={`/contabilidad/estados?periodo=${periodo}` as Route} className="boton boton-secundario">
              Estados financieros
            </Link>
            <Link href={"/contabilidad/periodos" as Route} className="boton boton-secundario">
              Cierre de periodo
            </Link>
            <Link href={`/contabilidad/ple?periodo=${periodo}` as Route} className="boton boton-secundario">
              Libros electrónicos
            </Link>
            {puedeCrear && !cerrado && (
              <Link
                href={`/contabilidad/asiento?periodo=${periodo}` as Route}
                className="boton boton-primario"
              >
                Nuevo asiento
              </Link>
            )}
          </div>
        }
      />
      <Contenido>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {periodos.length > 0 ? (
            periodos.map((p) => (
              <Link
                key={p}
                href={`/contabilidad?periodo=${p}` as Route}
                className="rounded border px-2.5 py-1 text-xs cifra transition-colors"
                style={{
                  borderColor: p === periodo ? "var(--acento)" : "var(--borde)",
                  background: p === periodo ? "var(--acento-suave)" : "var(--superficie)",
                  color: p === periodo ? "var(--acento)" : "var(--texto-suave)",
                }}
              >
                {p.slice(0, 4)}-{p.slice(4)}
              </Link>
            ))
          ) : null}

          {cerrado && <Insignia tono="neutro">periodo cerrado</Insignia>}
          {borradores > 0 && (
            <Insignia tono="alerta">
              {borradores} {borradores === 1 ? "borrador" : "borradores"}
            </Insignia>
          )}

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

        {balance.length === 0 && asientos.length === 0 ? (
          <Vacio
            titulo={`Sin asientos en el periodo ${periodo}`}
            descripcion="Los asientos nacen al registrar una compra o al confirmar una liquidación de importación, o se capturan a mano desde «Nuevo asiento»."
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
                {asientos.length === 500 && (
                  <span className="ml-2 font-normal" style={{ color: "var(--texto-suave)" }}>
                    · los últimos 500; use el mayor o el libro diario para verlos todos
                  </span>
                )}
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
                  {asientosPagina.map((a) => (
                    <tr key={a.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>
                        <Link href={`/contabilidad/asiento?id=${a.id}` as Route} className="underline">
                          {a.numero}
                        </Link>
                      </td>
                      <td className="cifra">{a.fecha}</td>
                      <td className="max-w-[220px] truncate">
                        {a.glosa}
                        {a.origen_modulo && (
                          <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                            {a.origen_modulo}
                          </span>
                        )}
                      </td>
                      <td><Importe valor={a.importe} /></td>
                      <td><EstadoDoc estado={a.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Paginacion
                total={asientos.length}
                pagina={pagina}
                params={params}
                etiqueta="asientos"
              />
            </section>
          </div>
        )}

      </Contenido>
    </>
  );
}
