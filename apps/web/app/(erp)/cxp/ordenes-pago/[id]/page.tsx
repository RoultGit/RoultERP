import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cargarOrdenPago, cuentasParaOperar, OrdenPagoInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia } from "@/components/ui";
import { Autorizacion, Ejecutar, Anular } from "./panel";

export const metadata = { title: "Orden de pago · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "N. crédito",
  "08": "N. débito",
  "91": "C. del exterior",
};

export default async function OrdenPago({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { id } = await params;
  const { hecho } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const orden = await cargarOrdenPago(db, id).catch((e) => {
      if (e instanceof OrdenPagoInvalida) return null;
      throw e;
    });
    if (!orden) return null;
    return { ...orden, cuentas: await cuentasParaOperar(db) };
  }, "cxp:ver");

  if (!datos) notFound();

  const { cabecera, documentos } = datos;
  const [puedeAprobar, puedeAnular] = await Promise.all([
    tienePermiso("cxp:aprobar"),
    tienePermiso("cxp:anular"),
  ]);

  const anuncio: Record<string, string> = {
    autorizada: "Orden autorizada. Ya se puede ejecutar el pago.",
    rechazada: "Orden rechazada.",
    pagada: "Pago registrado. Los documentos quedaron descargados y el dinero salió de la cuenta.",
  };

  return (
    <>
      <Encabezado
        titulo={`Orden de pago ${cabecera.numero}`}
        descripcion={`${cabecera.proveedor} · ${cabecera.documentoProveedor}`}
        acciones={
          <>
            {puedeAnular && cabecera.estado !== "pagada" && cabecera.estado !== "anulada" && (
              <Anular ordenId={cabecera.id} />
            )}
            <Link href={"/cxp/ordenes-pago" as Route} className="boton boton-secundario">
              Volver
            </Link>
          </>
        }
      />
      <Contenido>
        {hecho && anuncio[hecho] && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {anuncio[hecho]}
          </p>
        )}
        {cabecera.motivoRechazo && (
          <p className="aviso mb-4" role="alert">
            Rechazada: {cabecera.motivoRechazo}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <section className="tarjeta p-4">
              <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <dt className="etiqueta">Estado</dt>
                  <dd><EstadoDoc estado={cabecera.estado} /></dd>
                </div>
                <div>
                  <dt className="etiqueta">Fecha</dt>
                  <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fecha}</dd>
                </div>
                <div>
                  <dt className="etiqueta">Se paga el</dt>
                  <dd className="cifra" style={{ textAlign: "left" }}>
                    {cabecera.fechaProgramada ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="etiqueta">Medio</dt>
                  <dd><Insignia>{cabecera.medioPago}</Insignia></dd>
                </div>
                <div>
                  <dt className="etiqueta">Importe</dt>
                  <dd className="font-medium">
                    <Importe valor={cabecera.importe} moneda={cabecera.moneda} />
                  </dd>
                </div>
                <div>
                  <dt className="etiqueta">Retención de IGV</dt>
                  <dd>{cabecera.retenerIgv ? "sí" : "no"}</dd>
                </div>
                {cabecera.observaciones && (
                  <div className="sm:col-span-2">
                    <dt className="etiqueta">Observaciones</dt>
                    <dd>{cabecera.observaciones}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="tarjeta overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Documentos que cancela
              </h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Emisión</th>
                    <th>Vence</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Saldo hoy</th>
                    <th className="text-right">Se paga</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((d) => (
                    <tr key={d.documentoId}>
                      <td className="cifra" style={{ textAlign: "left" }}>
                        {DOCUMENTO[d.tipoDocumento] ?? d.tipoDocumento} {d.serie}-{d.numero}
                      </td>
                      <td className="cifra">{d.fechaEmision}</td>
                      <td className="cifra">{d.fechaVencimiento}</td>
                      <td><Importe valor={d.total} moneda={cabecera.moneda} /></td>
                      <td><Importe valor={d.saldo} moneda={cabecera.moneda} /></td>
                      <td className="font-medium">
                        <Importe valor={d.importe} moneda={cabecera.moneda} />
                      </td>
                      <td><EstadoDoc estado={d.estadoDocumento} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--superficie-2)" }}>
                    <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                      Total
                    </td>
                    <td className="font-semibold">
                      <Importe valor={cabecera.importe} moneda={cabecera.moneda} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <section className="tarjeta">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                {cabecera.estado === "pendiente"
                  ? "Autorización"
                  : cabecera.estado === "autorizada"
                    ? "Ejecutar el pago"
                    : "Estado"}
              </h2>

              {!puedeAprobar ? (
                <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
                  No tiene permiso para autorizar ni ejecutar pagos.
                </p>
              ) : cabecera.estado === "pendiente" ? (
                <Autorizacion ordenId={cabecera.id} />
              ) : cabecera.estado === "autorizada" ? (
                <Ejecutar
                  ordenId={cabecera.id}
                  moneda={cabecera.moneda}
                  cuentaSugerida={cabecera.cuentaEfectivoId}
                  cuentas={datos.cuentas.map((c) => ({
                    id: c.id,
                    etiqueta: `${c.nombre} · ${c.moneda}`,
                  }))}
                />
              ) : (
                <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
                  {cabecera.estado === "pagada"
                    ? "La orden ya se pagó. Para corregir, extorne el pago desde contabilidad."
                    : `La orden está ${cabecera.estado}.`}
                </p>
              )}
            </section>
          </aside>
        </div>
      </Contenido>
    </>
  );
}
