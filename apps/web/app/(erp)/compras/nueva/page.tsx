import { asc, eq } from "drizzle-orm";
import {
  listarTerceros, listarProductos, listarAlmacenes, listarCuentas,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioCompra } from "./formulario";

export const metadata = { title: "Registrar compra · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevaCompra() {
  const datos = await conEmpresa(async (db) => {
    const [proveedores, productos, almacenes, cuentas] = await Promise.all([
      listarTerceros(db, { rol: "proveedor" }),
      listarProductos(db),
      listarAlmacenes(db),
      listarCuentas(db, true),
    ]);
    const centros = await db
      .select()
      .from(schema.centrosCosto)
      .where(eq(schema.centrosCosto.activo, true))
      .orderBy(asc(schema.centrosCosto.codigo));
    const reglas = await db
      .select()
      .from(schema.reglasDetraccion)
      .orderBy(asc(schema.reglasDetraccion.codigo));
    return { proveedores, productos, almacenes, cuentas, centros, reglas };
  }, "compras:crear");

  // Sin proveedores no hay factura que registrar; decirlo aquí ahorra que el
  // usuario descubra el vacío dentro de un desplegable.
  const domiciliados = datos.proveedores.filter((p) => p.esDomiciliado);
  if (domiciliados.length === 0) {
    return (
      <>
        <Encabezado titulo="Registrar compra" />
        <Contenido>
          <Vacio
            titulo="Primero registre un proveedor domiciliado"
            descripcion="Una compra nacional necesita un proveedor con RUC. Las facturas del exterior se registran en el módulo de importaciones."
            accion={<BotonEnlace href="/maestros/terceros/nuevo">Nuevo proveedor</BotonEnlace>}
          />
        </Contenido>
      </>
    );
  }

  return (
    <>
      <Encabezado
        titulo="Registrar compra"
        descripcion="Genera el asiento contable, la cuenta por pagar y el ingreso al almacén, todo en una sola operación."
      />
      <Contenido>
        <FormularioCompra
          proveedores={domiciliados.map((p) => ({
            id: p.id,
            etiqueta: `${p.razonSocial} · ${p.numeroDocumento}`,
          }))}
          productos={datos.productos
            .filter((p) => p.tipo === "bien")
            .map((p) => ({
              id: p.id,
              etiqueta: `${p.codigo} — ${p.descripcion}`,
              descripcion: p.descripcion,
            }))}
          almacenes={datos.almacenes
            .filter((a) => a.activo)
            .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
          cuentas={datos.cuentas
            // Las cuentas de gasto y de servicios; la mercadería va por producto.
            .filter((c) => c.cuenta.startsWith("6") || c.cuenta.startsWith("3"))
            .map((c) => ({ id: c.cuenta, etiqueta: `${c.cuenta} — ${c.descripcion}` }))}
          centrosCosto={datos.centros.map((c) => ({
            id: c.id,
            etiqueta: `${c.codigo} — ${c.nombre}`,
          }))}
          reglas={datos.reglas.map((r) => ({
            codigo: r.codigo,
            descripcion: r.descripcion,
            tasa: r.tasa,
          }))}
        />
      </Contenido>
    </>
  );
}
