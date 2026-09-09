import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { saldoTercero } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe } from "@/components/ui";
import { FormularioTercero } from "../formulario";

export const dynamic = "force-dynamic";

export default async function EditarTercero({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const [t] = await db
      .select()
      .from(schema.terceros)
      .where(eq(schema.terceros.id, id))
      .limit(1);
    if (!t) return null;
    return { t, saldo: await saldoTercero(db, id) };
  }, "maestros:ver");

  if (!datos) notFound();
  const { t, saldo } = datos;

  return (
    <>
      <Encabezado
        titulo={t.razonSocial}
        descripcion={`${t.tipoDocumento === "6" ? "RUC" : "Doc."} ${t.numeroDocumento}`}
        acciones={
          saldo.documentos > 0 ? (
            <div className="text-right text-sm">
              <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                Saldo por pagar · {saldo.documentos} documento{saldo.documentos === 1 ? "" : "s"}
              </div>
              <Importe valor={saldo.porPagar} moneda="PEN" />
            </div>
          ) : null
        }
      />
      <Contenido>
        <FormularioTercero
          inicial={{
            id: t.id,
            tipoDocumento: t.tipoDocumento,
            numeroDocumento: t.numeroDocumento,
            razonSocial: t.razonSocial,
            nombreComercial: t.nombreComercial ?? "",
            direccion: t.direccion ?? "",
            pais: t.pais,
            email: t.email ?? "",
            telefono: t.telefono ?? "",
            esCliente: t.esCliente,
            esProveedor: t.esProveedor,
            esDomiciliado: t.esDomiciliado,
            diasCredito: t.diasCredito,
            limiteCredito: t.limiteCredito,
            monedaLimite: t.monedaLimite,
          }}
        />
      </Contenido>
    </>
  );
}
