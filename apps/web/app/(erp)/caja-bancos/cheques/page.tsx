import Link from "next/link";
import type { Route } from "next";
import { situacionCheques, cuentasParaOperar, listarTerceros } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioCheque, AccionesCheque } from "./formularios";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Situación de cheques · RoultERP" };
export const dynamic = "force-dynamic";

const ESTADOS = [
  ["", "Todos"],
  ["girado", "Girados"],
  ["entregado", "Entregados"],
  ["cobrado", "Cobrados"],
  ["anulado", "Anulados"],
] as const;

export default async function Cheques({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string; estado?: string }>;
}) {
  const { hecho, estado } = await searchParams;
  const filtro = ESTADOS.some(([v]) => v === estado) ? estado! : "";
  const hoy = hoyEnPeru();
  const puedeCrear = await tienePermiso("caja_bancos:crear");

  const datos = await conEmpresa(async (db) => {
    const [situacion, cuentas, terceros] = await Promise.all([
      situacionCheques(db, hoy, filtro ? { estado: filtro } : undefined),
      cuentasParaOperar(db),
      listarTerceros(db),
    ]);
    return { situacion, cuentas, terceros };
  }, "caja_bancos:ver");

  const { cheques, enCirculacion } = datos.situacion;

  return (
    <>
      <Encabezado
        titulo="Situación de cheques"
        descripcion="Qué se giró, qué se entregó y qué sigue sin cobrar. Ese dinero está comprometido y el saldo del banco todavía no lo descuenta."
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

        {enCirculacion.length > 0 && (
          <section className="tarjeta mb-5 p-4">
            <h2 className="mb-2 text-sm font-semibold">En circulación</h2>
            <div className="flex flex-wrap gap-6">
              {enCirculacion.map((c) => (
                <div key={c.moneda}>
                  <div className="text-xs" style={{ color: "var(--texto-suave)" }}>{c.moneda}</div>
                  <div className="text-lg font-medium">
                    <Importe valor={c.importe} moneda={c.moneda} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--texto-suave)" }}>
              Girado y todavía no cobrado. Quien mire sólo el saldo del banco creerá tener esto de más.
            </p>
          </section>
        )}

        {puedeCrear && (
          <div className="mb-5">
            <FormularioCheque
              cuentas={datos.cuentas.map((c) => ({
                id: c.id,
                etiqueta: `${c.nombre} · ${c.moneda}`,
              }))}
              terceros={datos.terceros.map((t) => ({
                id: t.id,
                etiqueta: `${t.razonSocial} · ${t.numeroDocumento}`,
              }))}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {ESTADOS.map(([valor, texto]) => (
            <Link
              key={valor}
              href={(valor ? `/caja-bancos/cheques?estado=${valor}` : "/caja-bancos/cheques") as Route}
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
                titulo="No hay cheques"
                descripcion="Gire uno desde aquí, o regístrelo al pagar a un proveedor con cheque."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Cuenta</th>
                  <th>Girado</th>
                  <th>No antes de</th>
                  <th>Beneficiario</th>
                  <th className="text-right">Importe</th>
                  <th>Estado</th>
                  <th>Cobrado</th>
                  {puedeCrear && <th className="w-[240px]" />}
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        href={`/caja-bancos/cheques/${c.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {c.numero}
                      </Link>
                    </td>
                    <td className="max-w-[160px] truncate">{c.cuenta}</td>
                    <td className="cifra">{c.fechaGiro}</td>
                    <td className="cifra">
                      {c.fechaCobro ?? "—"}
                      {c.diferido && <Insignia tono="alerta">diferido</Insignia>}
                    </td>
                    <td className="max-w-[200px] truncate">{c.beneficiario}</td>
                    <td><Importe valor={c.importe} moneda={c.moneda} /></td>
                    <td>
                      <EstadoDoc estado={c.estado} />
                      {c.aniejo && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--alerta)" }}>
                          más de 30 días sin cobrar
                        </p>
                      )}
                    </td>
                    <td className="cifra">{c.fechaCobrado ?? "—"}</td>
                    {puedeCrear && (
                      <td>
                        <AccionesCheque chequeId={c.id} estado={c.estado} hoy={hoy} />
                      </td>
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
