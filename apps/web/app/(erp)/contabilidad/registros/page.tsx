import Link from "next/link";
import type { Route } from "next";
import { registroDeCompras, registroDeVentas } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Registros de compras y ventas · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Catálogo 1 de SUNAT, abreviado: la columna es estrecha. */
const DOCUMENTO: Record<string, string> = {
  "01": "FAC", "03": "BOL", "04": "LC", "07": "NC", "08": "ND", "09": "GR", "50": "DUA",
};

export default async function Registros({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; libro?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();
  const libro = params.libro === "ventas" ? "ventas" : "compras";

  const r = await conEmpresa(
    (db) => (libro === "ventas" ? registroDeVentas(db, periodo) : registroDeCompras(db, periodo)),
    "contabilidad:ver",
  );

  const esVentas = libro === "ventas";
  const t = r.totales;

  return (
    <>
      <Encabezado
        titulo={esVentas ? "Registro de ventas" : "Registro de compras"}
        descripcion={`Periodo ${periodo}. Las mismas filas que se entregan en el PLE, en forma de libro.`}
        acciones={
          <>
            <Imprimir />
            <Link
              href={`/contabilidad/ple?periodo=${periodo}` as Route}
              className="boton boton-secundario"
            >
              Descargar el PLE
            </Link>
          </>
        }
      />
      <Contenido>
        <form
          className="tarjeta filtro mb-5 flex flex-wrap items-end gap-3 p-4"
          action="/contabilidad/registros"
        >
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="libro">Libro</label>
            <select id="libro" name="libro" className="campo" defaultValue={libro}>
              <option value="compras">Registro de compras</option>
              <option value="ventas">Registro de ventas</option>
            </select>
          </div>
          <button className="boton boton-primario">Ver</button>

          <dl className="ml-auto flex flex-wrap gap-6 text-right">
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Base imponible</dt>
              <dd className="text-lg font-medium"><Importe valor={t.gravadas} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>IGV</dt>
              <dd className="text-lg font-medium"><Importe valor={t.igv} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Total</dt>
              <dd className="text-lg font-medium"><Importe valor={t.total} /></dd>
            </div>
          </dl>
        </form>

        {r.avisos.length > 0 && (
          <div
            className="tarjeta mb-5 p-4 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
          >
            <p className="font-medium" style={{ color: "var(--alerta)" }}>Al revisar el libro</p>
            <ul className="mt-1.5 space-y-1" style={{ color: "var(--texto-suave)" }}>
              {r.avisos.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="tarjeta overflow-x-auto">
          {r.renglones.length === 0 ? (
            <p className="px-4 py-6 text-sm" style={{ color: "var(--texto-suave)" }}>
              No hay documentos en el periodo {periodo}.
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Documento</th>
                  <th>{esVentas ? "Cliente" : "Proveedor"}</th>
                  <th>RUC / DNI</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">IGV</th>
                  <th className="text-right">Exonerado</th>
                  <th className="text-right">Inafecto</th>
                  {esVentas && <th className="text-right">Exportación</th>}
                  <th className="text-right">Total</th>
                  <th>Mon.</th>
                  <th className="text-right">T/C</th>
                  <th className="text-right">Total S/</th>
                  <th>{esVentas ? "Modifica a" : "Detracción"}</th>
                </tr>
              </thead>
              <tbody>
                {r.renglones.map((x) => (
                  <tr key={`${x.tipoDocumento}-${x.serie}-${x.numero}`}>
                    <td className="cifra" style={{ textAlign: "left" }}>{x.fechaEmision}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {DOCUMENTO[x.tipoDocumento] ?? x.tipoDocumento}
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {x.serie}-{x.numero}
                    </td>
                    <td className="max-w-[240px] truncate">
                      {x.tercero}
                      {(x.estado === "anulado" || x.estado === "anulada") && (
                        <span className="ml-1.5"><Insignia tono="peligro">anulado</Insignia></span>
                      )}
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>{x.numeroDocTercero}</td>
                    <td><Importe valor={x.gravadas} /></td>
                    <td><Importe valor={x.igv} /></td>
                    <td><Importe valor={x.exoneradas} /></td>
                    <td><Importe valor={x.inafectas} /></td>
                    {esVentas && <td><Importe valor={x.exportacion} /></td>}
                    <td className="font-medium"><Importe valor={x.total} /></td>
                    <td>{x.moneda}</td>
                    <td className="cifra">{x.tipoCambio}</td>
                    <td><Importe valor={x.totalSoles} /></td>
                    <td className="text-xs" style={{ color: "var(--texto-suave)" }}>
                      {(esVentas ? x.modificaA : x.detraccion) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase">
                    Totales del periodo
                  </td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.gravadas} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.igv} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.exoneradas} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.inafectas} /></td>
                  {esVentas && (
                    <td className="px-3 py-2 font-semibold"><Importe valor={t.exportacion} /></td>
                  )}
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.total} /></td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 font-semibold"><Importe valor={t.totalSoles} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          Este cuadro y el archivo del PLE salen de la misma consulta: lo que se revisa aquí es
          exactamente lo que se entrega. Las notas de crédito restan y lo anulado figura en cero,
          porque el correlativo no puede saltarse pero tampoco es una operación.
        </p>
      </Contenido>
    </>
  );
}
