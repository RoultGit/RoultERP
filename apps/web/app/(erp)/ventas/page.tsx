import Link from "next/link";
import type { Route } from "next";
import { listarVentas, listaParaEmitir } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { kekMaestra } from "@/lib/entorno";
import {
  Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace,
} from "@/components/ui";

export const metadata = { title: "Ventas · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "N. crédito", "08": "N. débito",
};

/** Cómo se ve cada estado ante SUNAT. */
function EstadoSunat({ estado, codigo }: { estado: string; codigo: number | null }) {
  if (estado === "aceptado") return <Insignia tono="exito">aceptado</Insignia>;
  if (estado === "aceptado_con_observaciones") {
    return <Insignia tono="alerta">aceptado con observaciones</Insignia>;
  }
  if (estado === "rechazado") {
    return <Insignia tono="peligro">rechazado {codigo ? `(${codigo})` : ""}</Insignia>;
  }
  if (estado === "anulado") return <Insignia tono="peligro">anulado</Insignia>;
  // Borrador, firmado y enviado son el mismo hecho para el usuario: todavía no
  // hay respuesta de SUNAT.
  return <Insignia tono="alerta">pendiente de envío</Insignia>;
}

export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo } = await searchParams;

  const { ventas, preparacion } = await conEmpresa(
    async (db, sesion) => ({
      ventas: await listarVentas(db, periodo),
      preparacion: await listaParaEmitir(db, sesion.empresaId, kekMaestra),
    }),
    "ventas:ver",
  );

  const puedeCrear = await tienePermiso("ventas:crear");
  const total = ventas.reduce((a, v) => money.add(a, money.dec(v.total)), money.ZERO);
  const igv = ventas.reduce((a, v) => money.add(a, money.dec(v.igv)), money.ZERO);
  const pendientes = ventas.filter(
    (v) => !["aceptado", "aceptado_con_observaciones", "rechazado", "anulado"].includes(v.estado),
  ).length;

  return (
    <>
      <Encabezado
        titulo="Ventas"
        descripcion="Comprobantes emitidos y su estado ante SUNAT."
        acciones={
          <>
            <BotonEnlace href="/cpe" variante="secundario">Configuración de emisión</BotonEnlace>
            {puedeCrear && preparacion.lista && (
              <BotonEnlace href="/ventas/nueva">Emitir comprobante</BotonEnlace>
            )}
          </>
        }
      />
      <Contenido>
        {!preparacion.lista && (
          <div className="mb-5 tarjeta p-4" style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}>
            <p className="font-medium" style={{ color: "var(--alerta)" }}>
              Falta configurar la emisión electrónica
            </p>
            <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--texto-suave)" }}>
              {preparacion.faltantes.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            <div className="mt-3">
              <BotonEnlace href="/cpe">Configurar</BotonEnlace>
            </div>
          </div>
        )}

        {preparacion.avisos.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {preparacion.avisos.map((a) => (
              <Insignia key={a} tono="alerta">{a}</Insignia>
            ))}
          </div>
        )}

        <form className="mb-4 flex gap-2" action="/ventas">
          <input
            name="periodo" defaultValue={periodo ?? ""} className="campo w-32 cifra"
            style={{ textAlign: "left" }} placeholder="202609" pattern="\d{6}"
            aria-label="Periodo AAAAMM"
          />
          <button className="boton boton-secundario">Filtrar</button>
          {periodo && <Link href="/ventas" className="boton boton-secundario">Limpiar</Link>}
          {pendientes > 0 && (
            <span className="ml-auto self-center">
              <Insignia tono="alerta">
                {pendientes} pendiente{pendientes === 1 ? "" : "s"} de informar a SUNAT
              </Insignia>
            </span>
          )}
        </form>

        {ventas.length === 0 ? (
          <Vacio
            titulo={periodo ? `Sin ventas en el periodo ${periodo}` : "Todavía no hay ventas"}
            descripcion="Emitir genera el comprobante, descarga el inventario y contabiliza. El envío a SUNAT ocurre después, para que una caída del servicio no impida facturar."
            accion={
              puedeCrear && preparacion.lista
                ? <BotonEnlace href="/ventas/nueva">Emitir comprobante</BotonEnlace>
                : null
            }
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Cliente</th>
                  <th>Emisión</th>
                  <th>Mon.</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">IGV</th>
                  <th className="text-right">Total</th>
                  <th>SUNAT</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">
                      <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                        {DOCUMENTO[v.tipoDocumento] ?? v.tipoDocumento}
                      </span>{" "}
                      <Link href={`/ventas/${v.id}` as Route} className="cifra underline" style={{ textAlign: "left" }}>
                        {v.serie}-{v.numero}
                      </Link>
                    </td>
                    <td className="max-w-[240px] truncate">
                      {v.cliente}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        {v.documentoCliente}
                      </span>
                    </td>
                    <td className="cifra">{v.fechaEmision}</td>
                    <td>{v.moneda}</td>
                    <td><Importe valor={v.gravadas} /></td>
                    <td><Importe valor={v.igv} /></td>
                    <td><strong><Importe valor={v.total} /></strong></td>
                    <td><EstadoSunat estado={v.estado} codigo={v.codigoSunat} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Totales
                  </td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(igv, 2)} /></td>
                  <td className="px-3 py-2 font-semibold"><Importe valor={money.toString(total, 2)} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {ventas.length > 0 && (
          <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
            <Insignia>PLE 14.1</Insignia> Este registro será la base del formato 14.1 del Programa
            de Libros Electrónicos, todavía sin implementar.
          </p>
        )}
      </Contenido>
    </>
  );
}
