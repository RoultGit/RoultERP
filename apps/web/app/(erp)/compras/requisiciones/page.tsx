import Link from "next/link";
import type { Route } from "next";
import {
  listarRequisiciones, listarProductos, listarAlmacenes, listarCentrosCosto,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Insignia, Vacio } from "@/components/ui";
import { FormularioRequisicion } from "./formulario";
import { AccionesRequisicion } from "./acciones-fila";

export const metadata = { title: "Requisiciones · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todas"],
  ["pendiente", "Por aprobar"],
  ["aprobada", "Aprobadas"],
  ["atendida", "Atendidas"],
  ["rechazada", "Rechazadas"],
  ["anulada", "Anuladas"],
] as const;

export default async function Requisiciones({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; estado?: string }>;
}) {
  const { hecho, estado } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const [puedeCrear, puedeAprobar] = await Promise.all([
    tienePermiso("compras:crear"),
    tienePermiso("compras:aprobar"),
  ]);

  const datos = await conEmpresa(async (db) => {
    const [requisiciones, productos, almacenes, centros] = await Promise.all([
      listarRequisiciones(db, filtro || undefined),
      listarProductos(db),
      listarAlmacenes(db),
      listarCentrosCosto(db),
    ]);
    return { requisiciones, productos, almacenes, centros };
  }, "compras:ver");

  return (
    <>
      <Encabezado
        titulo="Requisiciones"
        descripcion="Lo que cada área pide antes de que compras salga al mercado. Aprobada la requisición, se sale a cotizar."
        acciones={
          <Link href={"/compras/cotizaciones" as Route} className="boton boton-secundario">
            Cotizaciones
          </Link>
        }
      />
      <Contenido>
        {hecho && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {hecho}
          </p>
        )}

        {puedeCrear && (
          <div className="mb-5">
            <FormularioRequisicion
              productos={datos.productos
                .filter((p) => p.activo)
                .map((p) => ({ id: p.id, etiqueta: `${p.codigo} — ${p.descripcion}` }))}
              almacenes={datos.almacenes
                .filter((a) => a.activo)
                .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
              centrosCosto={datos.centros
                .filter((c) => c.activo)
                .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
            />
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/compras/requisiciones?estado=${valor}` : "/compras/requisiciones") as Route}
              className="rounded border px-3 py-1 text-sm"
              style={{
                borderColor: filtro === valor ? "var(--acento)" : "var(--borde)",
                background: filtro === valor ? "var(--acento-suave)" : "var(--superficie)",
                color: filtro === valor ? "var(--acento)" : "var(--texto-suave)",
              }}
              aria-current={filtro === valor ? "true" : undefined}
            >
              {texto}
            </Link>
          ))}
        </div>

        <section className="tarjeta overflow-x-auto">
          {datos.requisiciones.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay requisiciones"
                descripcion="Aquí queda lo que cada área pidió, quién lo autorizó y en qué terminó."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Para</th>
                  <th>Área</th>
                  <th>Solicitante</th>
                  <th>Estado</th>
                  {puedeCrear && <th className="w-[300px]" />}
                </tr>
              </thead>
              <tbody>
                {datos.requisiciones.map((r) => (
                  <tr key={r.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{r.numero}</td>
                    <td>
                      <Insignia>{r.tipo === "servicio" ? "Servicio" : "Bienes"}</Insignia>
                    </td>
                    <td className="cifra">{r.fecha}</td>
                    <td className="cifra">{r.fechaRequerida ?? "—"}</td>
                    <td className="max-w-[160px] truncate">{r.area ?? "—"}</td>
                    <td className="max-w-[160px] truncate">{r.solicitante ?? "—"}</td>
                    <td>
                      <EstadoDoc estado={r.estado} />
                      {r.motivoRechazo && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          {r.motivoRechazo}
                        </p>
                      )}
                    </td>
                    {puedeCrear && (
                      <td>
                        <AccionesRequisicion
                          requisicionId={r.id}
                          estado={r.estado}
                          puedeAprobar={puedeAprobar}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </Contenido>
    </>
  );
}
