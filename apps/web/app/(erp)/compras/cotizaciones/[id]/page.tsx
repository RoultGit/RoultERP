import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import {
  cuadroComparativo, listarTerceros, listarAlmacenes, RequisicionInvalida,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Vacio, formatearImporte } from "@/components/ui";
import { FormularioRespuesta } from "./respuesta";
import { AccionesColumna, CerrarSolicitud } from "./acciones-columna";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Cuadro comparativo · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Cuadro({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { id } = await params;
  const { hecho } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const cuadro = await cuadroComparativo(db, id).catch((e) => {
      if (e instanceof RequisicionInvalida) return null;
      throw e;
    });
    if (!cuadro) return null;
    const [proveedores, almacenes] = await Promise.all([
      listarTerceros(db, { rol: "proveedor" }),
      listarAlmacenes(db),
    ]);
    return { ...cuadro, proveedores, almacenes };
  }, "compras:ver");

  if (!datos) notFound();

  const { cabecera, columnas, filas } = datos;
  const [puedeCrear, puedeAprobar] = await Promise.all([
    tienePermiso("compras:crear"),
    tienePermiso("compras:aprobar"),
  ]);
  const abierta = cabecera.estado === "abierta";
  const hoy = hoyEnPeru();

  // Los que ya respondieron no vuelven a aparecer en el desplegable: registrar
  // dos ofertas vigentes del mismo proveedor haría del cuadro una adivinanza.
  const yaCotizaron = new Set(
    columnas.filter((c) => c.estado !== "descartada").map((c) => c.proveedorId),
  );

  return (
    <>
      <Encabezado
        titulo={`Solicitud ${cabecera.numero}`}
        descripcion="Cuadro comparativo. Todas las ofertas se llevan a soles con su propio tipo de cambio antes de compararlas."
        acciones={
          <>
            {puedeCrear && abierta && <CerrarSolicitud solicitudId={cabecera.id} />}
            <Link href={"/compras/cotizaciones" as Route} className="boton boton-secundario">
              Volver
            </Link>
          </>
        }
      />
      <Contenido>
        {hecho && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {hecho}
          </p>
        )}

        <section className="bloque mb-5 p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="etiqueta">Estado</dt>
              <dd><EstadoDoc estado={cabecera.estado} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Fecha</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fecha}</dd>
            </div>
            <div>
              <dt className="etiqueta">Reciben hasta</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fechaLimite ?? "—"}</dd>
            </div>
            <div>
              <dt className="etiqueta">Ofertas</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{columnas.length}</dd>
            </div>
          </dl>
        </section>

        <section className="bloque mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Cuadro comparativo
          </h2>
          {columnas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no respondió nadie"
                descripcion="Registre abajo lo que cotizó cada proveedor; el cuadro se arma solo."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th className="min-w-[220px]">Artículo</th>
                  <th className="w-24 text-right">Cantidad</th>
                  {columnas.map((c) => (
                    <th key={c.cotizacionId} className="min-w-[150px] text-right">
                      <div className="truncate">{c.proveedor}</div>
                      <div className="cifra text-xs font-normal" style={{ color: "var(--texto-suave)" }}>
                        {c.numero} · {c.moneda}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.solicitudItemId}>
                    <td>
                      {f.descripcion}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                        {f.unidad}
                      </span>
                    </td>
                    <td className="cifra">{money.toString(money.dec(f.cantidad), 2)}</td>
                    {columnas.map((c) => {
                      const o = f.ofertas.find((x) => x.cotizacionId === c.cotizacionId);
                      if (!o) {
                        return (
                          <td key={c.cotizacionId} className="cifra" style={{ color: "var(--texto-suave)" }}>
                            no cotizó
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c.cotizacionId}
                          className="cifra"
                          style={o.esMejor ? { color: "var(--exito)", fontWeight: 500 } : undefined}
                        >
                          {formatearImporte(o.valorUnitario)}
                          {c.moneda !== "PEN" && (
                            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                              S/ {formatearImporte(o.valorUnitarioSoles)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={2} className="px-3 py-1.5 text-right text-xs uppercase">Total en soles</td>
                  {columnas.map((c) => (
                    <td
                      key={c.cotizacionId}
                      className="cifra px-3 py-1.5 font-semibold"
                      style={c.esMejorTotal ? { color: "var(--exito)" } : undefined}
                    >
                      {formatearImporte(c.totalSoles)}
                    </td>
                  ))}
                </tr>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={2} className="px-3 py-1.5 text-right text-xs uppercase">Entrega</td>
                  {columnas.map((c) => (
                    <td key={c.cotizacionId} className="cifra px-3 py-1.5 text-xs">
                      {c.plazoEntregaDias === null ? "—" : `${c.plazoEntregaDias} d`}
                    </td>
                  ))}
                </tr>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={2} className="px-3 py-1.5 text-right text-xs uppercase">Pago</td>
                  {columnas.map((c) => (
                    <td key={c.cotizacionId} className="px-3 py-1.5 text-xs">
                      {c.condicionPago ?? "—"}
                    </td>
                  ))}
                </tr>
                {puedeCrear && (
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase">Decisión</td>
                    {columnas.map((c) => (
                      <td key={c.cotizacionId} className="px-3 py-2">
                        <AccionesColumna
                          solicitudId={cabecera.id}
                          cotizacionId={c.cotizacionId}
                          estado={c.estado}
                          ordenCompraId={c.ordenCompraId}
                          puedeAprobar={puedeAprobar}
                          hoy={hoy}
                          almacenes={datos.almacenes
                            .filter((a) => a.activo)
                            .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
                        />
                      </td>
                    ))}
                  </tr>
                )}
              </tfoot>
            </table>
          )}
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            El verde marca el mejor precio, no la mejor oferta: el plazo de entrega y la condición de
            pago están en la misma tabla porque el más barato no siempre gana.
          </p>
        </section>

        {puedeCrear && abierta && (
          <FormularioRespuesta
            solicitudId={cabecera.id}
            hoy={hoy}
            lineas={filas.map((f) => ({
              solicitudItemId: f.solicitudItemId,
              descripcion: f.descripcion,
              unidad: f.unidad,
              cantidad: money.toString(money.dec(f.cantidad), 2),
            }))}
            proveedores={datos.proveedores
              .filter((p) => !yaCotizaron.has(p.id))
              .map((p) => ({ id: p.id, etiqueta: `${p.razonSocial} · ${p.numeroDocumento}` }))}
          />
        )}
      </Contenido>
    </>
  );
}
