import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import {
  cargarPoliza, previsualizarPoliza, importacionesDisponibles, listarTerceros,
  PolizaInvalida,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import {
  Asociar, Desasociar, AgregarGasto, QuitarGasto, Liquidar, AnularPoliza,
} from "./panel";

export const metadata = { title: "Póliza · RoultERP" };
export const dynamic = "force-dynamic";

const BASE: Record<string, string> = {
  fob: "valor FOB",
  cantidad: "cantidad",
  peso: "peso",
  volumen: "volumen",
  directo: "directo",
};

export default async function Poliza({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { id } = await params;
  const { hecho } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const poliza = await cargarPoliza(db, id).catch((e) => {
      if (e instanceof PolizaInvalida) return null;
      throw e;
    });
    if (!poliza) return null;

    /*
     * El reparto puede fallar por los datos —un gasto por peso y ningún
     * embarque que lo declare—, y eso no debe dejar la pantalla en blanco: es
     * justo lo que el usuario tiene que ver para arreglarlo.
     */
    const vista = await previsualizarPoliza(db, id).catch((e) =>
      e instanceof PolizaInvalida ? { error: e.message } : Promise.reject(e),
    );
    const [disponibles, proveedores] = await Promise.all([
      importacionesDisponibles(db),
      listarTerceros(db, { rol: "proveedor" }),
    ]);
    return { ...poliza, vista, disponibles, proveedores };
  }, "importaciones:ver");

  if (!datos) notFound();

  const { cabecera, embarques, gastos, vista } = datos;
  const [puedeCrear, puedeAprobar] = await Promise.all([
    tienePermiso("importaciones:crear"),
    tienePermiso("importaciones:aprobar"),
  ]);
  const abierta = cabecera.estado === "abierta";
  const error = "error" in vista ? vista.error : null;
  const reparto = "error" in vista ? null : vista;

  const pendientes = embarques.filter((e) => e.estado !== "liquidada" && e.estado !== "anulada");
  const sinAlmacen = pendientes.find((e) => !e.almacenId);
  const motivo = !abierta
    ? `La póliza está ${cabecera.estado}.`
    : pendientes.length === 0
      ? "Agrupe al menos un embarque sin liquidar."
      : sinAlmacen
        ? `El embarque ${sinAlmacen.numero} no tiene almacén de ingreso.`
        : error
          ? "Corrija el reparto de los gastos antes de liquidar."
          : null;

  return (
    <>
      <Encabezado
        titulo={`Póliza ${cabecera.numero}`}
        descripcion={
          cabecera.agente
            ? `${cabecera.regimen ?? "Importación"} · agente ${cabecera.agente}`
            : (cabecera.regimen ?? "Importación")
        }
        acciones={
          <>
            {puedeCrear && abierta && <AnularPoliza polizaId={cabecera.id} />}
            <Link href={"/importaciones/polizas" as Route} className="boton boton-secundario">
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
            {hecho === "liquidada"
              ? "Póliza liquidada. Cada embarque ingresó al almacén a su costo real, con su asiento y su cuenta por pagar."
              : hecho}
          </p>
        )}
        {error && (
          <p className="aviso mb-4" role="alert">
            {error}
          </p>
        )}

        <section className="bloque mb-5 p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="etiqueta">Estado</dt>
              <dd><EstadoDoc estado={cabecera.estado} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Fecha</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fecha}</dd>
            </div>
            <div>
              <dt className="etiqueta">Numeración</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>
                {cabecera.fechaNumeracion ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="etiqueta">Aduana</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.aduana ?? "—"}</dd>
            </div>
            <div>
              <dt className="etiqueta">Tipo de cambio</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>
                {money.toString(money.dec(cabecera.tipoCambio), 3)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
            El tipo de cambio de la DUA manda sobre el de cada factura del exterior: es el que la
            aduana fija para la fecha de numeración, y con él se valoriza toda la nacionalización.
          </p>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <section className="bloque overflow-hidden">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Embarques amparados
              </h2>
              {embarques.length === 0 ? (
                <div className="p-4">
                  <Vacio
                    titulo="La póliza está vacía"
                    descripcion="Agrupe los embarques que llegaron con esta DUA."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Embarque</th>
                        <th>Proveedor</th>
                        <th>Almacén</th>
                        <th className="text-right">Gastos de la DUA</th>
                        <th>Estado</th>
                        {puedeCrear && abierta && <th className="w-20" />}
                      </tr>
                    </thead>
                    <tbody>
                      {embarques.map((e) => {
                        const parte = reparto?.embarques.find((x) => x.id === e.id);
                        return (
                          <tr key={e.id}>
                            <td>
                              <Link
                                href={`/importaciones/${e.id}` as Route}
                                className="cifra font-medium underline"
                                style={{ textAlign: "left" }}
                              >
                                {e.numero}
                              </Link>
                            </td>
                            <td className="max-w-[200px] truncate">{e.proveedor}</td>
                            <td className="max-w-[140px] truncate">
                              {e.almacen ?? (
                                <span style={{ color: "var(--peligro)" }}>sin almacén</span>
                              )}
                            </td>
                            <td>
                              {parte ? <Importe valor={parte.gastosPoliza} /> : "—"}
                            </td>
                            <td><EstadoDoc estado={e.estado} /></td>
                            {puedeCrear && abierta && (
                              <td>
                                {e.estado !== "liquidada" && (
                                  <Desasociar polizaId={cabecera.id} importacionId={e.id} />
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {puedeCrear && abierta && (
                <div className="border-t" style={{ borderColor: "var(--borde)" }}>
                  <Asociar
                    polizaId={cabecera.id}
                    disponibles={datos.disponibles.map((d) => ({
                      id: d.id,
                      etiqueta: `${d.numero} · ${d.proveedor} · ${d.fechaOrden}`,
                    }))}
                  />
                </div>
              )}
            </section>

            <section className="bloque overflow-hidden">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Gastos de la DUA
              </h2>
              {gastos.length === 0 ? (
                <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
                  Todavía no hay gastos. Aquí van los que amparan a todos los embarques: el
                  agenciamiento, el almacenaje, el flete interno, el IGV de importación.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th className="text-right">Importe</th>
                        <th>Mon.</th>
                        <th className="text-right">T.C.</th>
                        <th>Se reparte por</th>
                        <th>Destino</th>
                        {puedeCrear && abierta && <th className="w-10" />}
                      </tr>
                    </thead>
                    <tbody>
                      {gastos.map((g) => (
                        <tr key={g.id}>
                          <td>{g.concepto}</td>
                          <td><Importe valor={g.importe} moneda={g.moneda} /></td>
                          <td>{g.moneda}</td>
                          <td className="cifra">{money.toString(money.dec(g.tipoCambio), 3)}</td>
                          <td style={{ color: "var(--texto-suave)" }}>
                            {BASE[g.baseProrrateo] ?? g.baseProrrateo}
                          </td>
                          <td>
                            <Insignia tono={g.afectaCosto ? "neutro" : "alerta"}>
                              {g.afectaCosto ? "costo" : "crédito fiscal"}
                            </Insignia>
                          </td>
                          {puedeCrear && abierta && (
                            <td><QuitarGasto polizaId={cabecera.id} gastoId={g.id} /></td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {puedeCrear && abierta && (
                <div className="border-t" style={{ borderColor: "var(--borde)" }}>
                  <AgregarGasto
                    polizaId={cabecera.id}
                    proveedores={datos.proveedores.map((p) => ({
                      id: p.id,
                      etiqueta: `${p.razonSocial} · ${p.numeroDocumento}`,
                    }))}
                  />
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <section className="bloque">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Reparto
              </h2>
              {!reparto || reparto.embarques.length === 0 ? (
                <p className="px-4 py-5 text-sm" style={{ color: "var(--texto-suave)" }}>
                  Agrupe embarques y cargue los gastos para ver cuánto le toca a cada uno.
                </p>
              ) : (
                <>
                  <dl className="divide-y text-sm" style={{ borderColor: "var(--borde)" }}>
                    <div className="flex items-center justify-between px-4 py-2">
                      <dt style={{ color: "var(--texto-suave)" }}>Gastos de la DUA</dt>
                      <dd className="font-medium"><Importe valor={reparto.gastoTotal} /></dd>
                    </div>
                    {reparto.embarques.map((e) => (
                      <div key={e.id} className="px-4 py-2">
                        <div className="flex items-center justify-between">
                          <dt className="cifra" style={{ textAlign: "left" }}>{e.numero}</dt>
                          <dd><Importe valor={e.gastosPoliza} /></dd>
                        </div>
                        {e.partes.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                            {e.partes.map((p) => (
                              <li key={`${e.id}-${p.concepto}`} className="flex justify-between gap-2">
                                <span className="truncate">
                                  {p.concepto}
                                  <span className="ml-1">· {BASE[p.base] ?? p.base}</span>
                                </span>
                                <span className="cifra">{p.importe}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </dl>
                  {!reparto.cuadra && (
                    <p className="aviso m-3" role="alert">
                      El reparto no suma lo gastado. No se puede liquidar así.
                    </p>
                  )}
                </>
              )}
            </section>

            {puedeAprobar && (
              <section className="bloque">
                <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                  Liquidación
                </h2>
                <Liquidar
                  polizaId={cabecera.id}
                  puedeLiquidar={motivo === null && (reparto?.cuadra ?? false)}
                  motivo={motivo}
                />
              </section>
            )}
          </aside>
        </div>
      </Contenido>
    </>
  );
}
