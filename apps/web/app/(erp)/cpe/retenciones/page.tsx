import Link from "next/link";
import type { Route } from "next";
import { asc, eq, inArray } from "drizzle-orm";
import {
  listarRetenciones, pagosSinRetencion, cobranzasSinPercepcion,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { EmitirDesde, EnviarRetencion } from "./formularios";

export const metadata = { title: "Retenciones y percepciones · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Retenciones() {
  const [datos, puedeCrear] = await Promise.all([
    conEmpresa(async (db) => {
      const series = await db
        .select({
          tipo: schema.seriesDocumento.tipoDocumento,
          serie: schema.seriesDocumento.serie,
        })
        .from(schema.seriesDocumento)
        .where(inArray(schema.seriesDocumento.tipoDocumento, ["20", "40"]))
        .orderBy(asc(schema.seriesDocumento.serie));
      const [empresa] = await db
        .select({
          esAgenteRetencion: schema.empresas.esAgenteRetencion,
          esAgentePercepcion: schema.empresas.esAgentePercepcion,
        })
        .from(schema.empresas)
        .limit(1);

      return {
        pendientesRetencion: await pagosSinRetencion(db),
        pendientesPercepcion: await cobranzasSinPercepcion(db),
        emitidos: await listarRetenciones(db),
        series,
        empresa,
      };
    }, "cpe:ver"),
    tienePermiso("cpe:crear"),
  ]);

  const seriesRetencion = datos.series.filter((s) => s.tipo === "20").map((s) => s.serie);
  const seriesPercepcion = datos.series.filter((s) => s.tipo === "40").map((s) => s.serie);

  return (
    <>
      <Encabezado
        titulo="Retenciones y percepciones"
        descripcion="El comprobante que documenta lo que se retuvo al pagar o se percibió al cobrar."
        acciones={
          <Link href={"/cpe" as Route} className="boton boton-secundario">
            Configuración
          </Link>
        }
      />
      <Contenido>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="bloque p-4">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Pagos con retención</h2>
              {datos.empresa?.esAgenteRetencion ? (
                <Insignia tono="exito">agente de retención</Insignia>
              ) : (
                <Insignia tono="alerta">no designado</Insignia>
              )}
            </div>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              El importe no se escribe: es el que se retuvo al pagar. El proveedor ya tiene esa
              cifra en su comprobante.
            </p>
            {seriesRetencion.length === 0 ? (
              <p className="aviso">Registre una serie del tipo 20 en Facturación electrónica.</p>
            ) : puedeCrear ? (
              <EmitirDesde
                tipo="retencion"
                series={seriesRetencion}
                pendientes={datos.pendientesRetencion.map((p) => ({
                  // El origen viaja con el id: el mismo botón documenta el pago
                  // de facturas y el de una letra.
                  id: `${p.origen}:${p.id}`,
                  etiqueta: p.numero,
                  detalle: `${p.fecha} · ${p.proveedor}`,
                  importe: p.retencion,
                }))}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                {datos.pendientesRetencion.length} pagos pendientes de documentar.
              </p>
            )}
          </section>

          <section className="bloque p-4">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Cobranzas con percepción</h2>
              {datos.empresa?.esAgentePercepcion ? (
                <Insignia tono="exito">agente de percepción</Insignia>
              ) : (
                <Insignia tono="alerta">no designado</Insignia>
              )}
            </div>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              La percepción se cobró al emitir la venta; el comprobante se entrega cuando el
              cliente paga.
            </p>
            {seriesPercepcion.length === 0 ? (
              <p className="aviso">Registre una serie del tipo 40 en Facturación electrónica.</p>
            ) : puedeCrear ? (
              <EmitirDesde
                tipo="percepcion"
                series={seriesPercepcion}
                pendientes={datos.pendientesPercepcion.map((c) => ({
                  id: c.id,
                  etiqueta: c.numero,
                  detalle: `${c.fecha} · ${c.cliente}`,
                  importe: c.percepcion,
                }))}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                {datos.pendientesPercepcion.length} cobranzas pendientes de documentar.
              </p>
            )}
          </section>
        </div>

        <section className="bloque mt-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Emitidos
          </h2>
          {datos.emitidos.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no se ha emitido ninguno"
                descripcion="Aparecerán aquí con el resultado que devuelva SUNAT."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Contraparte</th>
                  <th className="text-right">Importe S/</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {datos.emitidos.map((r) => (
                  <tr key={r.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{r.serie}-{r.numero}</td>
                    <td>
                      <Insignia>
                        {r.tipoDocumento === "20" ? "Retención" : "Percepción"}
                      </Insignia>
                    </td>
                    <td className="cifra">{r.fechaEmision}</td>
                    <td className="max-w-[220px] truncate">{r.tercero ?? "—"}</td>
                    <td><Importe valor={r.importeTotal} /></td>
                    <td><EstadoDoc estado={r.estado} /></td>
                    <td className="max-w-[220px] truncate" style={{ color: "var(--texto-suave)" }}>
                      {r.mensajeSunat ?? "—"}
                    </td>
                    <td className="text-right">
                      {puedeCrear ? (
                        <EnviarRetencion retencionId={r.id} estado={r.estado} />
                      ) : (
                        "—"
                      )}
                    </td>
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
