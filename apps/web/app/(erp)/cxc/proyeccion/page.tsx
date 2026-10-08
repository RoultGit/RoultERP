import Link from "next/link";
import type { Route } from "next";
import { proyeccionCobranzas } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Proyección de cobranzas · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Proyeccion({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; semanas?: string }>;
}) {
  const params = await searchParams;
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(params.desde ?? "")
    ? params.desde!
    : hoyEnPeru();
  const semanas = Math.min(Math.max(Number(params.semanas) || 4, 1), 12);

  const p = await conEmpresa((db) => proyeccionCobranzas(db, hoy, { semanas }), "cxc:ver");

  const maximo = p.tramos.reduce(
    (a, t) => (money.gt(money.dec(t.importe), a) ? money.dec(t.importe) : a),
    money.ZERO,
  );

  return (
    <>
      <Encabezado
        titulo="Proyección de cobranzas"
        descripcion="Qué se espera cobrar y cuándo, con facturas y letras juntas. Es lo que decide si alcanza para la planilla del viernes."
        acciones={
          <>
            <Imprimir />
            <Link href={"/cxc" as Route} className="boton boton-secundario">
              Cuentas por cobrar
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="bloque filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/cxc/proyeccion">
          <div>
            <label className="etiqueta" htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="semanas">Semanas a proyectar</label>
            <input
              id="semanas" name="semanas" inputMode="numeric"
              defaultValue={String(semanas)} className="campo cifra w-24" />
          </div>
          <button className="boton boton-primario">Ver</button>
          <div className="ml-auto text-right">
            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>Total por cobrar</div>
            <div className="text-lg font-medium"><Importe valor={p.totalSoles} /></div>
          </div>
        </form>

        {p.tramos.length === 0 ? (
          <Vacio
            titulo="No hay nada por cobrar"
            descripcion="Ni facturas con saldo ni letras en cartera."
          />
        ) : (
          <>
            <section className="bloque mb-5 p-4">
              <h2 className="mb-3 text-sm font-semibold">Por tramo</h2>
              <div className="space-y-2">
                {p.tramos.map((t) => {
                  const ancho = money.isZero(maximo)
                    ? 0
                    : Number(money.toString(money.dec(t.importe), 2)) /
                      Number(money.toString(maximo, 2));
                  const vencido = t.etiqueta === "vencido";
                  return (
                    <div key={t.etiqueta} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 text-sm" style={{ color: "var(--texto-suave)" }}>
                        {t.etiqueta}
                      </div>
                      <div className="h-5 flex-1 overflow-hidden rounded" style={{ background: "var(--superficie-2)" }}>
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.max(ancho * 100, 1)}%`,
                            background: vencido ? "var(--peligro)" : "var(--acento)",
                            opacity: vencido ? 0.7 : 0.55,
                          }}
                        />
                      </div>
                      <div className="w-32 shrink-0 text-right">
                        <Importe valor={t.importe} />
                      </div>
                      <div className="w-16 shrink-0 text-right text-xs" style={{ color: "var(--texto-suave)" }}>
                        {t.documentos} doc.
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
                Todo en soles, convertido con el tipo de cambio de cada documento. Lo vencido va
                aparte: es lo que hay que perseguir hoy, no lo que va a entrar.
              </p>
            </section>

            <section className="bloque overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Detalle
              </h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Vence</th>
                    <th>Días</th>
                    <th>Cliente</th>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">En soles</th>
                    <th>Tramo</th>
                  </tr>
                </thead>
                <tbody>
                  {p.detalle.map((l, i) => (
                    <tr key={`${l.tipo}-${l.referencia}-${i}`}>
                      <td className="cifra">{l.fechaVencimiento ?? "—"}</td>
                      <td className="cifra">
                        {l.diasParaVencer === null ? (
                          "—"
                        ) : l.diasParaVencer < 0 ? (
                          <span style={{ color: "var(--peligro)" }}>{l.diasParaVencer}</span>
                        ) : (
                          l.diasParaVencer
                        )}
                      </td>
                      <td className="max-w-[220px] truncate">{l.cliente}</td>
                      <td className="cifra" style={{ textAlign: "left" }}>{l.referencia}</td>
                      <td><Insignia>{l.tipo}</Insignia></td>
                      <td><Importe valor={l.saldo} moneda={l.moneda} /></td>
                      <td><Importe valor={l.saldoSoles} /></td>
                      <td style={{ color: "var(--texto-suave)" }}>{l.tramo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </Contenido>
    </>
  );
}
