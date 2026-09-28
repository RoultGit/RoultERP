import Link from "next/link";
import type { Route } from "next";
import {
  situacionFinanciera, listarFormatos, generarEstado, formatoPredeterminado,
  type RenglonEstado, type EstadoGenerado,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Estados financieros · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function Estado({ titulo, renglones }: { titulo: string; renglones: RenglonEstado[] }) {
  if (renglones.length === 0) return null;
  return (
    <section className="tarjeta overflow-x-auto">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
        {titulo}
      </h2>
      <table className="tabla">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Cuentas</th>
            <th className="text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {renglones.map((r, i) => {
            const esTotal = r.clase === "total";
            const esTitulo = r.clase === "titulo";
            return (
              <tr
                key={`${r.concepto}-${i}`}
                style={esTotal ? { background: "var(--superficie-2)" } : undefined}
              >
                <td style={{ paddingLeft: `${0.75 + r.nivel * 1}rem` }}>
                  {esTotal || esTitulo ? <strong>{r.concepto}</strong> : r.concepto}
                </td>
                <td className="cifra" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                  {r.cuentas || "—"}
                </td>
                <td>
                  {esTitulo ? (
                    <span style={{ color: "var(--texto-suave)" }}>—</span>
                  ) : esTotal ? (
                    <strong><Importe valor={r.importe} /></strong>
                  ) : (
                    <Importe valor={r.importe} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Cuentas con saldo que el formato no recoge.
 *
 * Es el aviso que impide que una plantilla haga desaparecer dinero de un
 * balance sin que nadie lo note. Una cuenta nueva del plan aparece aquí hasta
 * que alguien decide en qué renglón va.
 */
function SinClasificar({ estado }: { estado: EstadoGenerado }) {
  if (estado.sinClasificar.length === 0) return null;
  return (
    <div className="aviso mb-5" role="alert">
      <p className="font-medium">
        El formato «{estado.formato.nombre}» deja {estado.sinClasificar.length}{" "}
        {estado.sinClasificar.length === 1 ? "cuenta" : "cuentas"} con saldo fuera del informe.
      </p>
      <p className="mt-1 text-xs">
        {estado.sinClasificar
          .slice(0, 12)
          .map((c) => `${c.cuenta} (${c.saldo})`)
          .join(" · ")}
        {estado.sinClasificar.length > 12 && " …"}
      </p>
      <p className="mt-1 text-xs">
        Añádalas a un renglón en{" "}
        <Link href={"/contabilidad/formatos" as Route} className="underline">
          formatos de estados financieros
        </Link>
        .
      </p>
    </div>
  );
}

export default async function EstadosFinancieros({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; situacion?: string; resultados?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const datos = await conEmpresa(async (db) => {
    const formatos = await listarFormatos(db);
    const idSituacion =
      params.situacion ?? (await formatoPredeterminado(db, "situacion")) ?? null;
    const idResultados =
      params.resultados ?? (await formatoPredeterminado(db, "resultados")) ?? null;

    return {
      formatos,
      // El cuadre se comprueba aparte del formato: es la verificación de que el
      // mayor está bien, no de que la plantilla esté bien escrita.
      balance: await situacionFinanciera(db, periodo),
      situacion: idSituacion ? await generarEstado(db, idSituacion, periodo) : null,
      resultados: idResultados ? await generarEstado(db, idResultados, periodo) : null,
    };
  }, "contabilidad:ver");

  const deSituacion = datos.formatos.filter((f) => f.tipo === "situacion");
  const deResultados = datos.formatos.filter((f) => f.tipo === "resultados");

  const activo = datos.situacion?.renglones.filter((r) => r.columna === "activo") ?? [];
  const pasivo = datos.situacion?.renglones.filter((r) => r.columna === "pasivo") ?? [];
  const sinColumna = datos.situacion?.renglones.filter((r) => r.columna === null) ?? [];

  return (
    <>
      <Encabezado
        titulo="Estados financieros"
        descripcion={`Acumulado hasta el periodo ${periodo}, sobre asientos contabilizados.`}
        acciones={
          <>
            <Imprimir />
            <Link href={"/contabilidad/formatos" as Route} className="boton boton-secundario">
              Formatos
            </Link>
            <Link href={`/contabilidad?periodo=${periodo}` as Route} className="boton boton-secundario">
              Volver al balance
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="tarjeta filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/estados">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} />
          </div>
          <div className="min-w-[240px]">
            <label className="etiqueta" htmlFor="situacion">Formato de situación</label>
            <select
              id="situacion" name="situacion" className="campo"
              defaultValue={datos.situacion?.formato.id ?? ""}
            >
              {deSituacion.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.codigo} — {f.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[240px]">
            <label className="etiqueta" htmlFor="resultados">Formato de resultados</label>
            <select
              id="resultados" name="resultados" className="campo"
              defaultValue={datos.resultados?.formato.id ?? ""}
            >
              {deResultados.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.codigo} — {f.nombre}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="boton boton-primario">Ver</button>

          <span className="ml-auto">
            {/* Si el activo no iguala al pasivo más patrimonio, el informe no
                sirve para nada y hay que decirlo antes de que alguien lo use.
                Esto mira el mayor, no la plantilla. */}
            {datos.balance.cuadra ? (
              <Insignia tono="exito">Activo = Pasivo + Patrimonio</Insignia>
            ) : (
              <Insignia tono="peligro">
                Descuadre de {money.toString(datos.balance.descuadre, 2)}
              </Insignia>
            )}
          </span>
        </form>

        {datos.situacion && <SinClasificar estado={datos.situacion} />}

        {datos.situacion && (
          <div className="grid gap-5 xl:grid-cols-2">
            <Estado titulo={`${datos.situacion.formato.nombre} · Activo`} renglones={activo} />
            <Estado
              titulo={`${datos.situacion.formato.nombre} · Pasivo y patrimonio`}
              renglones={pasivo}
            />
            {sinColumna.length > 0 && (
              <div className="xl:col-span-2">
                <Estado titulo={datos.situacion.formato.nombre} renglones={sinColumna} />
              </div>
            )}
          </div>
        )}

        {datos.resultados && (
          <div className="mt-5">
            <Estado
              titulo={datos.resultados.formato.nombre}
              renglones={datos.resultados.renglones}
            />
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          El formato decide cómo se presenta; los saldos salen de los asientos. No se puede
          configurar un estado que diga algo distinto de lo que dice el mayor.
        </p>
      </Contenido>
    </>
  );
}
