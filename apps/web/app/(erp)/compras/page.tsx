import Link from "next/link";
import type { Route } from "next";
import { listarCompras, listarOrdenes } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import {
  Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio, BotonEnlace,
} from "@/components/ui";

export const metadata = { title: "Compras · RoultERP" };
export const dynamic = "force-dynamic";

/** Catálogo 01 de SUNAT, en lo que aparece en compras. */
const DOCUMENTO: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "N. crédito",
  "08": "N. débito",
  "14": "Recibo servicios",
  "50": "DUA",
};

export default async function Compras({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; vista?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { periodo, vista } = params;
  const pagina = paginaDe(params.pagina);
  const enOrdenes = vista === "ordenes";

  const datos = await conEmpresa(
    async (db) =>
      enOrdenes
        ? { ordenes: await listarOrdenes(db), compras: [] as never[] }
        : { ordenes: [] as never[], compras: await listarCompras(db, periodo) },
    "compras:ver",
  );

  const puedeCrear = await tienePermiso("compras:crear");
  const totalIgv = datos.compras.reduce((a, c) => money.add(a, money.dec(c.igv)), money.ZERO);
  const total = datos.compras.reduce((a, c) => money.add(a, money.dec(c.total)), money.ZERO);

  return (
    <>
      <Encabezado
        titulo="Compras"
        descripcion={
          enOrdenes
            ? "Compromisos con proveedores, antes de que llegue su factura."
            : "Facturas de proveedores. Sustentan el crédito fiscal y la cuenta por pagar."
        }
        acciones={
          puedeCrear ? (
            <>
              <BotonEnlace href="/compras/ordenes/nueva" variante="secundario">
                Nueva orden
              </BotonEnlace>
              <BotonEnlace href="/compras/nueva">Registrar compra</BotonEnlace>
            </>
          ) : null
        }
      />
      <Contenido>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Pestana href="/compras" activa={!enOrdenes}>
            Registro de compras
          </Pestana>
          <Pestana href="/compras?vista=ordenes" activa={enOrdenes}>
            Órdenes de compra
          </Pestana>

          {!enOrdenes && (
            <form className="ml-auto flex gap-2" action="/compras">
              <input
                name="periodo" defaultValue={periodo ?? ""} className="campo w-32 cifra"
                style={{ textAlign: "left" }} placeholder="202609" pattern="\d{6}"
                aria-label="Periodo AAAAMM"
              />
              <button className="boton boton-secundario">Filtrar</button>
            </form>
          )}
        </div>

        {enOrdenes ? (
          datos.ordenes.length === 0 ? (
            <Vacio
              titulo="Sin órdenes de compra"
              descripcion="Una orden deja constancia de lo pedido para poder compararlo con lo que llega."
            />
          ) : (
            <div className="tarjeta overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Proveedor</th>
                    <th>Fecha</th>
                    <th>Entrega</th>
                    <th>Mon.</th>
                    <th className="text-right">Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rodaja(datos.ordenes, pagina).map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/compras/ordenes/${o.id}` as Route} className="font-medium underline">
                          {o.numero}
                        </Link>
                      </td>
                      <td className="max-w-[260px] truncate">{o.proveedor}</td>
                      <td className="cifra">{o.fecha}</td>
                      <td className="cifra">{o.fechaEntrega ?? "—"}</td>
                      <td>{o.moneda}</td>
                      <td><Importe valor={o.total} /></td>
                      <td><EstadoDoc estado={o.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Paginacion
                total={datos.ordenes.length}
                pagina={pagina}
                params={params}
                etiqueta="órdenes"
              />
            </div>
          )
        ) : datos.compras.length === 0 ? (
          <Vacio
            titulo={periodo ? `Sin compras en el periodo ${periodo}` : "Todavía no hay compras"}
            descripcion="Registre la factura del proveedor: genera el asiento, la cuenta por pagar y, si trae mercadería, el ingreso al almacén."
            accion={puedeCrear ? <BotonEnlace href="/compras/nueva">Registrar compra</BotonEnlace> : null}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Proveedor</th>
                  <th>Emisión</th>
                  <th>Periodo</th>
                  <th>Mon.</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">IGV</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Detracción</th>
                </tr>
              </thead>
              <tbody>
                {rodaja(datos.compras, pagina).map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                        {DOCUMENTO[c.tipoDocumento] ?? c.tipoDocumento}
                      </span>{" "}
                      <span className="cifra" style={{ textAlign: "left" }}>
                        {c.serie}-{c.numero}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate">
                      {c.proveedor}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        {c.documentoProveedor}
                      </span>
                    </td>
                    <td className="cifra">{c.fechaEmision}</td>
                    <td className="cifra">{c.periodo}</td>
                    <td>{c.moneda}</td>
                    <td><Importe valor={c.gravadas} /></td>
                    <td><Importe valor={c.igv} /></td>
                    <td><Importe valor={c.total} /></td>
                    <td>
                      {money.isZero(money.dec(c.detraccionMonto)) ? (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      ) : (
                        <Importe valor={c.detraccionMonto} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Totales del periodo
                  </td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(totalIgv, 2)} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(total, 2)} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <Paginacion
              total={datos.compras.length}
              pagina={pagina}
              params={params}
              etiqueta="compras"
            />
          </div>
        )}

        {!enOrdenes && datos.compras.length > 0 && (
          <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
            <Insignia>PLE 8.1</Insignia> Este registro es la base del formato 8.1 del Programa de
            Libros Electrónicos.
          </p>
        )}
      </Contenido>
    </>
  );
}

function Pestana({
  href,
  activa,
  children,
}: {
  href: string;
  activa: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className="rounded border px-3 py-1.5 text-sm transition-colors"
      style={{
        borderColor: activa ? "var(--acento)" : "var(--borde)",
        background: activa ? "var(--acento-suave)" : "var(--superficie)",
        color: activa ? "var(--acento)" : "var(--texto-suave)",
        fontWeight: activa ? 500 : 400,
      }}
    >
      {children}
    </Link>
  );
}
