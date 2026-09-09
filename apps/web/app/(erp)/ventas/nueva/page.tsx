import { asc, eq } from "drizzle-orm";
import {
  listarTerceros, listarProductos, listarAlmacenes, listaParaEmitir,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { kekMaestra } from "@/lib/entorno";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioVenta } from "./formulario";

export const metadata = { title: "Emitir comprobante · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaVenta() {
  const datos = await conEmpresa(async (db, sesion) => {
    const preparacion = await listaParaEmitir(db, sesion.empresaId, kekMaestra);
    const [clientes, productos, almacenes] = await Promise.all([
      listarTerceros(db, { rol: "cliente" }),
      listarProductos(db),
      listarAlmacenes(db),
    ]);
    const series = await db
      .select()
      .from(schema.seriesDocumento)
      .where(eq(schema.seriesDocumento.activa, true))
      .orderBy(asc(schema.seriesDocumento.serie));
    const reglas = await db
      .select()
      .from(schema.reglasDetraccion)
      .orderBy(asc(schema.reglasDetraccion.codigo));
    return { preparacion, clientes, productos, almacenes, series };
  }, "ventas:crear");

  if (!datos.preparacion.lista) {
    return (
      <>
        <Encabezado titulo="Emitir comprobante" />
        <Contenido>
          <Vacio
            titulo="Falta configurar la emisión electrónica"
            descripcion={datos.preparacion.faltantes.join(". ")}
            accion={<BotonEnlace href="/cpe">Ir a la configuración</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  if (datos.clientes.length === 0) {
    return (
      <>
        <Encabezado titulo="Emitir comprobante" />
        <Contenido>
          <Vacio
            titulo="Primero registre un cliente"
            descripcion="Un comprobante necesita a quién emitirse. Para facturar hace falta que el cliente tenga RUC."
            accion={<BotonEnlace href="/maestros/terceros/nuevo">Nuevo cliente</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Emitir comprobante"
        descripcion="Descarga el inventario, contabiliza la venta con su costo y deja el comprobante listo para informar a SUNAT."
      />
      <Contenido>
        <FormularioVenta
          clientes={datos.clientes.map((c) => ({
            id: c.id,
            etiqueta: `${c.razonSocial} · ${c.numeroDocumento}`,
            tieneRuc: c.tipoDocumento === "6",
          }))}
          productos={datos.productos
            .filter((p) => p.activo)
            .map((p) => ({
              id: p.id,
              etiqueta: `${p.codigo} — ${p.descripcion}`,
              descripcion: p.descripcion,
              esBien: p.tipo === "bien",
              afectacion: p.afectacionIgv,
            }))}
          almacenes={datos.almacenes
            .filter((a) => a.activo && !a.esTransito)
            .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
          series={datos.series.map((s) => ({
            serie: s.serie,
            tipoDocumento: s.tipoDocumento,
            siguiente: String(s.correlativo + 1).padStart(8, "0"),
          }))}
        />
      </Contenido>
    </>
  );
}
