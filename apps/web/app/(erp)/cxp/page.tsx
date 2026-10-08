import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { listarCxp } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Cuentas por pagar · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * Tramos de antigüedad.
 *
 * Los que usa cualquier contador peruano al presentar el anexo de cuentas por
 * pagar. Lo vencido se separa de lo por vencer porque son dos conversaciones
 * distintas con el proveedor.
 */
const TRAMOS = [
  { hasta: -1, etiqueta: "Vencido", tono: "peligro" as const },
  { hasta: 7, etiqueta: "Vence en 7 días", tono: "alerta" as const },
  { hasta: 30, etiqueta: "Vence en 30 días", tono: "neutro" as const },
  { hasta: Infinity, etiqueta: "Más de 30 días", tono: "neutro" as const },
];

function tramoDe(dias: number) {
  return TRAMOS.find((t) => dias <= t.hasta) ?? TRAMOS[TRAMOS.length - 1]!;
}

export default async function Cxp({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string }>;
}) {
  const { proveedor } = await searchParams;

  const { documentos, proveedores, hoy } = await conEmpresa(async (db) => {
    const [fila] = (await db.execute(
      sql`SELECT current_date::text AS hoy`,
    )) as unknown as [{ hoy: string }];
    const proveedores = (await db.execute(sql`
      SELECT t.id, t.razon_social, count(d.id)::int AS documentos,
             coalesce(sum(d.saldo), 0)::text AS saldo
      FROM terceros t
      JOIN documentos_cxp d ON d.proveedor_id = t.id AND d.saldo > 0
      GROUP BY t.id
      ORDER BY sum(d.saldo) DESC`)) as unknown as {
      id: string;
      razon_social: string;
      documentos: number;
      saldo: string;
    }[];
    return {
      documentos: await listarCxp(db, proveedor),
      proveedores,
      hoy: fila?.hoy ?? hoyEnPeru(),
    };
  }, "cxp:ver");

  const dias = (vencimiento: string) =>
    Math.round(
      (Date.parse(`${vencimiento}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000,
    );

  const total = documentos.reduce((a, d) => money.add(a, money.dec(d.saldo)), money.ZERO);
  const vencido = documentos
    .filter((d) => dias(d.fechaVencimiento) < 0)
    .reduce((a, d) => money.add(a, money.dec(d.saldo)), money.ZERO);

  return (
    <>
      <Encabezado
        titulo="Cuentas por pagar"
        descripcion="Documentos con saldo pendiente, ordenados por vencimiento."
        acciones={
          <>
            <Link href="/cxp/pagos" className="boton boton-secundario">Pagos</Link>
            <Link href="/cxp/letras" className="boton boton-secundario">Letras</Link>
            <Link href="/cxp/pagar" className="boton boton-primario">Registrar pago</Link>
          </>
        }
      />
      <Contenido>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Tarjeta titulo="Saldo total" valor={money.toString(total, 2)} detalle={`${documentos.length} documentos`} />
          <Tarjeta
            titulo="Vencido"
            valor={money.toString(vencido, 2)}
            detalle="Pasado de fecha"
            alerta={money.gt(vencido, money.ZERO)}
          />
          <Tarjeta
            titulo="Proveedores con saldo"
            valor={String(proveedores.length)}
            detalle="Con al menos un documento abierto"
            crudo
          />
        </div>

        {proveedores.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Filtro href="/cxp" activo={!proveedor}>Todos</Filtro>
            {proveedores.slice(0, 8).map((p) => (
              <Filtro key={p.id} href={`/cxp?proveedor=${p.id}`} activo={proveedor === p.id}>
                {p.razon_social.slice(0, 28)} · {money.toString(money.dec(p.saldo), 2)}
              </Filtro>
            ))}
          </div>
        )}

        {documentos.length === 0 ? (
          <Vacio
            titulo="Sin documentos pendientes"
            descripcion="Las cuentas por pagar nacen al registrar la factura del proveedor en el módulo de compras."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Proveedor</th>
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
                  const n = dias(d.fechaVencimiento);
                  const tramo = tramoDe(n);
                  return (
                    <tr key={d.id}>
                      <td className="cifra whitespace-nowrap" style={{ textAlign: "left" }}>
                        {d.serie}-{d.numero}
                      </td>
                      <td className="max-w-[260px] truncate">
                        <Link href={`/maestros/terceros/${d.proveedorId}` as Route} className="underline">
                          {d.proveedor}
                        </Link>
                      </td>
                      <td className="cifra">{d.fechaEmision}</td>
                      <td className="cifra">{d.fechaVencimiento}</td>
                      <td>
                        <Insignia tono={tramo.tono}>
                          {n < 0 ? `${-n} días vencido` : n === 0 ? "vence hoy" : `en ${n} días`}
                        </Insignia>
                      </td>
                      <td>{d.moneda}</td>
                      <td><Importe valor={d.total} /></td>
                      <td>
                        <strong><Importe valor={d.saldo} /></strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Saldo pendiente
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(total, 2)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          Falta implementar la programación de egresos y el comprobante de retención.
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
    <div className="bloque p-4">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
        {titulo}
      </div>
      <div
        className="cifra mt-1.5 text-2xl font-semibold"
        style={{ textAlign: "left", color: alerta ? "var(--peligro)" : undefined }}
      >
        {crudo ? valor : <><span className="mr-1 text-base opacity-60">S/</span><Importe valor={valor} /></>}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>{detalle}</div>
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
