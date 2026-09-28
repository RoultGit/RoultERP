import Link from "next/link";
import type { Route } from "next";
import {
  ratiosFinancieros, listarFormatos, formatoPredeterminado, type Ratio,
} from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Ratios financieros · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const GRUPOS = [
  ["liquidez", "Liquidez", "Si alcanza para pagar lo que vence pronto."],
  ["solvencia", "Solvencia", "Cuánto del negocio es de los dueños y cuánto de los acreedores."],
  ["actividad", "Actividad", "Cuánto tarda el dinero en dar la vuelta."],
  ["rentabilidad", "Rentabilidad", "Cuánto queda de lo que se vende y de lo que se invierte."],
] as const;

/** Un ratio con su valor, su unidad y, si no se pudo, el porqué. */
function Fila({ ratio }: { ratio: Ratio }) {
  return (
    <tr>
      <td className="max-w-[220px]">{ratio.nombre}</td>
      <td className="text-right font-medium">
        {ratio.valor === null ? (
          <span style={{ color: "var(--texto-suave)" }}>no calculable</span>
        ) : ratio.unidad === "moneda" ? (
          <Importe valor={ratio.valor} />
        ) : (
          <span className="cifra">
            {ratio.valor}
            {ratio.unidad === "porcentaje" && " %"}
            {ratio.unidad === "veces" && " ×"}
            {ratio.unidad === "dias" && " d"}
          </span>
        )}
      </td>
      <td className="text-sm" style={{ color: "var(--texto-suave)" }}>
        {ratio.falta ?? ratio.explicacion}
      </td>
    </tr>
  );
}

export default async function Ratios({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; situacion?: string; resultados?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const datos = await conEmpresa(async (db) => {
    const formatos = await listarFormatos(db);
    const situacionId = params.situacion ?? (await formatoPredeterminado(db, "situacion"));
    const resultadosId = params.resultados ?? (await formatoPredeterminado(db, "resultados"));
    if (!situacionId || !resultadosId) {
      return { formatos, situacionId, resultadosId, analisis: null };
    }
    return {
      formatos,
      situacionId,
      resultadosId,
      analisis: await ratiosFinancieros(db, { situacionId, resultadosId, periodo }),
    };
  }, "contabilidad:ver");

  const deSituacion = datos.formatos.filter((f) => f.tipo === "situacion");
  const deResultados = datos.formatos.filter((f) => f.tipo === "resultados");
  const a = datos.analisis;
  const sinCalcular = a?.ratios.filter((r) => r.valor === null).length ?? 0;

  return (
    <>
      <Encabezado
        titulo="Ratios financieros"
        descripcion="Se calculan sobre el formato, no sobre rangos de cuentas: qué parte del pasivo vence dentro del año lo decide el contador al armar la plantilla, y de ahí sale toda la liquidez."
        acciones={
          <>
            <Link href={"/contabilidad/formatos" as Route} className="boton boton-secundario">
              Formatos
            </Link>
            <Link
              href={`/contabilidad/estados?periodo=${periodo}` as Route}
              className="boton boton-secundario"
            >
              Estados financieros
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/ratios">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} />
          </div>
          <div className="min-w-[220px]">
            <label className="etiqueta" htmlFor="situacion">Formato de situación</label>
            <select id="situacion" name="situacion" className="campo" defaultValue={datos.situacionId ?? ""}>
              {deSituacion.map((f) => (
                <option key={f.id} value={f.id}>{f.codigo} — {f.nombre}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="etiqueta" htmlFor="resultados">Formato de resultados</label>
            <select id="resultados" name="resultados" className="campo" defaultValue={datos.resultadosId ?? ""}>
              {deResultados.map((f) => (
                <option key={f.id} value={f.id}>{f.codigo} — {f.nombre}</option>
              ))}
            </select>
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {!a ? (
          <Vacio
            titulo="No hay formatos de estados financieros"
            descripcion="Los ratios se leen de la plantilla. Restaure los formatos de partida para empezar."
            accion={
              <Link href={"/contabilidad/formatos" as Route} className="boton boton-primario">
                Ir a formatos
              </Link>
            }
          />
        ) : (
          <>
            {a.avisos.length > 0 && (
              <div
                className="tarjeta mb-5 p-4 text-sm"
                style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
              >
                <p className="font-medium" style={{ color: "var(--alerta)" }}>
                  Antes de sacar conclusiones
                </p>
                <ul className="mt-1.5 space-y-1" style={{ color: "var(--texto-suave)" }}>
                  {a.avisos.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-5 xl:grid-cols-2">
              {GRUPOS.map(([grupo, titulo, subtitulo]) => {
                const ratios = a.ratios.filter((r) => r.grupo === grupo);
                if (ratios.length === 0) return null;
                return (
                  <section key={grupo} className="tarjeta overflow-x-auto">
                    <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
                      <h2 className="text-sm font-semibold">{titulo}</h2>
                      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>{subtitulo}</p>
                    </div>
                    <table className="tabla">
                      <tbody>
                        {ratios.map((r) => (
                          <Fila key={r.codigo} ratio={r} />
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>

            <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
              {sinCalcular > 0
                ? `${sinCalcular} ${sinCalcular === 1 ? "ratio no se pudo calcular" : "ratios no se pudieron calcular"}: falta que el formato declare qué renglón es cada cosa. Un ratio estimado es peor que un hueco, porque nadie lo cuestiona.`
                : "Los de actividad usan saldos medios entre la apertura del ejercicio y el cierre del periodo: dividir un flujo del año entre el saldo de un solo día es una foto, no una película."}
            </p>
          </>
        )}
      </Contenido>
    </>
  );
}
