import Link from "next/link";
import type { Route } from "next";
import { listarTerceros } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";

export const metadata = { title: "Clientes y proveedores · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "0": "S/D", "1": "DNI", "4": "CE", "6": "RUC", "7": "Pas.", A: "CD",
};

export default async function Terceros({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; rol?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { q, rol } = params;
  const pagina = paginaDe(params.pagina);
  const filas = await conEmpresa(
    (db) =>
      listarTerceros(db, {
        ...(q ? { busqueda: q } : {}),
        ...(rol === "cliente" || rol === "proveedor" ? { rol } : {}),
      }),
    "maestros:ver",
  );
  const puedeCrear = await tienePermiso("maestros:crear");

  return (
    <>
      <Encabezado
        titulo="Clientes y proveedores"
        descripcion="Una sola ficha por documento: el mismo tercero suele ser las dos cosas."
        acciones={
          <>
            <BotonEnlace href="/maestros" variante="secundario">Maestros</BotonEnlace>
            {puedeCrear && <BotonEnlace href="/maestros/terceros/nuevo">Nuevo tercero</BotonEnlace>}
          </>
        }
      />
      <Contenido>
        <form className="flex flex-wrap gap-2" action="/maestros/terceros">
          <input
            name="q" defaultValue={q ?? ""} className="campo max-w-xs"
            placeholder="Buscar por nombre o documento" aria-label="Buscar terceros"
          />
          <select name="rol" defaultValue={rol ?? ""} className="campo max-w-[160px]" aria-label="Filtrar por rol">
            <option value="">Todos</option>
            <option value="cliente">Sólo clientes</option>
            <option value="proveedor">Sólo proveedores</option>
          </select>
          <button className="boton boton-secundario">Filtrar</button>
          {(q || rol) && <Link href="/maestros/terceros" className="boton boton-secundario">Limpiar</Link>}
        </form>

        {filas.length === 0 ? (
          <Vacio
            titulo={q || rol ? "Sin resultados" : "Todavía no hay terceros"}
            descripcion="Registre a sus clientes y proveedores para poder emitir y recibir documentos."
            accion={puedeCrear && !q && !rol ? <BotonEnlace href="/maestros/terceros/nuevo">Nuevo tercero</BotonEnlace> : null}
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Razón social</th>
                  <th>País</th>
                  <th>Relación</th>
                  <th className="text-right">Días créd.</th>
                  <th className="text-right">Límite</th>
                </tr>
              </thead>
              <tbody>
                {rodaja(filas, pagina).map((t) => (
                  <tr key={t.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      <Link href={`/maestros/terceros/${t.id}` as Route} className="underline">
                        {DOCUMENTO[t.tipoDocumento] ?? t.tipoDocumento} {t.numeroDocumento}
                      </Link>
                    </td>
                    <td className="max-w-[300px] truncate">{t.razonSocial}</td>
                    <td>{t.pais}</td>
                    <td className="space-x-1">
                      {t.esCliente && <Insignia>cliente</Insignia>}
                      {t.esProveedor && <Insignia>proveedor</Insignia>}
                      {!t.esDomiciliado && <Insignia tono="alerta">no domiciliado</Insignia>}
                    </td>
                    <td className="cifra">{t.diasCredito}</td>
                    <td><Importe valor={t.limiteCredito} moneda={t.monedaLimite} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginacion total={filas.length} pagina={pagina} params={params} etiqueta="terceros" />
          </div>
        )}
      </Contenido>
    </>
  );
}
