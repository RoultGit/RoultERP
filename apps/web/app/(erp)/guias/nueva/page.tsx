import { sql } from "drizzle-orm";
import { listarTerceros, listarProductos, puntosDePartida, seriesDeGuia } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioGuia } from "./formulario";

export const metadata = { title: "Nueva guía de remisión · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaGuia() {
  const datos = await conEmpresa(async (db) => {
    const [series, terceros, productos, puntos] = await Promise.all([
      seriesDeGuia(db),
      listarTerceros(db),
      listarProductos(db),
      puntosDePartida(db),
    ]);
    // Sólo los comprobantes que pueden sustentar un traslado por venta.
    const comprobantes = (await db.execute(sql`
      SELECT c.id, c.tipo_documento, c.serie, c.numero
      FROM comprobantes c
      WHERE c.estado NOT IN ('anulado', 'rechazado') AND c.tipo_documento IN ('01', '03')
      ORDER BY c.fecha_emision DESC
      LIMIT 100`)) as unknown as {
      id: string; tipo_documento: string; serie: string; numero: string;
    }[];
    return { series, terceros, productos, puntos, comprobantes: [...comprobantes] };
  }, "ventas:crear");

  if (datos.series.length === 0) {
    return (
      <>
        <Encabezado titulo="Nueva guía de remisión" />
        <Contenido>
          <Vacio
            titulo="Registre primero una serie de guía"
            descripcion="Las guías se numeran por serie, igual que las facturas. Cree una del tipo 09 en Facturación electrónica."
            accion={<BotonEnlace href="/cpe">Ir a facturación electrónica</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Nueva guía de remisión"
        descripcion="Documenta un traslado. No lleva importes ni genera asiento: lo que sustenta es el movimiento de la mercadería."
      />
      <Contenido>
        <FormularioGuia
          series={datos.series.map((s) => s.serie)}
          destinatarios={datos.terceros.map((t) => ({
            id: t.id,
            etiqueta: `${t.razonSocial} · ${t.numeroDocumento}`,
          }))}
          transportistas={datos.terceros
            .filter((t) => t.esProveedor)
            .map((t) => ({ id: t.id, etiqueta: `${t.razonSocial} · ${t.numeroDocumento}` }))}
          productos={datos.productos.map((p) => ({
            id: p.id,
            etiqueta: `${p.codigo} — ${p.descripcion}`,
          }))}
          puntos={datos.puntos.map((p) => ({
            id: p.almacenId,
            etiqueta: p.nombre,
            ubigeo: p.ubigeo ?? "",
            direccion: p.direccion ?? "",
            establecimiento: p.establecimiento ?? "",
          }))}
          comprobantes={datos.comprobantes.map((c) => ({
            id: c.id,
            etiqueta: `${c.serie}-${c.numero}`,
          }))}
        />
      </Contenido>
    </>
  );
}
