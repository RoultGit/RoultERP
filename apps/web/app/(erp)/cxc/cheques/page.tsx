import Link from "next/link";
import type { Route } from "next";
import { situacionCheques, cuentasParaOperar, listarTerceros } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioRecibir, AccionesCheque } from "./formularios";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Cheques de clientes · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todos"],
  ["recibido", "En cartera"],
  ["depositado", "Depositados"],
  ["cobrado", "Cobrados"],
  ["rebotado", "Rebotados"],
] as const;

export default async function ChequesRecibidos({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; estado?: string }>;
}) {
  const { hecho, estado } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const hoy = hoyEnPeru();
  const puedeCrear = await tienePermiso("cxc:crear");

  const datos = await conEmpresa(async (db) => {
    const [situacion, cuentas, clientes] = await Promise.all([
      situacionCheques(db, hoy, { cartera: "recibido", ...(filtro ? { estado: filtro } : {}) }),
      cuentasParaOperar(db),
      listarTerceros(db, { rol: "cliente" }),
    ]);
    return { situacion, cuentas, clientes };
  }, "cxc:ver");

  const { cheques, enCirculacion } = datos.situacion;
  const rebotados = cheques.filter((c) => c.estado === "rebotado");

  return (
    <>
      <Encabezado
        titulo="Cheques de clientes"
        descripcion="Los cheques que entregaron los clientes y todavía no son dinero. Un cheque rebotado vuelve a ser deuda, y por eso tiene su propio estado."
        acciones={
          <Link href={"/cxc" as Route} className="boton boton-secundario">
            Cuentas por cobrar
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

        {(enCirculacion.length > 0 || rebotados.length > 0) && (
          <section className="tarjeta mb-5 flex flex-wrap gap-8 p-4">
            {enCirculacion.map((c) => (
              <div key={c.moneda}>
                <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                  Por cobrar en {c.moneda}
                </div>
                <div className="text-lg font-medium">
                  <Importe valor={c.importe} moneda={c.moneda} />
                </div>
              </div>
            ))}
            {rebotados.length > 0 && (
              <div>
                <div className="text-xs" style={{ color: "var(--texto-suave)" }}>Rebotados</div>
                <div className="text-lg font-medium" style={{ color: "var(--peligro)" }}>
                  {rebotados.length}
                </div>
              </div>
            )}
          </section>
        )}

        {puedeCrear && (
          <div className="mb-5">
            <FormularioRecibir
              cuentas={datos.cuentas.map((c) => ({
                id: c.id,
                etiqueta: `${c.nombre} · ${c.moneda}`,
              }))}
              clientes={datos.clientes.map((c) => ({
                id: c.id,
                etiqueta: `${c.razonSocial} · ${c.numeroDocumento}`,
              }))}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/cxc/cheques?estado=${valor}` : "/cxc/cheques") as Route}
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
          {cheques.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay cheques de clientes"
                descripcion="Registre aquí el cheque que entrega un cliente: hasta que el banco lo acredite no es dinero."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Girador</th>
                  <th>Banco</th>
                  <th>Fecha</th>
                  <th>No antes de</th>
                  <th className="text-right">Importe</th>
                  <th>Estado</th>
                  <th>Se deposita en</th>
                  {puedeCrear && <th className="w-[280px]" />}
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{c.numero}</td>
                    <td className="max-w-[200px] truncate">{c.beneficiario}</td>
                    <td className="max-w-[120px] truncate">{c.bancoGirador ?? "—"}</td>
                    <td className="cifra">{c.fechaGiro}</td>
                    <td className="cifra">
                      {c.fechaCobro ?? "—"}
                      {c.diferido && <Insignia tono="alerta">diferido</Insignia>}
                    </td>
                    <td><Importe valor={c.importe} moneda={c.moneda} /></td>
                    <td>
                      <EstadoDoc estado={c.estado} />
                      {c.motivoRechazo && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--peligro)" }}>
                          {c.motivoRechazo}
                        </p>
                      )}
                      {c.aniejo && !c.motivoRechazo && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--alerta)" }}>
                          más de 30 días en cartera
                        </p>
                      )}
                    </td>
                    <td className="max-w-[140px] truncate">{c.cuenta}</td>
                    {puedeCrear && (
                      <td><AccionesCheque chequeId={c.id} estado={c.estado} hoy={hoy} /></td>
                    )}
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
