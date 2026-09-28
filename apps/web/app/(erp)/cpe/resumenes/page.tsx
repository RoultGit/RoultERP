import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { diasPendientesDeResumen, listarResumenes } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import {
  AccionesResumen, GenerarBaja, GenerarResumen,
  type ComprobanteVigente,
} from "./formularios";

export const metadata = { title: "Resúmenes y bajas · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Resumenes() {
  const [datos, puedeCrear, puedeAnular] = await Promise.all([
    conEmpresa(async (db) => {
      // Sólo lo que SUNAT ya aceptó se puede dar de baja, y las boletas no van
      // por aquí: se anulan dentro de su resumen diario.
      const vigentes = (await db.execute(sql`
        SELECT c.id, c.tipo_documento, c.serie, c.numero,
               c.fecha_emision::text AS fecha, c.total::text AS total
        FROM comprobantes c
        WHERE c.estado IN ('aceptado', 'aceptado_con_observaciones')
          AND c.tipo_documento <> '03'
        ORDER BY c.fecha_emision DESC, c.serie, c.numero
        LIMIT 50`)) as unknown as {
        id: string; tipo_documento: string; serie: string; numero: string;
        fecha: string; total: string;
      }[];

      return {
        pendientes: await diasPendientesDeResumen(db),
        resumenes: await listarResumenes(db),
        vigentes: [...vigentes],
      };
    }, "cpe:ver"),
    tienePermiso("cpe:crear"),
    tienePermiso("cpe:anular"),
  ]);

  const bajables: ComprobanteVigente[] = datos.vigentes.map((c) => ({
    id: c.id,
    etiqueta: `${c.serie}-${c.numero}`,
    fecha: c.fecha,
    total: c.total,
  }));

  return (
    <>
      <Encabezado
        titulo="Resúmenes y comunicaciones de baja"
        descripcion="Las boletas se declaran agrupadas por día; una factura aceptada sólo se anula por comunicación de baja."
        acciones={
          <Link href={"/cpe" as Route} className="boton boton-secundario">
            Configuración
          </Link>
        }
      />
      <Contenido>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="tarjeta p-4">
            <h2 className="mb-1 text-sm font-semibold">Boletas sin resumir</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              Un día por resumen. El plazo es de siete días calendario desde la emisión.
            </p>
            {puedeCrear ? (
              <GenerarResumen dias={datos.pendientes} />
            ) : (
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                {datos.pendientes.length === 0
                  ? "No hay boletas pendientes de declarar."
                  : `${datos.pendientes.length} días con boletas pendientes.`}
              </p>
            )}
          </section>

          <section className="tarjeta p-4">
            <h2 className="mb-1 text-sm font-semibold">Dar de baja un comprobante</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              Sólo facturas y notas ya aceptadas, y todas del mismo día. Una boleta se anula
              dentro de su resumen diario.
            </p>
            {bajables.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                No hay comprobantes aceptados que dar de baja.
              </p>
            ) : puedeAnular ? (
              <GenerarBaja comprobantes={bajables} />
            ) : (
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                Necesita permiso de anulación en facturación electrónica.
              </p>
            )}
          </section>
        </div>

        <section className="tarjeta mt-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Enviados
          </h2>
          {datos.resumenes.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no se ha enviado ningún resumen"
                descripcion="Aparecerán aquí con su ticket y el resultado que devuelva SUNAT."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Identificador</th>
                  <th>Tipo</th>
                  <th>Día resumido</th>
                  <th>Ticket</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {datos.resumenes.map((r) => (
                  <tr key={r.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{r.identificador}</td>
                    <td>
                      <Insignia>{r.tipo === "RC" ? "Resumen diario" : "Baja"}</Insignia>
                    </td>
                    <td className="cifra">{r.fechaReferencia}</td>
                    <td className="cifra" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                      {r.ticket ?? "—"}
                    </td>
                    <td><EstadoDoc estado={r.estado} /></td>
                    <td className="max-w-[240px] truncate" style={{ color: "var(--texto-suave)" }}>
                      {r.codigoSunat !== null ? `${r.codigoSunat} · ` : ""}
                      {r.mensajeSunat ?? "—"}
                    </td>
                    <td className="text-right">
                      {puedeCrear ? (
                        <AccionesResumen
                          resumenId={r.id}
                          estado={r.estado}
                          ticket={r.ticket}
                        />
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
