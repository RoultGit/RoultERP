import Link from "next/link";
import type { Route } from "next";
import {
  listarPresupuestos, cargarPresupuesto, ejecucionPresupuestal,
  listarCentrosCosto, listarCuentas, PresupuestoInvalido,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioPresupuesto, Estado, type PartidaEditable } from "./formulario";

export const metadata = { title: "Presupuesto · RoultERP" };
export const dynamic = "force-dynamic";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
] as const;

export default async function Presupuesto({
  searchParams,
}: {
  searchParams: Promise<{
    presupuesto?: string;
    nuevo?: string;
    hecho?: string;
    hasta?: string;
    editar?: string;
  }>;
}) {
  const params = await searchParams;
  const hastaMes = Math.min(Math.max(Number(params.hasta) || new Date().getUTCMonth() + 1, 1), 12);
  const puedeEditar = await tienePermiso("contabilidad:editar");

  const datos = await conEmpresa(async (db) => {
    const [lista, centros, cuentas] = await Promise.all([
      listarPresupuestos(db),
      listarCentrosCosto(db),
      listarCuentas(db, true),
    ]);
    if (!params.presupuesto) return { lista, centros, cuentas, detalle: null, ejecucion: null };

    const detalle = await cargarPresupuesto(db, params.presupuesto).catch((e) => {
      if (e instanceof PresupuestoInvalido) return null;
      throw e;
    });
    const ejecucion = detalle
      ? await ejecucionPresupuestal(db, params.presupuesto, { hastaMes })
      : null;
    return { lista, centros, cuentas, detalle, ejecucion };
  }, "contabilidad:ver");

  const anuncio: Record<string, string> = {
    guardado: "Presupuesto guardado.",
    aprobar: "Presupuesto aprobado. A partir de aquí es la vara de medir y no se edita.",
    reabrir: "Presupuesto reabierto: vuelve a ser borrador.",
    cerrar: "Presupuesto cerrado.",
  };

  const editando = params.editar === "1" || params.nuevo === "1";
  const e = datos.ejecucion;

  return (
    <>
      <Encabezado
        titulo="Presupuesto"
        descripcion="Lo que la empresa planea gastar e ingresar, por centro de costo y por mes, contra lo que de verdad ocurrió. No genera asientos: es la vara de medir."
        acciones={
          <>
            {puedeEditar && (
              <Link
                href={"/contabilidad/presupuesto?nuevo=1" as Route}
                className="boton boton-secundario"
              >
                Nuevo presupuesto
              </Link>
            )}
            <Link href={"/contabilidad/centros" as Route} className="boton boton-secundario">
              Resultados por centro
            </Link>
          </>
        }
      />
      <Contenido>
        {params.hecho && anuncio[params.hecho] && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {anuncio[params.hecho]}
          </p>
        )}

        <section className="bloque mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Presupuestos
          </h2>
          {datos.lista.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay presupuestos"
                descripcion="Un presupuesto convierte el resultado por obra en una herramienta: saber que una obra perdió dice poco; saber que perdió sobre un plan de ganar dice qué hacer."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th className="text-right">Ejercicio</th>
                  <th className="text-right">Partidas</th>
                  <th className="text-right">Total</th>
                  <th>Estado</th>
                  {puedeEditar && <th className="w-[220px]" />}
                </tr>
              </thead>
              <tbody>
                {datos.lista.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/contabilidad/presupuesto?presupuesto=${p.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {p.codigo}
                      </Link>
                    </td>
                    <td className="max-w-[280px] truncate">{p.nombre}</td>
                    <td className="cifra">{p.ejercicio}</td>
                    <td className="cifra">{p.partidas}</td>
                    <td><Importe valor={money.toString(money.dec(p.total), 2)} /></td>
                    <td><EstadoDoc estado={p.estado} /></td>
                    {puedeEditar && (
                      <td><Estado presupuestoId={p.id} estado={p.estado} /></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {e && !editando && (
          <>
            <form
              className="bloque mb-5 flex flex-wrap items-end gap-3 p-4"
              action="/contabilidad/presupuesto"
            >
              <input type="hidden" name="presupuesto" value={e.presupuesto.id} />
              <div>
                <label className="etiqueta" htmlFor="hasta">Medir hasta</label>
                <select id="hasta" name="hasta" className="campo" defaultValue={String(hastaMes)}>
                  {MESES.map((m, i) => (
                    <option key={m} value={String(i + 1)}>{m}</option>
                  ))}
                </select>
              </div>
              <button className="boton boton-primario">Ver</button>
              {puedeEditar && e.presupuesto.estado === "borrador" && (
                <Link
                  href={`/contabilidad/presupuesto?presupuesto=${e.presupuesto.id}&editar=1` as Route}
                  className="boton boton-secundario"
                >
                  Editar partidas
                </Link>
              )}

              <dl className="ml-auto flex gap-6 text-right">
                <div>
                  <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Presupuestado</dt>
                  <dd className="text-lg"><Importe valor={e.totales.presupuestado} /></dd>
                </div>
                <div>
                  <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Ejecutado</dt>
                  <dd className="text-lg"><Importe valor={e.totales.ejecutado} /></dd>
                </div>
                <div>
                  <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Desviación</dt>
                  <dd
                    className="text-lg font-medium"
                    style={Number(e.totales.desviacion) < 0 ? { color: "var(--peligro)" } : undefined}
                  >
                    <Importe valor={e.totales.desviacion} />
                  </dd>
                </div>
              </dl>
            </form>

            {e.sinPresupuestar.length > 0 && (
              <div className="aviso mb-5" role="alert">
                <p className="font-medium">
                  Hay {e.sinPresupuestar.length}{" "}
                  {e.sinPresupuestar.length === 1 ? "movimiento" : "movimientos"} por{" "}
                  <Importe valor={e.totalSinPresupuestar} /> que ninguna partida presupuestó.
                </p>
                <p className="mt-1 text-xs">
                  {e.sinPresupuestar
                    .slice(0, 10)
                    .map((m) => `${m.cuenta} · ${m.centro} (${m.ejecutado})`)
                    .join(" — ")}
                  {e.sinPresupuestar.length > 10 && " …"}
                </p>
              </div>
            )}

            <section className="bloque overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                {e.presupuesto.nombre} · ejecución hasta {MESES[e.hastaMes - 1]}
              </h2>
              {e.lineas.length === 0 ? (
                <div className="p-4">
                  <Vacio
                    titulo="Sin partidas hasta ese mes"
                    descripcion="Elija un mes posterior o añada partidas al presupuesto."
                  />
                </div>
              ) : (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Centro de costo</th>
                      <th>Cuenta</th>
                      <th className="text-right">Presupuestado</th>
                      <th className="text-right">Ejecutado</th>
                      <th className="text-right">Desviación</th>
                      <th className="text-right">Avance</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {e.lineas.map((l) => (
                      <tr key={`${l.centroCostoId ?? "sin"}-${l.cuenta}`}>
                        <td className="max-w-[220px] truncate">{l.centro}</td>
                        <td className="cifra" style={{ textAlign: "left" }}>{l.cuenta}</td>
                        <td><Importe valor={l.presupuestado} /></td>
                        <td><Importe valor={l.ejecutado} /></td>
                        <td
                          className="font-medium"
                          style={l.excedido ? { color: "var(--peligro)" } : undefined}
                        >
                          <Importe valor={l.desviacion} />
                        </td>
                        <td className="cifra">{l.avance} %</td>
                        <td>{l.excedido && <Insignia tono="peligro">excedido</Insignia>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "var(--superficie-2)" }}>
                      <td colSpan={2} className="px-3 py-2 text-xs font-semibold uppercase">Total</td>
                      <td><Importe valor={e.totales.presupuestado} /></td>
                      <td><Importe valor={e.totales.ejecutado} /></td>
                      <td className="font-semibold"><Importe valor={e.totales.desviacion} /></td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
              <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
                Lo ejecutado sale del mayor. Ingresos y gastos se miden los dos en positivo, para
                que «avance» signifique lo mismo en ambos casos.
              </p>
            </section>
          </>
        )}

        {puedeEditar && editando && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">
              {datos.detalle ? `Editar ${datos.detalle.cabecera.codigo}` : "Nuevo presupuesto"}
            </h2>
            <FormularioPresupuesto
              centrosCosto={datos.centros
                .filter((c) => c.activo)
                .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
              cuentas={datos.cuentas.map((c) => ({
                id: c.cuenta,
                etiqueta: `${c.cuenta} — ${c.descripcion}`,
              }))}
              inicial={
                datos.detalle
                  ? {
                      codigo: datos.detalle.cabecera.codigo,
                      nombre: datos.detalle.cabecera.nombre,
                      ejercicio: datos.detalle.cabecera.ejercicio,
                      observaciones: datos.detalle.cabecera.observaciones ?? "",
                      partidas: datos.detalle.partidas.map<PartidaEditable>((p) => ({
                        centroCostoId: p.centroCostoId ?? "",
                        cuenta: p.cuenta,
                        mes: String(p.mes),
                        importe: money.toString(money.dec(p.importe), 2),
                      })),
                    }
                  : null
              }
            />
          </section>
        )}
      </Contenido>
    </>
  );
}
