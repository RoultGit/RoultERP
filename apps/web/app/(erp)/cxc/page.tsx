import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { documentosPorCobrar, carteraPorCliente } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";

export const metadata = { title: "Cuentas por cobrar · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = { "01": "Factura", "03": "Boleta" };

export default async function Cxc({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { cliente } = await searchParams;

  const { documentos, cartera, hoy } = await conEmpresa(async (db) => {
    const [fila] = (await db.execute(sql`SELECT current_date::text AS hoy`)) as unknown as [
      { hoy: string },
    ];
    return {
      documentos: await documentosPorCobrar(db, cliente),
      cartera: await carteraPorCliente(db),
      hoy: fila?.hoy ?? new Date().toISOString().slice(0, 10),
    };
  }, "cxc:ver");

  const puedeCobrar = await tienePermiso("cxc:crear");

  const dias = (v: string | null) =>
    v === null
      ? null
      : Math.round((Date.parse(`${v}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);

  const total = documentos.reduce((a, d) => money.add(a, money.dec(d.saldo)), money.ZERO);
  const vencido = documentos
    .filter((d) => (dias(d.fecha_vencimiento) ?? 1) < 0)
    .reduce((a, d) => money.add(a, money.dec(d.saldo)), money.ZERO);

  /**
   * Un cliente sobre su límite se marca aquí y no sólo al vender: quien revisa
   * la cartera por la mañana necesita verlo antes de que alguien le facture.
   */
  const excedidos = cartera.filter(
    (c) =>
      !money.isZero(money.dec(c.limite)) &&
      money.gt(money.dec(c.saldo), money.dec(c.limite)),
  );

  return (
    <>
      <Encabezado
        titulo="Cuentas por cobrar"
        descripcion="Comprobantes emitidos con saldo pendiente."
        acciones={
          <>
            <Link href="/cxc/cobranzas" className="boton boton-secundario">Cobranzas</Link>
            {puedeCobrar && (
              <Link href="/cxc/cobrar" className="boton boton-primario">Registrar cobranza</Link>
            )}
          </>
        }
      />
      <Contenido>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Tarjeta titulo="Por cobrar" valor={money.toString(total, 2)} detalle={`${documentos.length} documentos`} />
          <Tarjeta
            titulo="Vencido"
            valor={money.toString(vencido, 2)}
            detalle="Pasado de fecha"
            alerta={money.gt(vencido, money.ZERO)}
          />
          <Tarjeta
            titulo="Clientes sobre su límite"
            valor={String(excedidos.length)}
            detalle={excedidos.length ? excedidos.map((c) => c.razon_social).join(", ").slice(0, 60) : "Ninguno"}
            alerta={excedidos.length > 0}
            crudo
          />
        </div>

        {cartera.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Filtro href="/cxc" activo={!cliente}>Todos</Filtro>
            {cartera.slice(0, 8).map((c) => (
              <Filtro key={c.id} href={`/cxc?cliente=${c.id}`} activo={cliente === c.id}>
                {c.razon_social.slice(0, 26)} · {money.toString(money.dec(c.saldo), 2)}
              </Filtro>
            ))}
          </div>
        )}

        {documentos.length === 0 ? (
          <Vacio
            titulo="Sin documentos por cobrar"
            descripcion="Las cuentas por cobrar nacen al emitir un comprobante de venta."
            accion={<BotonEnlace href="/ventas/nueva">Emitir comprobante</BotonEnlace>}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Cliente</th>
                  <th>Emisión</th>
                  <th>Vencimiento</th>
                  <th>Antigüedad</th>
                  <th>Mon.</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {documentos.map((d) => {
                  const n = dias(d.fecha_vencimiento);
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">
                        <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                          {DOCUMENTO[d.tipo_documento] ?? d.tipo_documento}
                        </span>{" "}
                        <Link href={`/ventas/${d.id}` as Route} className="cifra underline" style={{ textAlign: "left" }}>
                          {d.serie}-{d.numero}
                        </Link>
                      </td>
                      <td className="max-w-[240px] truncate">
                        {d.cliente}
                        <span className="ml-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
                          {d.documento_cliente}
                        </span>
                      </td>
                      <td className="cifra">{d.fecha_emision}</td>
                      <td className="cifra">{d.fecha_vencimiento ?? "—"}</td>
                      <td>
                        {n === null ? (
                          <span style={{ color: "var(--texto-suave)" }}>—</span>
                        ) : (
                          <Insignia tono={n < 0 ? "peligro" : n <= 7 ? "alerta" : "neutro"}>
                            {n < 0 ? `${-n} días vencido` : n === 0 ? "vence hoy" : `en ${n} días`}
                          </Insignia>
                        )}
                      </td>
                      <td>{d.moneda}</td>
                      <td><Importe valor={d.total} /></td>
                      <td><strong><Importe valor={d.saldo} /></strong></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Saldo por cobrar
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(total, 2)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {cartera.length > 0 && (
          <section className="tarjeta mt-5 overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Exposición por cliente
            </h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="text-right">Documentos</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Vencido</th>
                  <th className="text-right">Límite</th>
                  <th className="text-right">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {cartera.map((c) => {
                  const limite = money.dec(c.limite);
                  const saldo = money.dec(c.saldo);
                  const sinLimite = money.isZero(limite);
                  const disponible = money.sub(limite, saldo);
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[280px] truncate">
                        <Link href={`/maestros/terceros/${c.id}` as Route} className="underline">
                          {c.razon_social}
                        </Link>
                      </td>
                      <td className="cifra">{c.documentos}</td>
                      <td><Importe valor={c.saldo} /></td>
                      <td>
                        {money.isZero(money.dec(c.vencido)) ? (
                          <span style={{ color: "var(--texto-suave)" }}>—</span>
                        ) : (
                          <span className="cifra negativo"><Importe valor={c.vencido} /></span>
                        )}
                      </td>
                      <td>
                        {sinLimite ? (
                          <span style={{ color: "var(--texto-suave)" }}>sin tope</span>
                        ) : (
                          <Importe valor={c.limite} />
                        )}
                      </td>
                      <td>
                        {sinLimite ? (
                          <span style={{ color: "var(--texto-suave)" }}>—</span>
                        ) : money.lt(disponible, money.ZERO) ? (
                          <Insignia tono="peligro">excedido</Insignia>
                        ) : (
                          <Importe valor={money.toString(disponible, 2)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          Falta implementar los cheques diferidos y devueltos, y el protesto de letras por cobrar.
        </p>
      </Contenido>
    </>
  );
}

function Tarjeta({
  titulo,
  valor,
  detalle,
  alerta,
  crudo,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  alerta?: boolean;
  crudo?: boolean;
}) {
  return (
    <div className="tarjeta p-4">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
        {titulo}
      </div>
      <div
        className="cifra mt-1.5 text-2xl font-semibold"
        style={{ textAlign: "left", color: alerta ? "var(--peligro)" : undefined }}
      >
        {crudo ? valor : <><span className="mr-1 text-base opacity-60">S/</span><Importe valor={valor} /></>}
      </div>
      <div className="mt-1 truncate text-xs" style={{ color: "var(--texto-suave)" }}>{detalle}</div>
    </div>
  );
}

function Filtro({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className="rounded border px-2.5 py-1 text-xs transition-colors"
      style={{
        borderColor: activo ? "var(--acento)" : "var(--borde)",
        background: activo ? "var(--acento-suave)" : "var(--superficie)",
        color: activo ? "var(--acento)" : "var(--texto-suave)",
      }}
    >
      {children}
    </Link>
  );
}
