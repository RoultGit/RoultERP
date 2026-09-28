import Link from "next/link";
import type { Route } from "next";
import { resultadosPorCentro } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Resultados por centro de costo · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Centros({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; hasta?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();
  const hasta = /^\d{6}$/.test(params.hasta ?? "") ? params.hasta! : undefined;

  const filas = await conEmpresa(
    (db) => resultadosPorCentro(db, periodo, hasta),
    "contabilidad:ver",
  );

  const total = filas.reduce(
    (a, f) => ({
      ingresos: money.add(a.ingresos, money.dec(f.ingresos)),
      costos: money.add(a.costos, money.dec(f.costos)),
      gastos: money.add(a.gastos, money.dec(f.gastos)),
      resultado: money.add(a.resultado, money.dec(f.resultado)),
    }),
    { ingresos: money.ZERO, costos: money.ZERO, gastos: money.ZERO, resultado: money.ZERO },
  );
  const enPerdida = filas.filter((f) => Number(f.resultado) < 0);

  return (
    <>
      <Encabezado
        titulo="Resultados por centro de costo"
        descripcion="En qué obra o en qué línea se ganó y en cuál se perdió. Un resultado global positivo puede estar tapando una obra que pierde todos los meses."
        acciones={
          <Link href={"/contabilidad/estados" as Route} className="boton boton-secundario">
            Estados financieros
          </Link>
        }
      />
      <Contenido>
        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/centros">
          <div>
            <label className="etiqueta" htmlFor="periodo">Desde el periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} placeholder="202601" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="hasta">Hasta (opcional)</label>
            <input
              id="hasta" name="hasta" defaultValue={hasta ?? ""} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} placeholder="202612" />
          </div>
          <button className="boton boton-primario">Ver</button>

          <div className="ml-auto text-right">
            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>Resultado global</div>
            <div
              className="text-lg font-medium"
              style={
                money.gt(money.ZERO, total.resultado) ? { color: "var(--peligro)" } : undefined
              }
            >
              <Importe valor={money.toString(total.resultado, 2)} />
            </div>
          </div>
        </form>

        {enPerdida.length > 0 && (
          <p className="aviso mb-4" role="alert">
            {enPerdida.length === 1
              ? `«${enPerdida[0]!.nombre}» está en pérdida.`
              : `${enPerdida.length} centros de costo están en pérdida: ${enPerdida
                  .map((c) => c.nombre)
                  .join(", ")}.`}
          </p>
        )}

        <section className="tarjeta overflow-x-auto">
          {filas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Sin resultados en el periodo"
                descripcion="No hay asientos contabilizados de ingresos ni de gastos."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Centro de costo</th>
                  <th className="text-right">Ingresos</th>
                  <th className="text-right">Costo de ventas</th>
                  <th className="text-right">Gastos</th>
                  <th className="text-right">Resultado</th>
                  <th className="text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.centroId ?? "sin"}>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.codigo || "—"}</td>
                    <td className="max-w-[280px] truncate">{f.nombre}</td>
                    <td><Importe valor={f.ingresos} /></td>
                    <td><Importe valor={f.costos} /></td>
                    <td><Importe valor={f.gastos} /></td>
                    <td
                      className="font-medium"
                      style={Number(f.resultado) < 0 ? { color: "var(--peligro)" } : undefined}
                    >
                      <Importe valor={f.resultado} />
                    </td>
                    <td className="cifra">{f.margen} %</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={2} className="px-3 py-2 text-xs font-semibold uppercase">Total</td>
                  <td><Importe valor={money.toString(total.ingresos, 2)} /></td>
                  <td><Importe valor={money.toString(total.costos, 2)} /></td>
                  <td><Importe valor={money.toString(total.gastos, 2)} /></td>
                  <td className="font-semibold">
                    <Importe valor={money.toString(total.resultado, 2)} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            Lo que no lleva centro de costo aparece en su propia fila y no se reparte: repartir
            gasto indirecto por una fórmula inventada da números que parecen precisos y no lo son.
          </p>
        </section>
      </Contenido>
    </>
  );
}
