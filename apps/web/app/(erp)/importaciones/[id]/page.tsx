import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import {
  cargar, previsualizarLiquidacion, listarProductos, CONCEPTOS_IMPORTACION,
  expedienteDe, ImportacionInvalida,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia } from "@/components/ui";
import { PanelLiquidacion } from "./liquidacion";
import { AvanzarEstado } from "./estado";
import { AgregarItem, AgregarGasto } from "./agregar";
import { Expediente } from "./expediente";

export const dynamic = "force-dynamic";

export default async function DetalleImportacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    try {
      const base = await cargar(db, id);
      // La vista previa falla si todavía no hay ítems, y eso es normal en un
      // borrador recién creado: no es un error que deba tumbar la pantalla.
      const vista = base.items.length
        ? await previsualizarLiquidacion(db, id)
        : null;
      return {
        ...base,
        vista,
        productos: await listarProductos(db),
        expediente: await expedienteDe(db, id),
      };
    } catch (e) {
      if (e instanceof ImportacionInvalida) return null;
      throw e;
    }
  }, "importaciones:ver");

  if (!datos) notFound();

  const { cabecera, items, gastos, vista, productos, expediente } = datos;
  const editable = cabecera.estado !== "liquidada" && cabecera.estado !== "anulada";
  const puedeEditar = await tienePermiso("importaciones:editar");
  const puedeAprobar = await tienePermiso("importaciones:aprobar");

  const fobMonedaOrigen = items.reduce(
    (a, i) => money.add(a, money.mul(money.dec(i.cantidad), money.dec(i.fobUnitario))),
    money.ZERO,
  );

  return (
    <>
      <Encabezado
        titulo={`Importación ${cabecera.numero}`}
        descripcion={[
          cabecera.facturaExterior && `Factura ${cabecera.facturaExterior}`,
          cabecera.incoterm,
          cabecera.puertoOrigen && `${cabecera.puertoOrigen} → ${cabecera.puertoDestino ?? "—"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        acciones={
          <div className="flex items-center gap-2">
            {/* La orden se imprime y se manda al exportador: es un documento,
                no una pantalla de trabajo, y por eso vive en su propia ruta. */}
            <Link href={`/importaciones/${id}/orden` as Route} className="boton boton-secundario">
              Emitir orden
            </Link>
            {puedeAprobar ? (
              <AvanzarEstado id={id} estado={cabecera.estado} />
            ) : (
              <EstadoDoc estado={cabecera.estado} />
            )}
          </div>
        }
      />

      <Contenido>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className="bloque overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Mercadería
              </h2>
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Producto</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">FOB unit.</th>
                    <th className="text-right">FOB total</th>
                    <th className="text-right">Peso (kg)</th>
                    <th className="text-right">Costo unit. (S/)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const liq = vista?.liquidacion.items.find((x) => x.item.id === i.id);
                    return (
                      <tr key={i.id}>
                        <td className="cifra" style={{ color: "var(--texto-suave)" }}>
                          {i.linea}
                        </td>
                        <td>
                          <div className="font-medium">{i.descripcion}</div>
                          <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                            {i.codigo}
                            {i.partidaArancelaria && ` · partida ${i.partidaArancelaria}`}
                          </div>
                        </td>
                        <td>
                          <Importe valor={i.cantidad} />
                        </td>
                        <td>
                          <Importe valor={i.fobUnitario} />
                        </td>
                        <td>
                          <Importe
                            valor={money.toString(
                              money.mul(money.dec(i.cantidad), money.dec(i.fobUnitario)),
                              2,
                            )}
                          />
                        </td>
                        <td>
                          <Importe valor={i.peso} />
                        </td>
                        <td>
                          {liq ? (
                            <strong>
                              <Importe valor={money.toString(liq.costoUnitario, 4)} decimales={4} />
                            </strong>
                          ) : (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--superficie-2)" }}>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                      FOB total ({cabecera.moneda})
                    </td>
                    <td className="px-3 py-2">
                      <Importe valor={money.toString(fobMonedaOrigen, 2)} />
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>

              {editable && puedeEditar && (
                <details className="border-t" style={{ borderColor: "var(--borde)" }}>
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none">
                    Agregar ítem
                  </summary>
                  <AgregarItem
                    importacionId={id}
                    productos={productos.map((p) => ({
                      id: p.id,
                      codigo: p.codigo,
                      descripcion: p.descripcion,
                      pesoUnitario: p.pesoUnitario,
                      partidaArancelaria: null,
                    }))}
                  />
                </details>
              )}
            </section>

            <Expediente
              importacionId={id}
              filas={expediente.filas.map((f) => ({
                clave: f.clave,
                nombre: f.nombre,
                exigible: f.exigible,
                antesDe: f.antesDe,
                ...(f.nota ? { nota: f.nota } : {}),
                recibidoEn: f.recibidoEn,
                referencia: f.referencia,
                noAplica: f.noAplica,
                observaciones: f.observaciones,
                vencido: f.vencido,
              }))}
              vencidos={expediente.vencidos.length}
              hito={expediente.hito}
              editable={editable && puedeEditar}
            />

            <section className="bloque overflow-x-auto">
              <div
                className="flex items-center justify-between border-b px-4 py-2.5"
                style={{ borderColor: "var(--borde)" }}
              >
                <h2 className="text-sm font-semibold">Gastos del embarque</h2>
                <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                  Los marcados «crédito fiscal» no forman parte del costo
                </span>
              </div>
              {gastos.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--texto-suave)" }}>
                  Sin gastos registrados. El costo será el FOB convertido a soles.
                </p>
              ) : (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Documento</th>
                      <th className="text-right">Importe</th>
                      <th>Mon.</th>
                      <th className="text-right">T.C.</th>
                      <th className="text-right">En soles</th>
                      <th>Prorrateo</th>
                      <th>Tratamiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gastos.map((g) => (
                      <tr key={g.id}>
                        <td className="font-medium">{g.concepto}</td>
                        <td style={{ color: "var(--texto-suave)" }}>{g.documento ?? "—"}</td>
                        <td>
                          <Importe valor={g.importe} />
                        </td>
                        <td>{g.moneda}</td>
                        <td>
                          <Importe valor={g.tipoCambio} decimales={3} />
                        </td>
                        <td>
                          <Importe
                            valor={money.toString(
                              money.mul(money.dec(g.importe), money.dec(g.tipoCambio)),
                              2,
                            )}
                          />
                        </td>
                        <td>
                          <Insignia>{g.baseProrrateo}</Insignia>
                        </td>
                        <td>
                          {g.afectaCosto ? (
                            <Insignia>costo</Insignia>
                          ) : (
                            <Insignia tono="alerta">crédito fiscal</Insignia>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {editable && puedeEditar && (
                <details className="border-t" style={{ borderColor: "var(--borde)" }}>
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none">
                    Agregar gasto
                  </summary>
                  <AgregarGasto
                    importacionId={id}
                    items={items.map((i) => ({
                      id: i.id,
                      linea: i.linea,
                      descripcion: i.descripcion,
                    }))}
                    conceptos={CONCEPTOS_IMPORTACION.map((c) => ({
                      concepto: c.concepto,
                      base: c.base,
                      afectaCosto: c.afectaCosto,
                      ...(c.nota ? { nota: c.nota } : {}),
                    }))}
                  />
                </details>
              )}
            </section>
          </div>

          <PanelLiquidacion
            importacionId={id}
            estado={cabecera.estado}
            vista={
              vista
                ? {
                    fobTotal: money.toString(vista.liquidacion.fobTotal, 2),
                    gastosCosto: money.toString(vista.liquidacion.gastosCostoTotal, 2),
                    gastosNoCosto: money.toString(vista.liquidacion.gastosNoCostoTotal, 2),
                    costoTotal: money.toString(vista.liquidacion.costoTotal, 2),
                    noCosto: vista.liquidacion.noCosto.map((n) => ({
                      concepto: n.concepto,
                      importe: money.toString(n.importe, 2),
                    })),
                    cuadra: vista.cuadra,
                    diferencias: vista.diferencias,
                  }
                : null
            }
            puedeConfirmar={puedeAprobar && puedeEditar}
          />
        </div>
      </Contenido>
    </>
  );
}
