import Link from "next/link";
import type { Route } from "next";
import { preciosHistoricos, listarProductos } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Precios históricos · RoultERP" };
export const dynamic = "force-dynamic";

/** Variación contra la compra anterior, con el signo a la vista. */
function Variacion({ valor }: { valor: string | null }) {
  if (valor === null) {
    return <span style={{ color: "var(--texto-suave)" }}>—</span>;
  }
  const n = Number(valor);
  const color = n > 0 ? "var(--peligro)" : n < 0 ? "var(--exito)" : "var(--texto-suave)";
  return (
    <span className="cifra" style={{ color }}>
      {n > 0 ? "+" : ""}
      {valor} %
    </span>
  );
}

export default async function Precios({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; q?: string }>;
}) {
  const { producto, q } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const productos = await listarProductos(db, q ? { busqueda: q } : undefined);
    const elegido = producto ?? productos[0]?.id ?? null;
    return {
      productos,
      elegido,
      historia: elegido ? await preciosHistoricos(db, elegido) : [],
    };
  }, "compras:ver");

  const elegido = datos.productos.find((p) => p.id === datos.elegido);
  const conCosto = datos.historia.some((h) => h.costoUnitarioSoles !== null);

  return (
    <>
      <Encabezado
        titulo="Precios históricos"
        descripcion="A cuánto se compró cada vez, aquí y en el exterior. Es lo que evita aceptar un alza porque nadie recordaba el precio de la vez anterior."
        acciones={
          <>
            <Imprimir />
            <Link href={"/compras" as Route} className="boton boton-secundario">
              Compras
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="bloque filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/compras/precios">
          <div className="min-w-[200px]">
            <label className="etiqueta" htmlFor="q">Buscar producto</label>
            <input
              id="q" name="q" defaultValue={q ?? ""} className="campo"
              placeholder="Código o descripción" />
          </div>
          <div className="min-w-[280px] flex-1">
            <label className="etiqueta" htmlFor="producto">Producto</label>
            <select id="producto" name="producto" className="campo" defaultValue={datos.elegido ?? ""}>
              {datos.productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.descripcion}
                </option>
              ))}
            </select>
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {datos.historia.length === 0 ? (
          <Vacio
            titulo={elegido ? `Sin compras de ${elegido.codigo}` : "Elija un producto"}
            descripcion="Aquí aparecen las compras locales y los embarques importados de este artículo, del más reciente al más antiguo."
          />
        ) : (
          <section className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Documento</th>
                  <th>Proveedor</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Precio</th>
                  <th className="text-right">Precio en S/</th>
                  <th className="text-right">Variación</th>
                  <th className="text-right">Costo en almacén</th>
                </tr>
              </thead>
              <tbody>
                {datos.historia.map((h) => (
                  <tr key={`${h.origen}-${h.documento}-${h.fecha}`}>
                    <td className="cifra" style={{ textAlign: "left" }}>{h.fecha}</td>
                    <td>
                      <Insignia>{h.origen === "importacion" ? "importación" : "compra"}</Insignia>
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>{h.documento}</td>
                    <td className="max-w-[220px] truncate">{h.proveedor}</td>
                    <td><Importe valor={h.cantidad} /></td>
                    <td><Importe valor={h.valorUnitario} decimales={4} moneda={h.moneda} /></td>
                    <td><Importe valor={h.valorUnitarioSoles} decimales={4} /></td>
                    <td className="text-right"><Variacion valor={h.variacion} /></td>
                    <td>
                      {h.costoUnitarioSoles === null ? (
                        <span style={{ color: "var(--texto-suave)" }}>
                          {h.origen === "importacion" ? "sin liquidar" : "—"}
                        </span>
                      ) : (
                        <Importe valor={h.costoUnitarioSoles} decimales={4} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {conCosto && (
          <p className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
            En un embarque, el precio es el FOB del exportador y el costo en almacén es lo que salió
            de la liquidación, con el flete, los derechos y la agencia ya prorrateados. Comparar el
            FOB de una importación con el precio de una compra local es comparar dos cosas
            distintas: es el camino más corto para creer que importar sale más barato de lo que sale.
          </p>
        )}
      </Contenido>
    </>
  );
}
