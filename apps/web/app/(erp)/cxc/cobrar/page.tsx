import { sql } from "drizzle-orm";
import { documentosPorCobrar, carteraPorCliente, listarCuentas, cuentasParaOperar } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioCobranza } from "./formulario";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Cobrar a cliente · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = { "01": "Factura", "03": "Boleta" };

export default async function Cobrar({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { cliente } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const [fila] = (await db.execute(sql`SELECT current_date::text AS hoy`)) as unknown as [
      { hoy: string },
    ];
    return {
      hoy: fila?.hoy ?? hoyEnPeru(),
      cartera: await carteraPorCliente(db),
      comprobantes: cliente ? await documentosPorCobrar(db, cliente) : [],
      cuentas: (await listarCuentas(db, true)).filter((c) => c.cuenta.startsWith("10")),
      cuentasEfectivo: await cuentasParaOperar(db),
    };
  }, "cxc:crear");

  const elegido = datos.cartera.find((c) => c.id === cliente);

  if (!elegido) {
    return (
      <>
        <Encabezado titulo="Cobrar a cliente" descripcion="Elija a quién se le cobra." />
        <Contenido>
          {datos.cartera.length === 0 ? (
            <Vacio
              titulo="No hay nada por cobrar"
              descripcion="Las cuentas por cobrar nacen al emitir un comprobante de venta."
              accion={<BotonEnlace href="/ventas/nueva">Emitir comprobante</BotonEnlace>}
            />
          ) : (
            <div className="tarjeta divide-y" style={{ borderColor: "var(--borde)" }}>
              {datos.cartera.map((c) => (
                <a
                  key={c.id}
                  href={`/cxc/cobrar?cliente=${c.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--superficie-2)]"
                >
                  <span>
                    <span className="font-medium">{c.razon_social}</span>
                    <span className="ml-2 text-xs" style={{ color: "var(--texto-suave)" }}>
                      {c.documentos} documento{c.documentos === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="cifra">S/ {Number(c.saldo).toFixed(2)}</span>
                </a>
              ))}
            </div>
          )}
        </Contenido>
      </>
    );
  }

  const dias = (v: string | null) =>
    v === null
      ? 0
      : Math.max(
          0,
          Math.round((Date.parse(`${datos.hoy}T00:00:00Z`) - Date.parse(`${v}T00:00:00Z`)) / 86_400_000),
        );

  return (
    <>
      <Encabezado
        titulo={`Cobrar a ${elegido.razon_social}`}
        descripcion="Aplica el cobro a los comprobantes, contabiliza el ingreso y reconoce la diferencia de cambio."
      />
      <Contenido>
        <FormularioCobranza
          cliente={{
            id: elegido.id,
            nombre: elegido.razon_social,
            limite: elegido.limite,
            saldo: elegido.saldo,
          }}
          cuentas={datos.cuentas.map((c) => ({
            cuenta: c.cuenta,
            etiqueta: `${c.cuenta} — ${c.descripcion}`,
          }))}
          cuentasEfectivo={datos.cuentasEfectivo}
          comprobantes={datos.comprobantes.map((c) => ({
            id: c.id,
            etiqueta: `${DOCUMENTO[c.tipo_documento] ?? c.tipo_documento} ${c.serie}-${c.numero}`,
            fechaVencimiento: c.fecha_vencimiento,
            moneda: c.moneda,
            saldo: c.saldo,
            diasVencido: dias(c.fecha_vencimiento),
          }))}
        />
      </Contenido>
    </>
  );
}
