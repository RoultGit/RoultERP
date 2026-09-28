import Link from "next/link";
import type { Route } from "next";
import { listarPlanillasSueldos } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";
import { NuevaPlanilla } from "./formularios";

export const metadata = { title: "Planillas · RoultERP" };
export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  mensual: "Sueldos",
  gratificacion: "Gratificación",
  cts: "CTS",
  liquidacion: "Liquidación",
};

export default async function Planillas({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tipo } = await searchParams;
  const lista = await conEmpresa(
    (db) => listarPlanillasSueldos(db, tipo ? { tipo } : undefined),
    "planillas:ver",
  );
  const puedeCrear = await tienePermiso("planillas:crear");

  const hoy = new Date();
  const periodoSugerido = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <>
      <Encabezado
        titulo="Planillas"
        descripcion="Sueldos, gratificaciones, CTS y liquidaciones. Las cuatro son la misma operación con distintos conceptos."
        acciones={
          <div className="flex items-center gap-2">
            <Link href={"/rrhh" as Route} className="boton boton-secundario">Trabajadores</Link>
            <Link href={"/planillas/configuracion" as Route} className="boton boton-secundario">
              Configuración
            </Link>
          </div>
        }
      />
      <Contenido>
        {puedeCrear && (
          <div className="mb-5">
            <NuevaPlanilla periodoSugerido={periodoSugerido} />
          </div>
        )}

        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/planillas">
          <div>
            <label className="etiqueta" htmlFor="tipo">Tipo</label>
            <select id="tipo" name="tipo" className="campo" defaultValue={tipo ?? ""}>
              <option value="">Todas</option>
              <option value="mensual">Sueldos</option>
              <option value="gratificacion">Gratificación</option>
              <option value="cts">CTS</option>
              <option value="liquidacion">Liquidaciones</option>
            </select>
          </div>
          <button className="boton boton-secundario">Ver</button>
        </form>

        <section className="tarjeta overflow-x-auto">
          {lista.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay planillas"
                descripcion="Calcule la primera. Se toma a todos los trabajadores activos con remuneración vigente."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Tipo</th>
                  <th>Periodo</th>
                  <th>Fecha</th>
                  <th className="text-right">Ingresos</th>
                  <th className="text-right">Descuentos</th>
                  <th className="text-right">Aportes</th>
                  <th className="text-right">Neto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/planillas/${p.id}` as Route} className="font-medium underline">
                        {p.numero}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {ETIQUETA[p.tipo] ?? p.tipo}
                      {p.quincena && (
                        <span className="block" style={{ color: "var(--texto-suave)" }}>
                          {p.quincena === 1 ? "1.ª quincena" : "2.ª quincena"}
                        </span>
                      )}
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.periodo}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.fecha}</td>
                    <td><Importe valor={p.totalIngresos} /></td>
                    <td><Importe valor={p.totalDescuentos} /></td>
                    <td style={{ color: "var(--texto-suave)" }}>
                      <Importe valor={p.totalAportes} />
                    </td>
                    <td className="font-medium"><Importe valor={p.totalNeto} /></td>
                    <td><EstadoDoc estado={p.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs"
            style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            Los aportes del empleador —EsSalud, SENATI, SCTR— no salen del bolsillo del trabajador:
            se suman al costo de la empresa, no se restan del neto.
          </p>
        </section>
      </Contenido>
    </>
  );
}
