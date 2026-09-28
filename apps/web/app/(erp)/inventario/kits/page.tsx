import Link from "next/link";
import type { Route } from "next";
import {
  listarComposiciones, cargarComposicion, listarProductos, listarAlmacenes,
  ComposicionInvalida,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia, Vacio } from "@/components/ui";
import { FormularioReceta, FormularioProceso } from "./formularios";

export const metadata = { title: "Kits y conversiones · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Kits({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; hecho?: string }>;
}) {
  const { producto, hecho } = await searchParams;
  const [puedeCrear, puedeEditar] = await Promise.all([
    tienePermiso("inventario:crear"),
    tienePermiso("inventario:editar"),
  ]);

  const datos = await conEmpresa(async (db) => {
    const [recetas, productos, almacenes] = await Promise.all([
      listarComposiciones(db),
      listarProductos(db),
      listarAlmacenes(db),
    ]);
    const elegido = producto
      ? await cargarComposicion(db, producto).catch((e) => {
          if (e instanceof ComposicionInvalida) return null;
          throw e;
        })
      : null;
    return { recetas, productos, almacenes, elegido };
  }, "inventario:ver");

  const bienes = datos.productos.filter((p) => p.tipo === "bien" && p.activo);

  return (
    <>
      <Encabezado
        titulo="Kits y conversiones"
        descripcion="Un artículo que se convierte en otros sin comprar ni vender nada: un botiquín que se arma con sus piezas, un saco de 50 kg que pasa a ser 50 bolsas de 1 kg."
        acciones={
          <Link href={"/inventario" as Route} className="boton boton-secundario">
            Existencias
          </Link>
        }
      />
      <Contenido>
        {hecho && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {hecho}
          </p>
        )}

        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/inventario/kits">
          <div className="min-w-[320px] flex-1">
            <label className="etiqueta" htmlFor="producto">Producto</label>
            <select id="producto" name="producto" className="campo" defaultValue={producto ?? ""}>
              <option value="" disabled>Elija el producto que resulta</option>
              {bienes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.descripcion}
                </option>
              ))}
            </select>
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {datos.elegido && (
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-sm font-semibold">
                Composición de {datos.elegido.producto.codigo}
              </h2>
              {puedeEditar ? (
                <FormularioReceta
                  productoId={datos.elegido.producto.id}
                  tipoActual={datos.elegido.tipo}
                  componentesActuales={datos.elegido.componentes.map((c) => ({
                    componenteId: c.componenteId,
                    cantidad: money.toString(money.dec(c.cantidad), 6).replace(/0+$/, "").replace(/\.$/, ""),
                  }))}
                  productos={bienes
                    .filter((p) => p.id !== datos.elegido!.producto.id)
                    .map((p) => ({ id: p.id, etiqueta: `${p.codigo} — ${p.descripcion}` }))}
                />
              ) : (
                <div className="tarjeta p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
                  No tiene permiso para editar composiciones.
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">
                {datos.elegido.tipo === "conversion" ? "Convertir" : "Armar o desarmar"}
              </h2>
              {datos.elegido.componentes.length === 0 ? (
                <div className="tarjeta p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
                  Defina primero de qué está hecho.
                </div>
              ) : puedeCrear ? (
                <FormularioProceso
                  productoId={datos.elegido.producto.id}
                  tipo={datos.elegido.tipo}
                  almacenes={datos.almacenes
                    .filter((a) => a.activo && !a.esTransito)
                    .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
                />
              ) : (
                <div className="tarjeta p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
                  No tiene permiso para mover inventario.
                </div>
              )}
            </section>
          </div>
        )}

        <section className="tarjeta overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Productos con composición
          </h2>
          {datos.recetas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay composiciones"
                descripcion="Elija arriba el producto que resulta y diga de qué está hecho."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Unidad</th>
                  <th>Tipo</th>
                  <th className="text-right">Componentes</th>
                </tr>
              </thead>
              <tbody>
                {datos.recetas.map((r) => (
                  <tr key={r.productoId}>
                    <td>
                      <Link
                        href={`/inventario/kits?producto=${r.productoId}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {r.codigo}
                      </Link>
                    </td>
                    <td className="max-w-[280px] truncate">{r.descripcion}</td>
                    <td>{r.unidad}</td>
                    <td>
                      <Insignia>{r.tipo === "conversion" ? "conversión" : "kit"}</Insignia>
                    </td>
                    <td className="cifra">{r.componentes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </Contenido>
    </>
  );
}
