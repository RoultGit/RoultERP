import Link from "next/link";
import type { Route } from "next";
import { listarGuias } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Insignia, Vacio, BotonEnlace } from "@/components/ui";
import { AccionesGuia } from "./formularios";

export const metadata = { title: "Guías de remisión · RoultERP" };
export const dynamic = "force-dynamic";

const MOTIVO: Record<string, string> = {
  "01": "Venta", "02": "Compra", "04": "Entre establecimientos", "05": "Consignación",
  "06": "Devolución", "08": "Importación", "09": "Exportación", "13": "Otros",
};

export default async function Guias() {
  const [guias, puedeCrear] = await Promise.all([
    conEmpresa((db) => listarGuias(db), "ventas:ver"),
    tienePermiso("ventas:crear"),
  ]);

  return (
    <>
      <Encabezado
        titulo="Guías de remisión"
        descripcion="El traslado de la mercadería. Viaja por la API propia de la GRE, con su ticket y su CDR."
        acciones={
          puedeCrear ? (
            <Link href={"/guias/nueva" as Route} className="boton boton-primario">
              Nueva guía
            </Link>
          ) : null
        }
      />
      <Contenido>
        {guias.length === 0 ? (
          <Vacio
            titulo="Todavía no hay guías"
            descripcion="Una guía documenta que la mercadería fue de un punto a otro, con un motivo y un transporte."
            accion={puedeCrear ? <BotonEnlace href="/guias/nueva">Nueva guía</BotonEnlace> : undefined}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Guía</th>
                  <th>Emisión</th>
                  <th>Traslado</th>
                  <th>Destinatario</th>
                  <th>Motivo</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {guias.map((g) => (
                  <tr key={g.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      <Link href={`/guias/${g.id}` as Route} className="underline">
                        {g.serie}-{g.numero}
                      </Link>
                    </td>
                    <td className="cifra">{g.fechaEmision}</td>
                    <td className="cifra">{g.fechaTraslado}</td>
                    <td className="max-w-[220px] truncate">{g.destinatario ?? "—"}</td>
                    <td>
                      <Insignia>{MOTIVO[g.motivo] ?? g.motivo}</Insignia>
                    </td>
                    <td><EstadoDoc estado={g.estado} /></td>
                    <td className="max-w-[220px] truncate" style={{ color: "var(--texto-suave)" }}>
                      {g.mensajeSunat ?? (g.ticket ? `ticket ${g.ticket}` : "—")}
                    </td>
                    <td className="text-right">
                      {puedeCrear ? (
                        <AccionesGuia guiaId={g.id} estado={g.estado} ticket={g.ticket} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
