import Link from "next/link";
import type { Route } from "next";
import { contratosPorVencer } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Vencimiento de contratos · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * Contratos que vencen, y los que ya vencieron.
 *
 * Los vencidos no se esconden nunca. Un contrato a plazo fijo que expira sin
 * renovar convierte la relación en indeterminada por ley: la empresa se entera
 * cuando el trabajador lo reclama y para entonces ya no hay nada que decidir.
 * Por eso la lista no es «lo que vence pronto» sino «lo que ya se pasó **y** lo
 * que va a pasarse».
 */
export default async function Contratos({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const p = await searchParams;
  const dias = Number(p.dias) > 0 ? Number(p.dias) : 60;
  const lista = await conEmpresa((db) => contratosPorVencer(db, dias), "planillas:ver");

  const vencidos = lista.filter((c) => c.vencido);
  const porVencer = lista.filter((c) => !c.vencido);

  const Tabla = ({ filas, titulo, tono }: { filas: typeof lista; titulo: string; tono?: "peligro" }) => (
    <section className="bloque mb-5 overflow-x-auto">
      <h2
        className="border-b px-4 py-2.5 text-sm font-semibold"
        style={{ borderColor: "var(--borde)", ...(tono ? { color: "var(--peligro)" } : {}) }}
      >
        {titulo} ({filas.length})
      </h2>
      {filas.length === 0 ? (
        <div className="p-4">
          <Vacio titulo="Nada aquí" descripcion="No hay contratos en esta situación." />
        </div>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Trabajador</th>
              <th>Cargo</th>
              <th>Tipo</th>
              <th>Desde</th>
              <th>Hasta</th>
              <th className="text-right">Días</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.contratoId}>
                <td className="cifra" style={{ textAlign: "left" }}>{c.documento}</td>
                <td>
                  <Link href={`/rrhh/${c.trabajadorId}` as Route} className="font-medium underline">
                    {c.trabajador}
                  </Link>
                </td>
                <td className="max-w-[200px] truncate">{c.cargo ?? "—"}</td>
                <td className="text-xs">{c.tipo.replace(/_/g, " ")}</td>
                <td className="cifra" style={{ textAlign: "left" }}>{c.fechaInicio}</td>
                <td className="cifra" style={{ textAlign: "left" }}>{c.fechaFin}</td>
                <td className="cifra">
                  {c.vencido ? (
                    <strong style={{ color: "var(--peligro)" }}>
                      venció hace {Math.abs(c.diasParaVencer)}
                    </strong>
                  ) : c.diasParaVencer <= 15 ? (
                    <Insignia tono="alerta">{c.diasParaVencer} d</Insignia>
                  ) : (
                    `${c.diasParaVencer} d`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );

  return (
    <>
      <Encabezado
        titulo="Vencimiento de contratos"
        descripcion="Lo que ya venció y lo que está por vencer. Renovar o terminar es una decisión que tiene fecha."
        acciones={
          <Link href={"/rrhh" as Route} className="boton boton-secundario">
            Trabajadores
          </Link>
        }
      />
      <Contenido>
        <form className="bloque mb-5 flex flex-wrap items-end gap-3 p-4" action="/rrhh/contratos">
          <div>
            <label className="etiqueta" htmlFor="dias">Avisar con</label>
            <select id="dias" name="dias" className="campo" defaultValue={String(dias)}>
              <option value="30">30 días</option>
              <option value="60">60 días</option>
              <option value="90">90 días</option>
              <option value="180">180 días</option>
            </select>
          </div>
          <button className="boton boton-secundario">Ver</button>
          <p className="ml-auto max-w-lg text-xs" style={{ color: "var(--texto-suave)" }}>
            Los vencidos salen siempre, sin importar el filtro: un plazo fijo que expiró sin renovar
            convierte la relación en indeterminada por ley.
          </p>
        </form>

        {vencidos.length > 0 && <Tabla filas={vencidos} titulo="Vencidos sin renovar" tono="peligro" />}
        <Tabla filas={porVencer} titulo="Por vencer" />
      </Contenido>
    </>
  );
}
