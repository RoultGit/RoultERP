import Link from "next/link";
import type { Route } from "next";
import {
  listarReglas, previsualizarDestino, estadoResultadosPorFuncion,
  listarCentrosCosto, DestinoInvalido,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioReglas, Contabilizar, type ReglaEditable } from "./formulario";

export const metadata = { title: "Asiento de destino · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Destino({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; hecho?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();
  const [puedeEditar, puedeCrear] = await Promise.all([
    tienePermiso("contabilidad:editar"),
    tienePermiso("contabilidad:crear"),
  ]);

  const datos = await conEmpresa(async (db) => {
    const [reglas, centros] = await Promise.all([listarReglas(db), listarCentrosCosto(db)]);
    const vista = await previsualizarDestino(db, periodo).catch((e) => {
      if (e instanceof DestinoInvalido) return null;
      throw e;
    });
    const funcion = await estadoResultadosPorFuncion(db, periodo);
    return { reglas, centros, vista, funcion };
  }, "contabilidad:ver");

  const { vista, funcion } = datos;

  return (
    <>
      <Encabezado
        titulo="Asiento de destino"
        descripcion="El PCGE registra los gastos por naturaleza; la vista funcional —cuánto costó vender, cuánto administrar— vive en la clase 9. Este asiento es el puente."
        acciones={
          <Link href={"/contabilidad/estados" as Route} className="boton boton-secundario">
            Estados financieros
          </Link>
        }
      />
      <Contenido>
        {params.hecho === "reglas" && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            Reglas guardadas.
          </p>
        )}
        {params.hecho?.startsWith("destinado-") && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            Destino contabilizado por {params.hecho.slice("destinado-".length)}. El resultado del
            ejercicio no cambia: la clase 9 y la 79 se anulan entre sí.
          </p>
        )}
        {params.hecho === "nada" && (
          <p className="mb-4 text-sm" role="status" style={{ color: "var(--texto-suave)" }}>
            No había nada pendiente de destinar en {periodo}.
          </p>
        )}

        <form className="bloque mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/destino">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} placeholder="202609" />
          </div>
          <button className="boton boton-secundario">Ver</button>

          {vista && (
            <dl className="ml-auto flex gap-6 text-right">
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Ya destinado</dt>
                <dd className="text-lg"><Importe valor={vista.yaDestinado} /></dd>
              </div>
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Pendiente</dt>
                <dd className="text-lg font-medium"><Importe valor={vista.pendiente} /></dd>
              </div>
            </dl>
          )}
        </form>

        {vista && vista.sinDestino.length > 0 && (
          <div className="aviso mb-5" role="alert">
            <p className="font-medium">
              {vista.sinDestino.length}{" "}
              {vista.sinDestino.length === 1 ? "gasto no tiene regla" : "gastos no tienen regla"} de
              destino, por <Importe valor={vista.totalSinDestino} />.
            </p>
            <p className="mt-1 text-xs">
              {vista.sinDestino
                .slice(0, 10)
                .map((g) => `${g.cuenta} · ${g.centro} (${g.importe})`)
                .join(" — ")}
              {vista.sinDestino.length > 10 && " …"}
            </p>
            <p className="mt-1 text-xs">
              No se reparten por una regla inventada: añada una regla abajo o quedarán fuera del
              estado por función.
            </p>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bloque overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
              <h2 className="text-sm font-semibold">Reparto del periodo {periodo}</h2>
              {puedeCrear && vista && Number(vista.pendiente) > 0 && (
                <Contabilizar periodo={periodo} />
              )}
            </div>
            {!vista || vista.porFuncion.length === 0 ? (
              <div className="p-4">
                <Vacio
                  titulo="Nada que destinar"
                  descripcion="No hay gastos de la clase 6 en el periodo, o ninguno tiene regla."
                />
              </div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Función</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.porFuncion.map((f) => (
                    <tr key={f.cuenta}>
                      <td className="cifra" style={{ textAlign: "left" }}>{f.cuenta}</td>
                      <td>{f.nombre}</td>
                      <td><Importe valor={f.importe} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bloque overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
              <h2 className="text-sm font-semibold">Estado de resultados por función</h2>
              {funcion.completo ? (
                <Insignia tono="exito">completo</Insignia>
              ) : (
                <Insignia tono="alerta">
                  faltan {funcion.sinDestinar} por destinar
                </Insignia>
              )}
            </div>
            <table className="tabla">
              <tbody>
                {funcion.lineas.map((l, i) => (
                  <tr
                    key={`${l.concepto}-${i}`}
                    style={l.esTotal ? { background: "var(--superficie-2)" } : undefined}
                  >
                    <td style={{ paddingLeft: `${0.75 + l.nivel * 1}rem` }}>
                      {l.esTotal ? <strong>{l.concepto}</strong> : l.concepto}
                    </td>
                    <td className="cifra" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                      {l.cuentas || "—"}
                    </td>
                    <td>
                      {l.esTotal ? (
                        <strong><Importe valor={l.importe} /></strong>
                      ) : (
                        <Importe valor={l.importe} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
              Sale de la clase 9. Mientras quede gasto sin destinar, el informe está incompleto:
              presentarlo con gastos de menos es peor que no presentarlo.
            </p>
          </section>
        </div>

        {puedeEditar && (
          <section className="mt-5">
            <h2 className="mb-3 text-sm font-semibold">Reglas de destino</h2>
            <FormularioReglas
              centrosCosto={datos.centros
                .filter((c) => c.activo)
                .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
              iniciales={datos.reglas.map<ReglaEditable>((r) => ({
                cuenta: r.cuenta ?? "",
                centroCostoId: r.centroCostoId ?? "",
                cuentaDestino: r.cuentaDestino,
              }))}
            />
          </section>
        )}
      </Contenido>
    </>
  );
}
