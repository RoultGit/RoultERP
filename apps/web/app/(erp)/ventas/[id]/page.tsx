import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { cargarComprobante, VentaInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia } from "@/components/ui";
import { PanelSunat } from "./sunat";

export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura", "03": "Boleta de venta", "07": "Nota de crédito", "08": "Nota de débito",
};

const AFECTACION: Record<string, string> = {
  "10": "Gravado", "20": "Exonerado", "30": "Inafecto", "40": "Exportación",
  "15": "Gratuito",
};

export default async function DetalleVenta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    try {
      return await cargarComprobante(db, id);
    } catch (e) {
      if (e instanceof VentaInvalida) return null;
      throw e;
    }
  }, "ventas:ver");

  if (!datos) notFound();
  const { cabecera, items, cliente } = datos;
  const puedeEnviar = await tienePermiso("cpe:crear");

  return (
    <>
      <Encabezado
        titulo={`${DOCUMENTO[cabecera.tipoDocumento] ?? cabecera.tipoDocumento} ${cabecera.serie}-${cabecera.numero}`}
        descripcion={`${cliente?.razonSocial ?? ""} · ${cliente?.numeroDocumento ?? ""} · ${cabecera.fechaEmision}`}
        acciones={<Link href="/ventas" className="boton boton-secundario">Volver</Link>}
      />
      <Contenido>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="tarjeta overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Detalle
            </h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Descripción</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">V. unitario</th>
                  <th>IGV</th>
                  <th className="text-right">Valor venta</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="cifra" style={{ color: "var(--texto-suave)" }}>{it.linea}</td>
                    <td>
                      <div>{it.descripcion}</div>
                      <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                        {it.codigo} · {it.unidad}
                        {it.costoUnitario && (
                          <> · costo {money.toString(money.dec(it.costoUnitario), 4)}</>
                        )}
                      </div>
                    </td>
                    <td><Importe valor={it.cantidad} /></td>
                    <td><Importe valor={it.valorUnitario} decimales={4} /></td>
                    <td style={{ color: "var(--texto-suave)" }}>
                      {AFECTACION[it.afectacionIgv] ?? it.afectacionIgv}
                    </td>
                    <td><Importe valor={it.valorVenta} /></td>
                    <td><Importe valor={it.importeLinea} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="border-t p-4 text-sm" style={{ borderColor: "var(--borde)" }}>
              <Fila etiqueta="Operaciones gravadas" valor={cabecera.gravadas} moneda={cabecera.moneda} />
              {!money.isZero(money.dec(cabecera.exoneradas)) && (
                <Fila etiqueta="Operaciones exoneradas" valor={cabecera.exoneradas} moneda={cabecera.moneda} />
              )}
              {!money.isZero(money.dec(cabecera.inafectas)) && (
                <Fila etiqueta="Operaciones inafectas" valor={cabecera.inafectas} moneda={cabecera.moneda} />
              )}
              {!money.isZero(money.dec(cabecera.gratuitas)) && (
                <Fila etiqueta="Operaciones gratuitas" valor={cabecera.gratuitas} moneda={cabecera.moneda} />
              )}
              <Fila etiqueta="IGV" valor={cabecera.igv} moneda={cabecera.moneda} />
              <Fila etiqueta="Importe total" valor={cabecera.total} moneda={cabecera.moneda} destacado />
              {cabecera.totalEnLetras && (
                <p className="mt-2 text-xs uppercase" style={{ color: "var(--texto-suave)" }}>
                  {cabecera.totalEnLetras}
                </p>
              )}
            </dl>

            {!money.isZero(money.dec(cabecera.detraccionMonto)) && (
              <div className="border-t px-4 py-3 text-sm" style={{ borderColor: "var(--borde)" }}>
                <Insignia tono="alerta">Sujeta a detracción</Insignia>
                <span className="ml-2">
                  Código {cabecera.detraccionCodigo} ·{" "}
                  <Importe valor={cabecera.detraccionMonto} moneda="PEN" /> al Banco de la Nación
                </span>
              </div>
            )}
          </section>

          <PanelSunat
            comprobanteId={cabecera.id}
            estado={cabecera.estado}
            codigo={cabecera.codigoSunat}
            mensaje={cabecera.mensajeSunat}
            observaciones={cabecera.observacionesSunat ?? []}
            hash={cabecera.hashXml}
            enviadoEn={cabecera.enviadoEn?.toISOString() ?? null}
            tieneCdr={!!cabecera.cdrBase64}
            puedeEnviar={puedeEnviar}
          />
        </div>
      </Contenido>
    </>
  );
}

function Fila({
  etiqueta,
  valor,
  moneda,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  moneda: string;
  destacado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt style={{ color: destacado ? undefined : "var(--texto-suave)" }}
          className={destacado ? "font-medium" : ""}>
        {etiqueta}
      </dt>
      <dd className={destacado ? "text-base font-semibold" : ""}>
        <Importe valor={valor} moneda={moneda} />
      </dd>
    </div>
  );
}
