import Link from "next/link";
import type { Route } from "next";
import { antiguedadCartera } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Antigüedad de saldos · RoultERP" };
export const dynamic = "force-dynamic";

const hoyISO = () => hoyEnPeru();

/** Días de atraso, con el peso visual que les toca. */
function Mora({ dias }: { dias: string }) {
  const n = Number(dias);
  if (n <= 0) return <span style={{ color: "var(--texto-suave)" }}>—</span>;
  const color = n > 60 ? "var(--peligro)" : n > 30 ? "var(--alerta)" : "var(--texto)";
  return (
    <span className="cifra" style={{ color }}>
      {dias} d
    </span>
  );
}

export default async function Morosidad({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const params = await searchParams;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.fecha ?? "") ? params.fecha! : hoyISO();

  const a = await conEmpresa((db) => antiguedadCartera(db, fecha), "cxc:ver");
  const t = a.totales;

  return (
    <>
      <Encabezado
        titulo="Antigüedad de saldos"
        descripcion="Cuánto debe cada cliente y desde cuándo. Es el cuadro con el que se decide a quién se le sigue vendiendo a crédito."
        acciones={
          <>
            <Imprimir />
            <Link href={"/cxc/proyeccion" as Route} className="boton boton-secundario">
              Proyección
            </Link>
            <Link href={"/cxc" as Route} className="boton boton-secundario">
              Cuentas por cobrar
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="bloque filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/cxc/morosidad">
          <div>
            <label className="etiqueta" htmlFor="fecha">Al día</label>
            <input id="fecha" name="fecha" type="date" defaultValue={fecha} className="campo" />
          </div>
          <button className="boton boton-primario">Ver</button>

          <dl className="ml-auto flex flex-wrap gap-6 text-right">
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Cartera</dt>
              <dd className="text-lg font-medium"><Importe valor={t.total} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Vencido</dt>
              <dd className="text-lg font-medium"><Importe valor={t.vencido} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>% vencido</dt>
              <dd className="cifra text-lg font-medium">{t.porcentajeVencido} %</dd>
            </div>
          </dl>
        </form>

        {a.avisos.length > 0 && (
          <div
            className="bloque mb-5 p-4 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
          >
            <p className="font-medium" style={{ color: "var(--alerta)" }}>Antes de leer el cuadro</p>
            <ul className="mt-1.5 space-y-1" style={{ color: "var(--texto-suave)" }}>
              {a.avisos.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </div>
        )}

        {a.clientes.length === 0 ? (
          <Vacio
            titulo="No hay nada por cobrar"
            descripcion="Ningún cliente tiene saldo pendiente a esta fecha."
          />
        ) : (
          <section className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="text-right">Por vencer</th>
                  <th className="text-right">1 a 30</th>
                  <th className="text-right">31 a 60</th>
                  <th className="text-right">61 a 90</th>
                  <th className="text-right">Más de 90</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">% vencido</th>
                  <th className="text-right">Mora media</th>
                  <th>Lo más antiguo</th>
                </tr>
              </thead>
              <tbody>
                {a.clientes.map((c) => (
                  <tr key={c.clienteId}>
                    <td className="max-w-[240px]">
                      <Link
                        href={`/cxc/estado-cuenta?cliente=${c.clienteId}` as Route}
                        className="truncate underline"
                      >
                        {c.cliente}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span style={{ color: "var(--texto-suave)" }}>{c.documentoCliente}</span>
                        {c.excedeLimite && <Insignia tono="peligro">sobre el límite</Insignia>}
                        {c.protestadas > 0 && (
                          <Insignia tono="alerta">
                            {c.protestadas} {c.protestadas === 1 ? "protesto" : "protestos"}
                          </Insignia>
                        )}
                      </div>
                    </td>
                    <td><Importe valor={c.porVencer} /></td>
                    <td><Importe valor={c.de1a30} /></td>
                    <td><Importe valor={c.de31a60} /></td>
                    <td><Importe valor={c.de61a90} /></td>
                    <td><Importe valor={c.mas90} /></td>
                    <td className="font-medium"><Importe valor={c.total} /></td>
                    <td className="cifra">{c.porcentajeVencido} %</td>
                    <td className="text-right"><Mora dias={c.diasPromedioMora} /></td>
                    <td className="text-sm" style={{ color: "var(--texto-suave)" }}>
                      {c.documentoMasAntiguo
                        ? `${c.documentoMasAntiguo.referencia} · venció el ${c.documentoMasAntiguo.vencimiento}`
                        : "nada vencido"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td className="px-3 py-2 text-xs font-semibold uppercase">Totales</td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.porVencer} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.de1a30} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.de31a60} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.de61a90} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.mas90} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.total} /></td>
                  <td className="cifra px-3 py-2 font-semibold">{t.porcentajeVencido} %</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          Las letras en cartera cuentan como deuda: dejarlas fuera daría una cartera sana justo en la
          empresa que más las usa. La mora media va ponderada por importe, porque una factura chica
          muy atrasada no dice lo mismo que una grande recién vencida.
        </p>
      </Contenido>
    </>
  );
}
