import { sql } from "drizzle-orm";
import { listarAlmacenes, listarSucursales } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";
import { FormularioSucursal } from "./sucursal";

export const metadata = { title: "Almacenes y sucursales · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Almacenes() {
  const datos = await conEmpresa(async (db) => {
    const sucursales = await listarSucursales(db);
    const cuantos = (await db.execute(sql`
      SELECT sucursal_id, count(*)::int AS almacenes
      FROM almacenes GROUP BY sucursal_id`)) as unknown as {
      sucursal_id: string | null; almacenes: number;
    }[];
    const almacenesPor = new Map([...cuantos].map((c) => [c.sucursal_id, c.almacenes]));

    // El valor por almacén sale del kardex, que es lo que hace útil la lista:
    // dice dónde está la mercadería, no sólo qué almacenes existen.
    const valor = (await db.execute(sql`
      SELECT a.id, coalesce(sum(s.valor), 0)::text AS valor,
             count(*) FILTER (WHERE s.cantidad > 0)::int AS productos
      FROM almacenes a
      LEFT JOIN saldos_inventario s ON s.almacen_id = a.id
      GROUP BY a.id`)) as unknown as { id: string; valor: string; productos: number }[];

    return {
      sucursales,
      almacenesPor,
      almacenes: await listarAlmacenes(db),
      valor: new Map([...valor].map((v) => [v.id, v])),
    };
  }, "maestros:ver");

  return (
    <>
      <Encabezado
        titulo="Almacenes y sucursales"
        descripcion="Los establecimientos de la empresa. El kardex se lleva por almacén, y el código SUNAT de la sucursal es el que va en el inventario valorizado."
        acciones={<BotonEnlace href="/maestros" variante="secundario">Maestros</BotonEnlace>}
      />
      <Contenido>
        <section className="tarjeta mb-5 overflow-x-auto">
          <div
            className="flex items-center justify-between border-b px-4 py-2.5"
            style={{ borderColor: "var(--borde)" }}
          >
            <h2 className="text-sm font-semibold">Sucursales</h2>
            <FormularioSucursal />
          </div>
          {datos.sucursales.length === 0 ? (
            <div className="p-4"><Vacio titulo="Sin sucursales" /></div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Dirección</th>
                  <th>Ubigeo</th>
                  <th>Cód. SUNAT</th>
                  <th className="text-right">Almacenes</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datos.sucursales.map((s) => (
                  <tr key={s.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{s.codigo}</td>
                    <td>{s.nombre}</td>
                    <td className="max-w-[280px] truncate" style={{ color: "var(--texto-suave)" }}>
                      {s.direccion ?? "—"}
                    </td>
                    <td className="cifra">
                      {s.ubigeo ?? (
                        <span style={{ color: "var(--alerta)" }} title="Sin ubigeo, las guías de remisión salen con el punto de partida vacío">
                          falta
                        </span>
                      )}
                    </td>
                    <td className="cifra">{s.codigoSunat ?? "0000"}</td>
                    <td className="cifra text-right">{datos.almacenesPor.get(s.id) ?? 0}</td>
                    <td>
                      {s.activa ? (
                        <Insignia tono="exito">activa</Insignia>
                      ) : (
                        <Insignia tono="peligro">inactiva</Insignia>
                      )}
                    </td>
                    <td className="text-right">
                      <FormularioSucursal
                        sucursal={{
                          id: s.id,
                          codigo: s.codigo,
                          nombre: s.nombre,
                          direccion: s.direccion,
                          ubigeo: s.ubigeo,
                          codigoSunat: s.codigoSunat,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="tarjeta overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Almacenes
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Sucursal</th>
                <th className="text-right">Productos con stock</th>
                <th className="text-right">Valorizado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.almacenes.map((a) => {
                const v = datos.valor.get(a.id);
                return (
                  <tr key={a.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{a.codigo}</td>
                    <td>{a.nombre}</td>
                    <td style={{ color: "var(--texto-suave)" }}>{a.sucursal ?? "—"}</td>
                    <td className="cifra text-right">{v?.productos ?? 0}</td>
                    <td><Importe valor={v?.valor ?? "0"} /></td>
                    <td>
                      {a.activo ? (
                        <Insignia tono="exito">activo</Insignia>
                      ) : (
                        <Insignia tono="peligro">inactivo</Insignia>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </Contenido>
    </>
  );
}
