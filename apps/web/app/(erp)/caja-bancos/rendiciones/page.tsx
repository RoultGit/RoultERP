import Link from "next/link";
import type { Route } from "next";
import {
  listarEntregas, cuentasParaOperar, listarTerceros, listarCentrosCosto,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";
import { FormularioEntrega } from "./formulario";

export const metadata = { title: "Entregas a rendir · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todas"],
  ["pendiente", "Sin rendir"],
  ["parcial", "Parciales"],
  ["rendida", "Rendidas"],
  ["anulada", "Anuladas"],
] as const;

export default async function Rendiciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const puedeCrear = await tienePermiso("caja_bancos:crear");

  const datos = await conEmpresa(async (db) => {
    const [entregas, cuentas, terceros, centros] = await Promise.all([
      listarEntregas(db, filtro || undefined),
      cuentasParaOperar(db),
      listarTerceros(db),
      listarCentrosCosto(db),
    ]);
    return { entregas, cuentas, terceros, centros };
  }, "caja_bancos:ver");

  const porRendir = datos.entregas
    .filter((e) => e.estado === "pendiente" || e.estado === "parcial")
    .reduce(
      (a, e) =>
        money.add(
          a,
          money.sub(money.sub(money.dec(e.importe), money.dec(e.rendido)), money.dec(e.devuelto)),
        ),
      money.ZERO,
    );

  return (
    <>
      <Encabezado
        titulo="Entregas a rendir"
        descripcion="Dinero que salió de caja a nombre de alguien y todavía no es gasto. Vive en la cuenta 14 hasta que se justifica con documentos."
        acciones={
          <Link href={"/caja-bancos" as Route} className="boton boton-secundario">
            Cuentas
          </Link>
        }
      />
      <Contenido>
        {!money.isZero(porRendir) && (
          <section className="tarjeta mb-5 p-4">
            <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
              Pendiente de rendir
            </div>
            <div className="text-lg font-medium">
              <Importe valor={money.toString(porRendir, 2)} />
            </div>
          </section>
        )}

        {puedeCrear && (
          <div className="mb-5">
            <FormularioEntrega
              cuentas={datos.cuentas.map((c) => ({
                id: c.id,
                etiqueta: `${c.nombre} · ${c.moneda}`,
              }))}
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

        <div className="flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/caja-bancos/rendiciones?estado=${valor}` : "/caja-bancos/rendiciones") as Route}
              className="rounded border px-3 py-1 text-sm"
              style={{
                borderColor: filtro === valor ? "var(--acento)" : "var(--borde)",
                background: filtro === valor ? "var(--acento-suave)" : "var(--superficie)",
                color: filtro === valor ? "var(--acento)" : "var(--texto-suave)",
              }}
            >
              {texto}
            </Link>
          ))}
        </div>

        <section className="tarjeta overflow-x-auto">
          {datos.entregas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay entregas a rendir"
                descripcion="Un adelanto para un viaje o una compra menor se registra aquí, no como gasto: el gasto aparece cuando se rinde."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Responsable</th>
                  <th>Motivo</th>
                  <th className="text-right">Entregado</th>
                  <th className="text-right">Rendido</th>
                  <th className="text-right">Por rendir</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.entregas.map((e) => {
                  const saldo = money.sub(
                    money.sub(money.dec(e.importe), money.dec(e.rendido)),
                    money.dec(e.devuelto),
                  );
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link
                          href={`/caja-bancos/rendiciones/${e.id}` as Route}
                          className="cifra font-medium underline"
                          style={{ textAlign: "left" }}
                        >
                          {e.numero}
                        </Link>
                      </td>
                      <td className="cifra">{e.fecha}</td>
                      <td className="max-w-[180px] truncate">{e.responsable}</td>
                      <td className="max-w-[240px] truncate">{e.motivo}</td>
                      <td><Importe valor={e.importe} moneda={e.moneda} /></td>
                      <td><Importe valor={e.rendido} moneda={e.moneda} /></td>
                      <td><Importe valor={money.toString(saldo, 2)} moneda={e.moneda} /></td>
                      <td><EstadoDoc estado={e.estado} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </Contenido>
    </>
  );
}
