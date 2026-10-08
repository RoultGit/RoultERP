import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { listarPeriodos } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { AccionPeriodo, CierreEjercicio } from "./formularios";

export const metadata = { title: "Cierre de periodo · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Periodos() {
  const [datos, puedeAprobar] = await Promise.all([
    conEmpresa(async (db) => {
      // Los periodos con movimiento y los que ya tienen estado registrado no
      // son el mismo conjunto: un mes puede tener asientos y nunca haberse
      // cerrado, y uno cerrado puede no tener ninguno.
      const movimiento = (await db.execute(sql`
        SELECT a.periodo,
               -- DISTINCT porque el JOIN con las líneas repite la cabecera una
               -- vez por línea: sin él, un asiento de ocho líneas cuenta ocho.
               count(DISTINCT a.id) FILTER (WHERE a.estado = 'borrador')::int AS borradores,
               count(DISTINCT a.id) FILTER (WHERE a.estado <> 'borrador')::int AS contabilizados,
               coalesce(sum(l.debe_funcional) FILTER (WHERE a.estado <> 'borrador'), 0)::text AS importe
        FROM asientos a
        LEFT JOIN asiento_lineas l ON l.asiento_id = a.id
        GROUP BY a.periodo`)) as unknown as {
        periodo: string;
        borradores: number;
        contabilizados: number;
        importe: string;
      }[];
      return { movimiento: [...movimiento], estados: await listarPeriodos(db) };
    }, "contabilidad:ver"),
    tienePermiso("contabilidad:aprobar"),
  ]);

  const porPeriodo = new Map(datos.movimiento.map((m) => [m.periodo, m]));
  const estadoDe = new Map(datos.estados.map((p) => [p.periodo, p.estado]));

  // El año sobre el que se ofrece cerrar es el del último periodo con
  // movimiento; es el único que alguien va a querer cerrar.
  const ejercicioSugerido =
    [...porPeriodo.keys()].sort().at(-1)?.slice(0, 4) ?? String(new Date().getUTCFullYear());

  const filas = [...new Set([...porPeriodo.keys(), ...estadoDe.keys()])]
    .sort()
    .reverse()
    .map((periodo) => ({
      periodo,
      borradores: porPeriodo.get(periodo)?.borradores ?? 0,
      contabilizados: porPeriodo.get(periodo)?.contabilizados ?? 0,
      importe: porPeriodo.get(periodo)?.importe ?? "0",
      cerrado: estadoDe.get(periodo) === "cerrado",
    }));

  return (
    <>
      <Encabezado
        titulo="Cierre de periodo"
        descripcion="Un periodo cerrado no admite asientos nuevos. Es lo que impide tocar un mes ya declarado."
        acciones={
          <Link href={"/contabilidad" as Route} className="boton boton-secundario">
            Volver al balance
          </Link>
        }
      />
      <Contenido>
        {puedeAprobar && (
          <div className="mb-5">
            <CierreEjercicio ejercicio={ejercicioSugerido} />
          </div>
        )}

        {filas.length === 0 ? (
          <Vacio titulo="Todavía no hay periodos" descripcion="Aparecerán al registrar el primer asiento." />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th className="text-right">Asientos</th>
                  <th className="text-right">Borradores</th>
                  <th className="text-right">Importe S/</th>
                  <th>Estado</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.periodo}>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      <Link href={`/contabilidad?periodo=${f.periodo}` as Route} className="underline">
                        {f.periodo.slice(0, 4)}-{f.periodo.slice(4)}
                      </Link>
                    </td>
                    <td className="cifra text-right">{f.contabilizados}</td>
                    <td className="cifra text-right">
                      {f.borradores > 0 ? (
                        <Insignia tono="alerta">{f.borradores}</Insignia>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td><Importe valor={f.importe} /></td>
                    <td>
                      {f.cerrado ? (
                        <Insignia tono="neutro">cerrado</Insignia>
                      ) : (
                        <Insignia tono="exito">abierto</Insignia>
                      )}
                    </td>
                    <td className="text-right">
                      <AccionPeriodo
                        periodo={f.periodo}
                        cerrado={f.cerrado}
                        puedeAprobar={puedeAprobar}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
