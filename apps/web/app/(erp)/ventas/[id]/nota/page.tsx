import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { cargarComprobante, VentaInvalida } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioNota } from "./formulario";

export const metadata = { title: "Nota sobre comprobante · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaNota({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    try {
      const doc = await cargarComprobante(db, id);
      const series = await db
        .select({ tipo: schema.seriesDocumento.tipoDocumento, serie: schema.seriesDocumento.serie })
        .from(schema.seriesDocumento)
        .where(eq(schema.seriesDocumento.activa, true))
        .orderBy(asc(schema.seriesDocumento.serie));
      return { doc, series };
    } catch (e) {
      if (e instanceof VentaInvalida) return null;
      throw e;
    }
  }, "ventas:crear");

  if (!datos) notFound();
  const { cabecera, items, cliente } = datos.doc;

  // Las mismas reglas que aplica el servicio, dichas antes de que el usuario
  // llene el formulario: un borrador se corrige, no se le emite una nota.
  const impedimento =
    cabecera.tipoDocumento === "07" || cabecera.tipoDocumento === "08"
      ? "Una nota no modifica a otra nota."
      : cabecera.estado === "borrador"
        ? "Este comprobante todavía no se ha enviado a SUNAT. Corríjalo o anúlelo en vez de emitir una nota."
        : cabecera.estado === "anulado"
          ? "Este comprobante ya está anulado."
          : null;

  if (impedimento) {
    return (
      <>
        <Encabezado titulo="Emitir nota" />
        <Contenido>
          <Vacio
            titulo="No procede una nota sobre este comprobante"
            descripcion={impedimento}
            accion={<BotonEnlace href={`/ventas/${id}`}>Volver al comprobante</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo={`Nota sobre ${cabecera.serie}-${cabecera.numero}`}
        descripcion={`${cliente?.razonSocial ?? ""} · ${cliente?.numeroDocumento ?? ""} · emitido el ${cabecera.fechaEmision}`}
      />
      <Contenido>
        <FormularioNota
          comprobanteId={cabecera.id}
          documento={`${cabecera.serie}-${cabecera.numero}`}
          moneda={cabecera.moneda}
          seriesCredito={datos.series.filter((s) => s.tipo === "07").map((s) => s.serie)}
          seriesDebito={datos.series.filter((s) => s.tipo === "08").map((s) => s.serie)}
          tieneAlmacen={!!cabecera.almacenId}
          items={items.map((i) => ({
            linea: i.linea,
            productoId: i.productoId,
            codigo: i.codigo,
            descripcion: i.descripcion,
            unidad: i.unidad,
            cantidad: i.cantidad,
            valorUnitario: i.valorUnitario,
            afectacionIgv: i.afectacionIgv,
          }))}
        />
      </Contenido>
    </>
  );
}
