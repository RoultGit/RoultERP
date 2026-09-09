import { eq, sql } from "drizzle-orm";
import { documentosPorPagar, listarCuentas } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioPago } from "./formulario";

export const metadata = { title: "Pagar a proveedor · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "N. crédito", "08": "N. débito",
};

export default async function Pagar({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string }>;
}) {
  const { proveedor } = await searchParams;

  const datos = await conEmpresa(async (db, sesion) => {
    const [hoyFila] = (await db.execute(sql`SELECT current_date::text AS hoy`)) as unknown as [
      { hoy: string },
    ];
    const [empresa] = await db
      .select({ esAgenteRetencion: schema.empresas.esAgenteRetencion })
      .from(schema.empresas)
      .where(eq(schema.empresas.id, sesion.empresaId))
      .limit(1);

    // Proveedores con saldo, para poder elegir a quién se paga.
    const proveedores = (await db.execute(sql`
      SELECT t.id, t.razon_social, coalesce(sum(d.saldo), 0)::text AS saldo
      FROM terceros t
      JOIN documentos_cxp d ON d.proveedor_id = t.id AND d.saldo > 0
      GROUP BY t.id ORDER BY sum(d.saldo) DESC`)) as unknown as {
      id: string; razon_social: string; saldo: string;
    }[];

    const documentos = proveedor ? await documentosPorPagar(db, proveedor) : [];
    const cuentas = (await listarCuentas(db, true)).filter(
      (c) => c.cuenta.startsWith("10"),
    );

    return {
      hoy: hoyFila?.hoy ?? new Date().toISOString().slice(0, 10),
      esAgenteRetencion: empresa?.esAgenteRetencion ?? false,
      proveedores,
      documentos,
      cuentas,
    };
  }, "cxp:crear");

  const elegido = datos.proveedores.find((p) => p.id === proveedor);

  if (!elegido) {
    return (
      <>
        <Encabezado titulo="Pagar a proveedor" descripcion="Elija a quién se le paga." />
        <Contenido>
          {datos.proveedores.length === 0 ? (
            <Vacio
              titulo="No hay nada por pagar"
              descripcion="Las cuentas por pagar nacen al registrar la factura del proveedor."
              accion={<BotonEnlace href="/compras/nueva">Registrar compra</BotonEnlace>}
            />
          ) : (
            <div className="tarjeta divide-y" style={{ borderColor: "var(--borde)" }}>
              {datos.proveedores.map((p) => (
                <a
                  key={p.id}
                  href={`/cxp/pagar?proveedor=${p.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--superficie-2)]"
                >
                  <span className="font-medium">{p.razon_social}</span>
                  <span className="cifra">S/ {Number(p.saldo).toFixed(2)}</span>
                </a>
              ))}
            </div>
          )}
        </Contenido>
      </>
    );
  }

  const dias = (v: string) =>
    Math.round((Date.parse(`${datos.hoy}T00:00:00Z`) - Date.parse(`${v}T00:00:00Z`)) / 86_400_000);

  return (
    <>
      <Encabezado
        titulo={`Pagar a ${elegido.razon_social}`}
        descripcion="Cancela documentos, retiene el IGV si corresponde y reconoce la diferencia de cambio."
      />
      <Contenido>
        <FormularioPago
          proveedor={{ id: elegido.id, nombre: elegido.razon_social }}
          esAgenteRetencion={datos.esAgenteRetencion}
          cuentas={datos.cuentas.map((c) => ({
            cuenta: c.cuenta,
            etiqueta: `${c.cuenta} — ${c.descripcion}`,
          }))}
          documentos={datos.documentos.map((d) => ({
            id: d.id,
            etiqueta: `${DOCUMENTO[d.tipoDocumento] ?? d.tipoDocumento} ${d.serie}-${d.numero}`,
            fechaVencimiento: d.fechaVencimiento,
            moneda: d.moneda,
            saldo: d.saldo,
            diasVencido: Math.max(0, dias(d.fechaVencimiento)),
          }))}
        />
      </Contenido>
    </>
  );
}
