import Link from "next/link";
import { sql } from "drizzle-orm";
import { kardexDe, listarProductos, listarAlmacenes } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Kardex · RoultERP" };
export const dynamic = "force-dynamic";

/** Catálogo 1 de SUNAT, abreviado: la columna es estrecha. */
const DOCUMENTO: Record<string, string> = {
  "01": "FAC", "03": "BOL", "04": "LC", "07": "NC", "08": "ND", "09": "GR",
};

/** Catálogo 12 de SUNAT, con el nombre que entiende el usuario. */
const OPERACION: Record<string, string> = {
  "00": "Saldo inicial",
  "01": "Venta",
  "02": "Compra",
  "03": "Devolución recibida",
  "04": "Devolución entregada",
  "05": "Transferencia entrada",
  "06": "Transferencia salida",
  "10": "Consumo",
  "16": "Ajuste entrada",
  "17": "Ajuste salida",
};

export default async function Kardex({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; almacen?: string; desde?: string; hasta?: string }>;
}) {
  const { producto, almacen, desde, hasta } = await searchParams;

  /*
   * Sin producto o sin almacén se ofrece el selector, no un 404.
   *
   * El kardex se abre desde el inventario, que ya sabe de qué producto y de qué
   * almacén se trata. Pero la pantalla también se alcanza por la dirección, y
   * contestar «no existe» a una pantalla que sí existe es un error que el
   * usuario lee como una función rota.
   */
  const catalogo = await conEmpresa(
    async (db) => ({
      productos: await listarProductos(db, { soloActivos: true }),
      almacenes: await listarAlmacenes(db),
    }),
    "inventario:ver",
  );

  const datos = !producto || !almacen ? null : await conEmpresa(async (db) => {
    const cabecera = (await db.execute(sql`
      SELECT p.codigo, p.descripcion, u.codigo AS unidad, a.nombre AS almacen,
             coalesce(s.cantidad, 0)::text AS saldo_cantidad,
             coalesce(s.valor, 0)::text AS saldo_valor
      FROM productos p
      JOIN unidades_medida u ON u.id = p.unidad_id
      CROSS JOIN almacenes a
      LEFT JOIN saldos_inventario s ON s.producto_id = p.id AND s.almacen_id = a.id
      WHERE p.id = ${producto} AND a.id = ${almacen}`)) as unknown as {
      codigo: string;
      descripcion: string;
      unidad: string;
      almacen: string;
      saldo_cantidad: string;
      saldo_valor: string;
    }[];

    if (cabecera.length === 0) return null;
    const lineas = await kardexDe(db, almacen, producto, {
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
    });
    return { cabecera: cabecera[0]!, lineas };
  }, "inventario:ver");

  const lineas = datos?.lineas ?? [];

  // El saldo corrido se reconstruye recorriendo las líneas, que es exactamente
  // lo que el formato 13.1 del PLE espera ver impreso.
  let cantidad = money.ZERO;
  let valor = money.ZERO;
  const filas = lineas.map((l) => {
    const cant = money.dec(l.cantidad);
    const importe = money.dec(l.importeTotal);
    if (l.sentido === "ingreso") {
      cantidad = money.add(cantidad, cant);
      valor = money.add(valor, importe);
    } else {
      cantidad = money.sub(cantidad, cant);
      valor = money.sub(valor, importe);
    }
    if (money.isZero(cantidad)) valor = money.ZERO;
    return { l, saldoCantidad: cantidad, saldoValor: valor };
  });

  return (
    <>
      <Encabezado
        titulo={datos ? `Kardex · ${datos.cabecera.codigo}` : "Kardex"}
        descripcion={
          datos
            ? `${datos.cabecera.descripcion} · ${datos.cabecera.almacen} · unidad ${datos.cabecera.unidad}`
            : "Elija el producto y el almacén cuyo movimiento quiere ver."
        }
        acciones={
          <>
            <Imprimir />
            <Link href="/inventario" className="boton boton-secundario">
              Volver
            </Link>
          </>
        }
      />
      <Contenido>
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-[20rem]">
            <label className="etiqueta" htmlFor="producto">Producto</label>
            <select id="producto" name="producto" defaultValue={producto ?? ""} className="campo" required>
              <option value="" disabled>Elija un producto</option>
              {catalogo.productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.descripcion}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[12rem]">
            <label className="etiqueta" htmlFor="almacen">Almacén</label>
            <select id="almacen" name="almacen" defaultValue={almacen ?? ""} className="campo" required>
              <option value="" disabled>Elija un almacén</option>
              {catalogo.almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={desde ?? ""} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta ?? ""} className="campo" />
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {!datos ? (
          <Vacio
            titulo="Elija producto y almacén"
            descripcion="El kardex es de un producto en un almacén: el mismo artículo tiene una historia distinta en cada uno. También se llega desde el inventario."
            accion={
              <Link href="/inventario" className="boton boton-secundario">
                Ir al inventario
              </Link>
            }
          />
        ) : filas.length === 0 ? (
          <Vacio
            titulo="Sin movimientos"
            descripcion="Este producto todavía no ha entrado ni salido de este almacén."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th rowSpan={2}>Fecha</th>
                  <th rowSpan={2}>Operación</th>
                  <th rowSpan={2}>Referencia</th>
                  <th colSpan={3} className="!text-center">
                    Entradas
                  </th>
                  <th colSpan={3} className="!text-center">
                    Salidas
                  </th>
                  <th colSpan={3} className="!text-center">
                    Saldo
                  </th>
                </tr>
                <tr>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">C. unit.</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">C. unit.</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">C. unit.</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ l, saldoCantidad, saldoValor }) => {
                  const entrada = l.sentido === "ingreso";
                  const capas = Array.isArray(l.consumos) ? l.consumos.length : 0;
                  return (
                    <tr key={l.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>
                        {l.fecha}
                      </td>
                      <td>
                        {OPERACION[l.tipoOperacion] ?? l.tipoOperacion}
                        {capas > 1 && (
                          <span className="ml-1.5">
                            <Insignia>{capas} capas</Insignia>
                          </span>
                        )}
                      </td>
                      <td style={{ color: "var(--texto-suave)" }}>
                        {l.refDocumento ? (
                          <>
                            <span className="cifra">
                              {l.refTipo ? `${DOCUMENTO[l.refTipo] ?? l.refTipo} ` : ""}
                              {l.refDocumento}
                            </span>
                            {l.tercero && (
                              <div className="truncate text-xs" title={l.tercero}>
                                {l.tercero}
                              </div>
                            )}
                          </>
                        ) : (
                          (l.origenModulo ?? "—")
                        )}
                      </td>

                      <td>{entrada ? <Importe valor={l.cantidad} /> : null}</td>
                      <td>{entrada ? <Importe valor={l.costoUnitario} decimales={4} /> : null}</td>
                      <td>{entrada ? <Importe valor={l.importeTotal} /> : null}</td>

                      <td>{!entrada ? <Importe valor={l.cantidad} /> : null}</td>
                      <td>{!entrada ? <Importe valor={l.costoUnitario} decimales={4} /> : null}</td>
                      <td>{!entrada ? <Importe valor={l.importeTotal} /> : null}</td>

                      <td>
                        <Importe valor={money.toString(saldoCantidad, 2)} />
                      </td>
                      <td>
                        <Importe
                          valor={
                            money.isZero(saldoCantidad)
                              ? "0"
                              : money.toString(money.div(saldoValor, saldoCantidad), 4)
                          }
                          decimales={4}
                        />
                      </td>
                      <td>
                        <Importe valor={money.toString(saldoValor, 2)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--superficie-2)" }}>
                  <td colSpan={9} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                    Saldo según movimientos
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(cantidad, 2)} />
                  </td>
                  <td />
                  <td className="px-3 py-2 font-semibold">
                    <Importe valor={money.toString(valor, 2)} />
                  </td>
                </tr>
                {/* Si esta fila no coincide con la de arriba, el saldo almacenado
                    se separó de sus movimientos y hay que recalcular el kardex. */}
                <tr
                  style={{
                    background: "var(--superficie-2)",
                    color: money.eq(money.dec(datos.cabecera.saldo_valor), money.round(valor, 6))
                      ? "var(--texto-suave)"
                      : "var(--peligro)",
                  }}
                >
                  <td colSpan={9} className="px-3 py-2 text-right text-xs uppercase">
                    Saldo almacenado
                  </td>
                  <td className="px-3 py-2">
                    <Importe valor={datos.cabecera.saldo_cantidad} />
                  </td>
                  <td />
                  <td className="px-3 py-2">
                    <Importe valor={datos.cabecera.saldo_valor} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
