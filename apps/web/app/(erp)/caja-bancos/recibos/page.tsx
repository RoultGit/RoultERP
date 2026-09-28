import Link from "next/link";
import type { Route } from "next";
import {
  listarRecibos, cuentasParaOperar, listarCuentas, listarTerceros, listarCentrosCosto,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioRecibo } from "./formulario";

export const metadata = { title: "Recibos de caja · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Recibos({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; tipo?: string }>;
}) {
  const { hecho, tipo } = await searchParams;
  const filtro = tipo === "ingreso" || tipo === "egreso" ? tipo : undefined;
  const puedeCrear = await tienePermiso("caja_bancos:crear");

  const datos = await conEmpresa(async (db) => {
    const [recibos, cuentas, plan, terceros, centros] = await Promise.all([
      listarRecibos(db, filtro ? { tipo: filtro } : undefined),
      cuentasParaOperar(db),
      listarCuentas(db, true),
      listarTerceros(db),
      listarCentrosCosto(db),
    ]);
    return { recibos, cuentas, plan, terceros, centros };
  }, "caja_bancos:ver");

  return (
    <>
      <Encabezado
        titulo="Recibos de caja"
        descripcion="El papel que se firma por cada ingreso y cada egreso que no viene de una cobranza o un pago."
        acciones={
          <Link href={"/caja-bancos" as Route} className="boton boton-secundario">
            Cuentas
          </Link>
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

        {puedeCrear && (
          <div className="mb-5">
            <FormularioRecibo
              cuentas={datos.cuentas.map((c) => ({
                id: c.id,
                etiqueta: `${c.nombre} · ${c.moneda}`,
              }))}
              contrapartidas={datos.plan
                // Cuentas de resultado y de cobro/pago diverso: lo que puede
                // haber al otro lado de un recibo de caja.
                .filter((c) => /^(1[46]|4[15]|6|7)/.test(c.cuenta))
                .map((c) => ({ id: c.cuenta, etiqueta: `${c.cuenta} — ${c.descripcion}` }))}
              terceros={datos.terceros.map((t) => ({
                id: t.id,
                etiqueta: `${t.razonSocial} · ${t.numeroDocumento}`,
              }))}
              centrosCosto={datos.centros
                .filter((c) => c.activo)
                .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
            />
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {[
            ["", "Todos"],
            ["ingreso", "Ingresos"],
            ["egreso", "Egresos"],
          ].map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/caja-bancos/recibos?tipo=${valor}` : "/caja-bancos/recibos") as Route}
              className="rounded border px-3 py-1 text-sm"
              style={{
                borderColor: (filtro ?? "") === valor ? "var(--acento)" : "var(--borde)",
                background: (filtro ?? "") === valor ? "var(--acento-suave)" : "var(--superficie)",
                color: (filtro ?? "") === valor ? "var(--acento)" : "var(--texto-suave)",
              }}
            >
              {texto}
            </Link>
          ))}
        </div>

        <section className="tarjeta overflow-x-auto">
          {datos.recibos.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay recibos"
                descripcion="Aquí queda cada ingreso y cada egreso de caja con su número y su firmante."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Cuenta</th>
                  <th>A nombre de</th>
                  <th>Concepto</th>
                  <th className="text-right">Importe</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.recibos.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/caja-bancos/recibos/${r.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {r.numero}
                      </Link>
                    </td>
                    <td>
                      <Insignia tono={r.tipo === "ingreso" ? "exito" : "neutro"}>
                        {r.tipo}
                      </Insignia>
                    </td>
                    <td className="cifra">{r.fecha}</td>
                    <td className="max-w-[160px] truncate">{r.cuenta}</td>
                    <td className="max-w-[200px] truncate">{r.tercero ?? r.aNombreDe ?? "—"}</td>
                    <td className="max-w-[240px] truncate">{r.concepto}</td>
                    <td><Importe valor={r.importe} moneda={r.moneda} /></td>
                    <td><EstadoDoc estado={r.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </Contenido>
    </>
  );
}
