import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { cargarGuia, GuiaInvalida } from "@roulterp/servicios";
import { cpe } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Documento, Datos } from "@/components/documento";

export const metadata = { title: "Guía de remisión · RoultERP" };
export const dynamic = "force-dynamic";

/** Catálogo 20 de SUNAT, en las palabras que usa quien despacha. */
const MOTIVO: Record<string, string> = {
  "01": "Venta",
  "02": "Compra",
  "04": "Traslado entre establecimientos de la misma empresa",
  "08": "Importación",
  "09": "Exportación",
  "13": "Otros",
  "14": "Venta sujeta a confirmación del comprador",
  "18": "Traslado emisor itinerante",
};

const MODO: Record<string, string> = { "01": "Transporte público", "02": "Transporte privado" };

export default async function GuiaImpresa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const guia = await cargarGuia(db, id).catch((e) => {
      if (e instanceof GuiaInvalida) return null;
      throw e;
    });
    if (!guia) return null;

    const [empresa] = (await db.execute(sql`SELECT ruc FROM empresas`)) as unknown as [
      { ruc: string },
    ];
    const [transportista] = guia.cabecera.transportistaId
      ? ((await db.execute(sql`
          SELECT razon_social, numero_documento
          FROM terceros WHERE id = ${guia.cabecera.transportistaId}`)) as unknown as [
          { razon_social: string; numero_documento: string } | undefined,
        ])
      : [undefined];
    const [sustento] = guia.cabecera.comprobanteId
      ? ((await db.execute(sql`
          SELECT tipo_documento, serie, numero
          FROM comprobantes WHERE id = ${guia.cabecera.comprobanteId}`)) as unknown as [
          { tipo_documento: string; serie: string; numero: string } | undefined,
        ])
      : [undefined];

    return { ...guia, empresa, transportista, sustento };
  }, "ventas:ver");

  if (!datos) notFound();
  const { cabecera, items, destinatario, empresa, transportista, sustento } = datos;

  /*
   * El QR de la guía lleva los mismos campos que el de un comprobante, con los
   * importes en cero: una guía no tiene IGV ni total. Se construye con el mismo
   * armador para que los dos digan lo mismo el día que SUNAT cambie el orden.
   */
  const qrCrudo = await cpe.qrSvg(
    cpe.contenidoQr({
      rucEmisor: empresa?.ruc ?? "",
      tipoComprobante: cabecera.tipoGuia,
      serie: cabecera.serie,
      numero: cabecera.numero,
      igv: "0.00",
      total: "0.00",
      fechaEmision: cabecera.fechaEmision,
      tipoDocAdquirente: destinatario?.tipoDocumento ?? "0",
      numeroDocAdquirente: destinatario?.numeroDocumento ?? "",
      hash: cabecera.hashXml,
    }),
  );
  const qr = qrCrudo.startsWith("<svg") ? qrCrudo : "";

  const conductor = [cabecera.conductorNombres, cabecera.conductorApellidos]
    .filter(Boolean)
    .join(" ");

  return (
    <Documento
      titulo="Guía de remisión electrónica"
      numero={`${cabecera.serie}-${cabecera.numero}`}
      fecha={cabecera.fechaEmision}
      volverA={`/guias/${id}`}
      volverTexto="Volver a la guía"
      firmas={["Entregado por", "Transportista", "Recibido conforme"]}
    >
      <Datos
        pares={[
          ["Destinatario", destinatario?.razonSocial ?? "—"],
          ["Documento", <span className="cifra">{destinatario?.numeroDocumento}</span>],
          ["Motivo del traslado", MOTIVO[cabecera.motivo] ?? cabecera.descripcionMotivo],
          ["Fecha de traslado", <span className="cifra">{cabecera.fechaTraslado}</span>],
          ["Punto de partida", `${cabecera.partidaDireccion} (${cabecera.partidaUbigeo})`],
          ["Punto de llegada", `${cabecera.llegadaDireccion} (${cabecera.llegadaUbigeo})`],
          [
            "Peso bruto",
            <span className="cifra">
              {cabecera.pesoBruto} {cabecera.unidadPeso}
            </span>,
          ],
          ["Bultos", <span className="cifra">{cabecera.bultos ?? "—"}</span>],
          ["Modalidad", MODO[cabecera.modoTransporte] ?? cabecera.modoTransporte],
          ...(transportista
            ? ([
                ["Transportista", transportista.razon_social],
                ["RUC del transportista", <span className="cifra">{transportista.numero_documento}</span>],
                ["Registro MTC", <span className="cifra">{cabecera.registroMtc ?? "—"}</span>],
              ] as [string, React.ReactNode][])
            : ([
                ["Placa", <span className="cifra">{cabecera.placa ?? "—"}</span>],
                ["Conductor", conductor || "—"],
                ["Licencia", <span className="cifra">{cabecera.conductorLicencia ?? "—"}</span>],
              ] as [string, React.ReactNode][])),
          ...(sustento
            ? ([
                [
                  "Documento que sustenta",
                  <span className="cifra">
                    {sustento.serie}-{sustento.numero}
                  </span>,
                ],
              ] as [string, React.ReactNode][])
            : []),
        ]}
      />

      <table className="tabla mt-3">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Código</th>
            <th>Descripción</th>
            <th className="text-right">Cantidad</th>
            <th>Unidad</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="cifra" style={{ textAlign: "left" }}>{i.linea}</td>
              <td className="cifra" style={{ textAlign: "left" }}>{i.codigo ?? "—"}</td>
              <td>{i.descripcion}</td>
              <td><Importe valor={i.cantidad} /></td>
              <td>{i.unidad}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {cabecera.observaciones && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold">Observaciones</h2>
          <p className="text-sm">{cabecera.observaciones}</p>
        </section>
      )}

      <footer
        className="mt-6 flex flex-wrap items-start justify-between gap-6 border-t pt-4"
        style={{ borderColor: "var(--borde)" }}
      >
        <div className="max-w-md text-xs" style={{ color: "var(--texto-suave)" }}>
          <p>
            Representación impresa de la guía de remisión electrónica. Debe acompañar la mercadería
            durante todo el traslado.
          </p>
          {cabecera.hashXml ? (
            <p className="cifra mt-1 break-all" style={{ textAlign: "left" }}>
              Resumen: {cabecera.hashXml}
            </p>
          ) : (
            <p className="mt-1" style={{ color: "var(--alerta)" }}>
              Esta guía todavía no está firmada: la hoja sale sin resumen y no ampara el traslado
              hasta que se emita.
            </p>
          )}
        </div>
        <div
          className="h-32 w-32 shrink-0"
          aria-label="Código QR de la guía"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      </footer>
    </Documento>
  );
}
