import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cargarGuia, GuiaInvalida } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe } from "@/components/ui";
import { AccionesGuia } from "../formularios";

export const dynamic = "force-dynamic";

const MOTIVO: Record<string, string> = {
  "01": "Venta", "02": "Compra", "04": "Traslado entre establecimientos",
  "05": "Consignación", "06": "Devolución", "08": "Importación",
  "09": "Exportación", "13": "Otros",
};

export default async function DetalleGuia({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    try {
      return await cargarGuia(db, id);
    } catch (e) {
      if (e instanceof GuiaInvalida) return null;
      throw e;
    }
  }, "ventas:ver");

  if (!datos) notFound();
  const { cabecera: g, items, destinatario } = datos;
  const puedeCrear = await tienePermiso("ventas:crear");

  return (
    <>
      <Encabezado
        titulo={`Guía de remisión ${g.serie}-${g.numero}`}
        descripcion={`${destinatario?.razonSocial ?? ""} · traslado del ${g.fechaTraslado}`}
        acciones={
          <>
            {/* La guía viaja con la mercadería: la hoja es parte del traslado. */}
            <Link href={`/guias/${g.id}/impresion` as Route} className="boton boton-secundario">
              Imprimir
            </Link>
            <Link href={"/guias" as Route} className="boton boton-secundario">Volver</Link>
          </>
        }
      />
      <Contenido>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="tarjeta overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Bienes trasladados
            </h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Descripción</th>
                  <th>Unidad</th>
                  <th className="text-right">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="cifra" style={{ color: "var(--texto-suave)" }}>{it.linea}</td>
                    <td>
                      {it.descripcion}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        {it.codigo}
                      </span>
                    </td>
                    <td>{it.unidad}</td>
                    <td><Importe valor={it.cantidad} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="border-t p-4 text-sm" style={{ borderColor: "var(--borde)" }}>
              <Dato etiqueta="Motivo" valor={`${g.motivo} — ${MOTIVO[g.motivo] ?? ""}`} />
              <Dato etiqueta="Descripción del motivo" valor={g.descripcionMotivo} />
              <Dato etiqueta="Peso bruto" valor={`${g.pesoBruto} ${g.unidadPeso}`} />
              {g.bultos !== null && <Dato etiqueta="Bultos" valor={String(g.bultos)} />}
              <Dato
                etiqueta="Partida"
                valor={`${g.partidaDireccion} (ubigeo ${g.partidaUbigeo})`}
              />
              <Dato
                etiqueta="Llegada"
                valor={`${g.llegadaDireccion} (ubigeo ${g.llegadaUbigeo})`}
              />
              <Dato
                etiqueta="Transporte"
                valor={
                  g.modoTransporte === "01"
                    ? `Público${g.registroMtc ? ` · MTC ${g.registroMtc}` : ""}`
                    : `Privado · placa ${g.placa ?? "—"} · conductor ${g.conductorNombres ?? ""} ${g.conductorApellidos ?? ""} (lic. ${g.conductorLicencia ?? "—"})`
                }
              />
              {g.observaciones && <Dato etiqueta="Observaciones" valor={g.observaciones} />}
            </dl>
          </section>

          <section className="tarjeta p-4">
            <h2 className="mb-3 text-sm font-semibold">Envío a SUNAT</h2>
            <dl className="text-sm">
              <Dato etiqueta="Estado" valor="" nodo={<EstadoDoc estado={g.estado} />} />
              <Dato etiqueta="Ticket" valor={g.ticket ?? "—"} />
              <Dato etiqueta="Respuesta" valor={g.mensajeSunat ?? "—"} />
              {g.hashXml && <Dato etiqueta="Resumen del XML" valor={`${g.hashXml.slice(0, 16)}…`} />}
              <Dato etiqueta="CDR" valor={g.cdrBase64 ? "conservado" : "—"} />
            </dl>
            {puedeCrear && (
              <div className="mt-4">
                <AccionesGuia guiaId={g.id} estado={g.estado} ticket={g.ticket} />
              </div>
            )}
          </section>
        </div>
      </Contenido>
    </>
  );
}

function Dato({
  etiqueta,
  valor,
  nodo,
}: {
  etiqueta: string;
  valor: string;
  nodo?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt style={{ color: "var(--texto-suave)" }}>{etiqueta}</dt>
      <dd className="text-right">{nodo ?? valor}</dd>
    </div>
  );
}
