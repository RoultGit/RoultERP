import Link from "next/link";
import type { Route } from "next";
import { estadoCuentaCliente, listarTerceros } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Estado de cuenta de cliente · RoultERP" };
export const dynamic = "force-dynamic";

export default async function EstadoCuentaCliente({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; desde?: string; hasta?: string }>;
}) {
  const { cliente, desde, hasta } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const clientes = await listarTerceros(db, { rol: "cliente" });
    const cuentas = cliente
      ? await estadoCuentaCliente(db, cliente, {
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
        })
      : [];
    return { clientes, cuentas };
  }, "cxc:ver");

  const elegido = datos.clientes.find((c) => c.id === cliente);

  return (
    <>
      <Encabezado
        titulo="Estado de cuenta de cliente"
        descripcion="Lo que se le facturó y lo que pagó, en orden y con el saldo corriendo. Es lo que se le manda cuando discute una deuda."
        acciones={
          <>
            <Imprimir />
            <Link href={"/cxc" as Route} className="boton boton-secundario">
              Cuentas por cobrar
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="bloque filtro mb-5 flex flex-wrap items-end gap-3 p-4" action="/cxc/estado-cuenta">
          <div className="min-w-[280px] flex-1">
            <label className="etiqueta" htmlFor="cliente">Cliente</label>
            <select id="cliente" name="cliente" className="campo" defaultValue={cliente ?? ""}>
              <option value="" disabled>Elija un cliente</option>
              {datos.clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razonSocial} · {c.numeroDocumento}
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

        {!cliente ? (
          <Vacio
            titulo="Elija un cliente"
            descripcion="La antigüedad dice cuánto debe; esto dice por qué."
          />
        ) : datos.cuentas.length === 0 ? (
          <Vacio
            titulo={`${elegido?.razonSocial ?? "El cliente"} no tiene movimientos`}
            descripcion="Ni comprobantes ni cobranzas en el rango elegido."
          />
        ) : (
          <div className="space-y-5">
            {datos.cuentas.map((c) => (
              <section key={c.moneda} className="bloque overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
                  <h2 className="text-sm font-semibold">Movimientos en {c.moneda}</h2>
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
                      <th>Documento</th>
                      <th>Referencia</th>
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
                          <Insignia tono={m.tipo === "cobranza" ? "exito" : "neutro"}>
                            {m.glosa}
                          </Insignia>
                        </td>
                        <td className="cifra" style={{ textAlign: "left" }}>{m.referencia}</td>
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
          </div>
        )}
      </Contenido>
    </>
  );
}
