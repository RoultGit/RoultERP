import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { cargarEntrega, listarCuentas, listarCentrosCosto, CajaInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Vacio } from "@/components/ui";
import { FormularioRendicion, Anular } from "./rendir";

export const metadata = { title: "Entrega a rendir · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura",
  "02": "R. honorarios",
  "03": "Boleta",
  "12": "Ticket",
};

export default async function Entrega({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { id } = await params;
  const { hecho } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const entrega = await cargarEntrega(db, id).catch((e) => {
      if (e instanceof CajaInvalida) return null;
      throw e;
    });
    if (!entrega) return null;
    const [plan, centros] = await Promise.all([listarCuentas(db, true), listarCentrosCosto(db)]);
    return { ...entrega, plan, centros };
  }, "caja_bancos:ver");

  if (!datos) notFound();

  const { cabecera, items, saldo } = datos;
  const [puedeCrear, puedeAnular] = await Promise.all([
    tienePermiso("caja_bancos:crear"),
    tienePermiso("caja_bancos:anular"),
  ]);
  const abierta = cabecera.estado === "pendiente" || cabecera.estado === "parcial";

  return (
    <>
      <Encabezado
        titulo={`Entrega ${cabecera.numero}`}
        descripcion={`${cabecera.responsable} · ${cabecera.motivo}`}
        acciones={
          <>
            {puedeAnular && cabecera.estado === "pendiente" && <Anular entregaId={cabecera.id} />}
            <Link href={"/caja-bancos/rendiciones" as Route} className="boton boton-secundario">
              Volver
            </Link>
          </>
        }
      />
      <Contenido>
        {hecho === "rendida" && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            Rendición registrada. Los gastos ya están en su cuenta y la 14 quedó descargada por ese
            importe.
          </p>
        )}

        <section className="tarjeta mb-5 p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="etiqueta">Estado</dt>
              <dd><EstadoDoc estado={cabecera.estado} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Fecha</dt>
              <dd className="cifra" style={{ textAlign: "left" }}>{cabecera.fecha}</dd>
            </div>
            <div>
              <dt className="etiqueta">Cuenta</dt>
              <dd className="max-w-[160px] truncate">{cabecera.cuenta}</dd>
            </div>
            <div>
              <dt className="etiqueta">Entregado</dt>
              <dd><Importe valor={cabecera.importe} moneda={cabecera.moneda} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Rendido</dt>
              <dd><Importe valor={cabecera.rendido} moneda={cabecera.moneda} /></dd>
            </div>
            <div>
              <dt className="etiqueta">Por rendir</dt>
              <dd className="font-medium"><Importe valor={saldo} moneda={cabecera.moneda} /></dd>
            </div>
          </dl>
          {!money.isZero(money.dec(cabecera.devuelto)) && (
            <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
              Devolvió {cabecera.devuelto} a la caja.
            </p>
          )}
        </section>

        <section className="tarjeta mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Documentos rendidos
          </h2>
          {items.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no se rindió nada"
                descripcion="El dinero sigue en la cuenta 14 a nombre del responsable."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Documento</th>
                  <th>Concepto</th>
                  <th>Cuenta</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="cifra">{i.fecha}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {i.tipoDocumento ? DOCUMENTO[i.tipoDocumento] ?? i.tipoDocumento : "—"}
                      {i.serie && ` ${i.serie}-${i.numero ?? ""}`}
                    </td>
                    <td className="max-w-[280px] truncate">{i.concepto}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{i.cuenta}</td>
                    <td><Importe valor={i.importe} moneda={cabecera.moneda} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {puedeCrear && abierta && (
          <FormularioRendicion
            entregaId={cabecera.id}
            saldo={saldo}
            cuentas={datos.plan
              // Cuentas de gasto: lo que se rinde es gasto, no otra cosa.
              .filter((c) => /^6/.test(c.cuenta))
              .map((c) => ({ id: c.cuenta, etiqueta: `${c.cuenta} — ${c.descripcion}` }))}
            centrosCosto={datos.centros
              .filter((c) => c.activo)
              .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
          />
        )}
      </Contenido>
    </>
  );
}
