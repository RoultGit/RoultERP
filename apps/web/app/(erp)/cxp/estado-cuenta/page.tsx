import Link from "next/link";
import type { Route } from "next";
import { estadoCuentaProveedor, listarTerceros } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Estado de cuenta de proveedor · RoultERP" };
export const dynamic = "force-dynamic";

export default async function EstadoCuenta({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string; desde?: string; hasta?: string }>;
}) {
  const { proveedor, desde, hasta } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const proveedores = await listarTerceros(db, { rol: "proveedor" });
    const cuentas = proveedor
      ? await estadoCuentaProveedor(db, proveedor, {
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
        })
      : [];
    return { proveedores, cuentas };
  }, "cxp:ver");

  const elegido = datos.proveedores.find((p) => p.id === proveedor);

  return (
    <>
      <Encabezado
        titulo="Estado de cuenta de proveedor"
        descripcion="Todo lo que se le debió y todo lo que se le pagó, en orden y con el saldo corriendo. La antigüedad dice cuánto se debe; esto dice por qué."
        acciones={
          <>
            <Imprimir />
            <Link href={"/cxp" as Route} className="boton boton-secundario">
              Cuentas por pagar
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="tarjeta filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/cxp/estado-cuenta">
          <div className="min-w-[280px] flex-1">
            <label className="etiqueta" htmlFor="proveedor">Proveedor</label>
            <select id="proveedor" name="proveedor" className="campo" defaultValue={proveedor ?? ""}>
              <option value="" disabled>Elija un proveedor</option>
              {datos.proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razonSocial} · {p.numeroDocumento}
                </option>
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

        {!proveedor ? (
          <Vacio
            titulo="Elija un proveedor"
            descripcion="El estado de cuenta es lo que se le manda cuando reclama, y lo que se concilia con el suyo."
          />
        ) : datos.cuentas.length === 0 ? (
          <Vacio
            titulo={`${elegido?.razonSocial ?? "El proveedor"} no tiene movimientos`}
            descripcion="Ni documentos por pagar ni pagos en el rango elegido."
          />
        ) : (
          <div className="space-y-5">
            {datos.cuentas.map((c) => (
              <section key={c.moneda} className="tarjeta overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
                  <h2 className="text-sm font-semibold">
                    Movimientos en {c.moneda}
                  </h2>
                  <div className="text-sm">
                    <span style={{ color: "var(--texto-suave)" }}>Saldo </span>
                    <span className="font-medium">
                      <Importe valor={c.saldoFinal} moneda={c.moneda} />
                    </span>
                  </div>
                </div>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Referencia</th>
                      <th>Glosa</th>
                      <th className="text-right">Cargo</th>
                      <th className="text-right">Abono</th>
                      <th className="text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.movimientos.map((m, i) => (
                      <tr key={`${m.tipo}-${m.referencia}-${i}`}>
                        <td className="cifra">{m.fecha}</td>
                        <td>
                          <Insignia tono={m.tipo === "pago" ? "exito" : "neutro"}>
                            {m.tipo}
                          </Insignia>
                        </td>
                        <td className="cifra" style={{ textAlign: "left" }}>{m.referencia}</td>
                        <td className="max-w-[240px] truncate">{m.glosa}</td>
                        <td>
                          {m.cargo === "0.00" ? (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          ) : (
                            <Importe valor={m.cargo} moneda={c.moneda} />
                          )}
                        </td>
                        <td>
                          {m.abono === "0.00" ? (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          ) : (
                            <Importe valor={m.abono} moneda={c.moneda} />
                          )}
                        </td>
                        <td className="font-medium">
                          <Importe valor={m.saldo} moneda={c.moneda} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
              Cada moneda lleva su propia serie: sumar soles con dólares daría una cifra que no
              significa nada.
            </p>
          </div>
        )}
      </Contenido>
    </>
  );
}
