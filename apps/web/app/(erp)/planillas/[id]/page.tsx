import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cargarPlanillaSueldos, PlanillaSueldosInvalida } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia } from "@/components/ui";
import { CerrarPlanilla, AnularPlanilla } from "../formularios";

export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  mensual: "Planilla de sueldos",
  gratificacion: "Gratificación",
  cts: "CTS",
  liquidacion: "Liquidación de beneficios sociales",
};

export default async function DetallePlanilla({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ avisos?: string }>;
}) {
  const { id } = await params;
  const { avisos } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    try {
      return await cargarPlanillaSueldos(db, id);
    } catch (e) {
      if (e instanceof PlanillaSueldosInvalida) return null;
      throw e;
    }
  }, "planillas:ver");

  if (!datos) notFound();
  const { cabecera, boletas } = datos;
  const puedeAprobar = await tienePermiso("planillas:aprobar");
  const puedeAnular = await tienePermiso("planillas:anular");
  const listaAvisos = avisos ? avisos.split("|").filter(Boolean) : [];

  return (
    <>
      <Encabezado
        titulo={`${ETIQUETA[cabecera.tipo] ?? cabecera.tipo} ${cabecera.numero}`}
        descripcion={[
          `Periodo ${cabecera.periodo}`,
          cabecera.quincena ? `${cabecera.quincena}.ª quincena` : null,
          `Fecha ${cabecera.fecha}`,
          cabecera.fechaPago ? `Pago ${cabecera.fechaPago}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        acciones={
          <div className="flex items-center gap-2">
            <EstadoDoc estado={cabecera.estado} />
            <Link href={"/planillas" as Route} className="boton boton-secundario">Planillas</Link>
          </div>
        }
      />
      <Contenido>
        {listaAvisos.length > 0 && (
          <div className="aviso mb-5" role="alert">
            {/*
              Quien no entró en la planilla tiene que saberse aquí y no
              descubrirse el día de pago: una boleta que falta es un sueldo que
              no se paga.
            */}
            No entraron en la planilla:
            <ul className="mt-1 list-disc pl-5">
              {listaAvisos.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
        )}

        <dl className="tarjeta mb-5 flex flex-wrap gap-8 p-4">
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Trabajadores</dt>
            <dd className="text-lg font-medium">{boletas.length}</dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Ingresos (S/)</dt>
            <dd className="text-lg font-medium"><Importe valor={cabecera.totalIngresos} /></dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Descuentos (S/)</dt>
            <dd className="text-lg"><Importe valor={cabecera.totalDescuentos} /></dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Aportes del empleador</dt>
            <dd className="text-lg" style={{ color: "var(--texto-suave)" }}>
              <Importe valor={cabecera.totalAportes} />
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Neto a pagar (S/)</dt>
            <dd className="text-lg font-medium" style={{ color: "var(--exito)" }}>
              <Importe valor={cabecera.totalNeto} />
            </dd>
          </div>
          <div className="ml-auto flex items-end gap-2">
            {cabecera.estado === "borrador" && puedeAprobar && <CerrarPlanilla planillaId={id} />}
            {cabecera.asientoId && (
              <Link href={`/contabilidad/mayor` as Route} className="boton boton-secundario">
                Ver en contabilidad
              </Link>
            )}
          </div>
        </dl>

        <section className="tarjeta mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Boletas
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Trabajador</th>
                <th className="text-right">Días</th>
                <th>Pensión</th>
                <th className="text-right">Ingresos</th>
                <th className="text-right">Descuentos</th>
                <th className="text-right">Aportes</th>
                <th className="text-right">Neto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {boletas.map((b) => (
                <tr key={b.id}>
                  <td className="cifra" style={{ textAlign: "left" }}>{b.documento}</td>
                  <td>
                    <Link href={`/rrhh/${b.trabajadorId}` as Route} className="underline">
                      {`${b.apellidoPaterno} ${b.apellidoMaterno ?? ""}`.trim()}, {b.nombres}
                    </Link>
                    {b.motivoCese && (
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        cese por {b.motivoCese.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td className="cifra">{b.diasTrabajados}</td>
                  <td className="text-xs">
                    {b.regimenPension === "afp" ? `AFP ${b.afpCodigo ?? ""}` : b.regimenPension.toUpperCase()}
                  </td>
                  <td><Importe valor={b.totalIngresos} /></td>
                  <td><Importe valor={b.totalDescuentos} /></td>
                  <td style={{ color: "var(--texto-suave)" }}><Importe valor={b.totalAportes} /></td>
                  <td className="font-medium"><Importe valor={b.neto} /></td>
                  <td className="text-right">
                    <Link href={`/planillas/${id}/boleta/${b.id}` as Route} className="text-xs underline">
                      Imprimir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* El detalle de conceptos: lo que el contador revisa línea por línea. */}
        {boletas.map((b) => (
          <details key={b.id} className="tarjeta mb-3">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none">
              {`${b.apellidoPaterno} ${b.apellidoMaterno ?? ""}`.trim()}, {b.nombres} —{" "}
              <span style={{ color: "var(--texto-suave)" }}>{b.lineas.length} conceptos</span>
            </summary>
            <table className="tabla border-t" style={{ borderColor: "var(--borde)" }}>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Tipo</th>
                  <th className="text-right">Importe (S/)</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {b.lineas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="cifra mr-2" style={{ color: "var(--texto-suave)" }}>{l.codigo}</span>
                      {l.nombre}
                    </td>
                    <td className="text-xs">
                      {l.tipo === "aporte" ? (
                        <Insignia>aporte del empleador</Insignia>
                      ) : l.tipo === "descuento" ? (
                        <span style={{ color: "var(--peligro)" }}>descuento</span>
                      ) : (
                        <span style={{ color: "var(--exito)" }}>ingreso</span>
                      )}
                    </td>
                    <td><Importe valor={l.importe} /></td>
                    <td className="text-xs" style={{ color: "var(--texto-suave)" }}>{l.nota ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}

        {cabecera.estado !== "anulada" && cabecera.estado !== "pagada" && puedeAnular && (
          <div className="mt-5">
            <AnularPlanilla planillaId={id} />
          </div>
        )}
      </Contenido>
    </>
  );
}
