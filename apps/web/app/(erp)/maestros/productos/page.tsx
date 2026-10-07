import Link from "next/link";
import type { Route } from "next";
import { listarProductos } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";
import { desactivarProductoAccion } from "../acciones";

export const metadata = { title: "Productos · RoultERP" };
export const dynamic = "force-dynamic";

/** Catálogo 07 de SUNAT, resumido a lo que se ve en una lista. */
const AFECTACION: Record<string, string> = {
  "10": "Gravado",
  "20": "Exonerado",
  "30": "Inafecto",
  "40": "Exportación",
};

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { q } = params;
  const pagina = paginaDe(params.pagina);
  const filas = await conEmpresa(
    (db) => listarProductos(db, q ? { busqueda: q } : undefined),
    "maestros:ver",
  );
  const puedeCrear = await tienePermiso("maestros:crear");
  const puedeAnular = await tienePermiso("maestros:anular");

  return (
    <>
      <Encabezado
        titulo="Productos"
        descripcion="Bienes y servicios. Sólo los bienes llevan kardex."
        acciones={
          <>
            <BotonEnlace href="/maestros" variante="secundario">Maestros</BotonEnlace>
            {puedeCrear && <BotonEnlace href="/maestros/productos/nuevo">Nuevo producto</BotonEnlace>}
          </>
        }
      />
      <Contenido>
        <form className="flex gap-2" action="/maestros/productos">
          <input
            name="q"
            defaultValue={q ?? ""}
            className="campo max-w-xs"
            placeholder="Buscar por código o descripción"
            aria-label="Buscar productos"
          />
          <button className="boton boton-secundario">Buscar</button>
          {q && <Link href="/maestros/productos" className="boton boton-secundario">Limpiar</Link>}
        </form>

        {filas.length === 0 ? (
          <Vacio
            titulo={q ? "Sin resultados" : "Todavía no hay productos"}
            descripcion={q ? `Nada coincide con «${q}».` : "Registre su catálogo para poder comprar, importar y vender."}
            accion={puedeCrear && !q ? <BotonEnlace href="/maestros/productos/nuevo">Nuevo producto</BotonEnlace> : null}
          />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Tipo</th>
                  <th>Unidad</th>
                  <th>IGV</th>
                  <th className="text-right">Peso (kg)</th>
                  <th className="text-right">Stock mín.</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {rodaja(filas, pagina).map((p) => (
                  <tr key={p.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      <Link href={`/maestros/productos/${p.id}` as Route} className="underline">{p.codigo}</Link>
                    </td>
                    <td className="max-w-[320px] truncate">{p.descripcion}</td>
                    <td>{p.tipo === "servicio" ? <Insignia tono="alerta">servicio</Insignia> : <Insignia>bien</Insignia>}</td>
                    <td>{p.unidad}</td>
                    <td style={{ color: "var(--texto-suave)" }}>{AFECTACION[p.afectacionIgv] ?? p.afectacionIgv}</td>
                    <td><Importe valor={p.pesoUnitario} decimales={3} /></td>
                    <td><Importe valor={p.stockMinimo} /></td>
                    <td>
                      {puedeAnular && (
                        <form action={desactivarProductoAccion}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs underline" style={{ color: "var(--peligro)" }}>
                            Desactivar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginacion total={filas.length} pagina={pagina} params={params} etiqueta="productos" />
          </div>
        )}
      </Contenido>
    </>
  );
}
