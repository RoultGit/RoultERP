import { asc, eq } from "drizzle-orm";
import {
  listarTerceros, listarProductos, listarAlmacenes, listaParaEmitir, saldoPedido,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { kekMaestra } from "@/lib/entorno";
import { Contenido, Encabezado, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioVenta } from "./formulario";

export const metadata = { title: "Emitir comprobante · RoultERP" };

/**
 * Recorta los ceros de la derecha para que el campo no diga «50.000000».
 *
 * La base guarda seis decimales porque el dominio los necesita; el formulario
 * es para leerlo y escribirlo, y ahí «50.00» es la misma cifra sin el ruido.
 * Se conserva un mínimo de decimales para que un precio siga pareciendo precio.
 */
function cifra(valor: string, minimo: number): string {
  const [entero = "0", decimales = ""] = valor.split(".");
  const recortado = decimales.replace(/0+$/, "").padEnd(minimo, "0");
  return recortado ? `${entero}.${recortado}` : entero;
}
export const dynamic = "force-dynamic";

export default async function NuevaVenta({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string }>;
}) {
  const { pedido: pedidoId } = await searchParams;

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
    // Si se viene desde un pedido, el detalle no se teclea: se trae su saldo.
    const pedido = pedidoId ? await saldoPedido(db, pedidoId).catch(() => null) : null;
    return { preparacion, clientes, productos, almacenes, series, pedido };
  }, "ventas:crear");

  /*
   * Sólo se bloquea lo que impide *emitir*.
   *
   * Faltar el certificado o las claves SOL impide enviar a SUNAT, no facturar:
   * el comprobante se numera, descarga el almacén y se contabiliza igual, y se
   * envía cuando la empresa tenga su certificado. Bloquearlo aquí dejaba a una
   * empresa nueva sin poder registrar una venta durante los días que tarda el
   * trámite.
   */
  if (!datos.preparacion.puedeEmitir) {
    return (
      <>
        <Encabezado titulo="Emitir comprobante" />
        <Contenido>
          <Vacio
            titulo="Falta configurar la numeración"
            descripcion={datos.preparacion.faltantesEmision.join(". ")}
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
        {/* No usa `.aviso`: eso es para los errores. Esto es información —se
            puede facturar igual—, y pintarla de rojo hace que el usuario crea
            que algo falló. */}
        {!datos.preparacion.puedeEnviar && (
          <div
            className="mb-5 bloque p-4 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
          >
            <p className="font-medium" style={{ color: "var(--alerta)" }}>
              Podrá emitir, pero todavía no enviar a SUNAT:
            </p>
            <ul className="mt-1.5 space-y-0.5" style={{ color: "var(--texto-suave)" }}>
              {datos.preparacion.faltantesEnvio.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
              El comprobante queda emitido y en cola; se envía cuando la configuración esté
              completa.
            </p>
          </div>
        )}

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
          {...(datos.pedido && datos.pedido.pendientes.length > 0
            ? {
                pedido: {
                  id: datos.pedido.cabecera.id,
                  numero: datos.pedido.cabecera.numero,
                  clienteId: datos.pedido.cabecera.clienteId,
                  almacenId: datos.pedido.cabecera.almacenId,
                  moneda: datos.pedido.cabecera.moneda,
                  tipoCambio: datos.pedido.cabecera.tipoCambio,
                  lineas: datos.pedido.pendientes.map((l) => ({
                    productoId: l.productoId,
                    descripcion: l.descripcion,
                    saldo: cifra(money.toString(l.saldo, 6), 0),
                    valorUnitario: cifra(l.valorUnitario, 2),
                    afectacionIgv: l.afectacionIgv,
                  })),
                },
              }
            : {})}
        />
      </Contenido>
    </>
  );
}
