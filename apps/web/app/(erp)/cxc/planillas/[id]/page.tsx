import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { liquidarPlanilla, PlanillaInvalida } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";
import { Panel } from "./panel";

export const metadata = { title: "Planilla de cobranza · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Planilla({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { id } = await params;
  const { hecho } = await searchParams;

  const p = await conEmpresa(
    (db) =>
      liquidarPlanilla(db, id).catch((e) => {
        if (e instanceof PlanillaInvalida) return null;
        throw e;
      }),
    "cxc:ver",
  );
  if (!p) notFound();

  const puedeEditar = await tienePermiso("cxc:editar");

  const anuncio: Record<string, string> = {
    cerrada: "Planilla cerrada. Lo que no se cobró volvió a quedar libre.",
    anulada: "Planilla anulada.",
  };

  return (
    <>
      <Encabezado
        titulo={`Planilla ${p.numero}`}
        descripcion={`${p.responsable} · entregada el ${p.fecha}`}
        acciones={
          <>
            <Imprimir />
            <Link href={"/cxc/planillas" as Route} className="boton boton-secundario">
              Planillas
            </Link>
          </>
        }
      />
      <Contenido>
        {hecho && anuncio[hecho] && (
          <p className="bloque mb-5 p-3 text-sm" role="status">
            {anuncio[hecho]}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <section className="bloque overflow-x-auto">
            <div
              className="flex items-center justify-between border-b px-4 py-2.5"
              style={{ borderColor: "var(--borde)" }}
            >
              <h2 className="text-sm font-semibold">Documentos entregados</h2>
              <div className="flex items-center gap-2">
                <Insignia>{p.tipo}</Insignia>
                <EstadoDoc estado={p.estado} />
              </div>
            </div>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Cliente</th>
                  <th>Vence</th>
                  <th className="text-right">Entregado</th>
                  <th className="text-right">Cobrado</th>
                  <th className="text-right">Sigue debiendo</th>
                </tr>
              </thead>
              <tbody>
                {p.renglones.map((r) => (
                  <tr key={r.documento}>
                    <td className="cifra" style={{ textAlign: "left" }}>{r.documento}</td>
                    <td className="max-w-[200px] truncate">{r.cliente}</td>
                    <td className="cifra">{r.vencimiento ?? "—"}</td>
                    <td><Importe valor={r.entregado} /></td>
                    <td><Importe valor={r.cobrado} /></td>
                    <td><Importe valor={r.saldo} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Totales
                  </td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={p.entregado} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={p.cobrado} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={p.pendiente} /></td>
                </tr>
              </tfoot>
            </table>
          </section>

          <aside className="space-y-4">
            <section className="bloque">
              <h2
                className="border-b px-4 py-2.5 text-sm font-semibold"
                style={{ borderColor: "var(--borde)" }}
              >
                Resumen
              </h2>
              <dl className="space-y-2 p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt style={{ color: "var(--texto-suave)" }}>Entregado</dt>
                  <dd><Importe valor={p.entregado} moneda={p.moneda} /></dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt style={{ color: "var(--texto-suave)" }}>Cobrado</dt>
                  <dd><Importe valor={p.cobrado} moneda={p.moneda} /></dd>
                </div>
                <div className="flex justify-between gap-4 font-medium">
                  <dt>Pendiente</dt>
                  <dd><Importe valor={p.pendiente} moneda={p.moneda} /></dd>
                </div>
                {p.entregadaPor && (
                  <div className="flex justify-between gap-4">
                    <dt style={{ color: "var(--texto-suave)" }}>La entregó</dt>
                    <dd>{p.entregadaPor}</dd>
                  </div>
                )}
                {p.observaciones && (
                  <p className="pt-1" style={{ color: "var(--texto-suave)" }}>{p.observaciones}</p>
                )}
              </dl>
            </section>

            {puedeEditar && p.estado === "abierta" && (
              <section className="bloque">
                <h2
                  className="border-b px-4 py-2.5 text-sm font-semibold"
                  style={{ borderColor: "var(--borde)" }}
                >
                  Al volver
                </h2>
                <Panel planillaId={p.id} />
              </section>
            )}
          </aside>
        </div>

        <p className="mt-5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Lo cobrado no se apunta aquí: sale del saldo vivo de cada documento. Si el cliente pagó por
          transferencia en vez de al cobrador, la deuda igual se extinguió y la planilla lo refleja.
        </p>
      </Contenido>
    </>
  );
}
