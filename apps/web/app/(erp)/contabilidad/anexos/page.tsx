import Link from "next/link";
import type { Route } from "next";
import { cuentaCorrienteAnexo, listarTerceros } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";

export const metadata = { title: "Cuenta corriente por anexo · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Anexos({
  searchParams,
}: {
  searchParams: Promise<{ tercero?: string; desde?: string; hasta?: string }>;
}) {
  const { tercero, desde, hasta } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const terceros = await listarTerceros(db);
    const cuenta = tercero
      ? await cuentaCorrienteAnexo(db, tercero, {
          ...(desde ? { desde } : {}),
          ...(hasta ? { hasta } : {}),
        }).catch(() => null)
      : null;
    return { terceros, cuenta };
  }, "contabilidad:ver");

  return (
    <>
      <Encabezado
        titulo="Cuenta corriente por anexo"
        descripcion="Todo lo que se movió con un tercero, en todas las cuentas donde aparece. El estado de cuenta mira los documentos; esto mira el mayor, que es donde acaban también los anticipos y las diferencias de cambio."
        acciones={
          <Link href={"/contabilidad" as Route} className="boton boton-secundario">
            Contabilidad
          </Link>
        }
      />
      <Contenido>
        <form className="tarjeta mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/anexos">
          <div className="min-w-[300px] flex-1">
            <label className="etiqueta" htmlFor="tercero">Tercero</label>
            <select id="tercero" name="tercero" className="campo" defaultValue={tercero ?? ""}>
              <option value="" disabled>Elija un tercero</option>
              {datos.terceros.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.razonSocial} · {t.numeroDocumento}
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

          {datos.cuenta && (
            <div className="ml-auto text-right">
              <div className="text-xs" style={{ color: "var(--texto-suave)" }}>Posición neta</div>
              <div className="text-lg font-medium">
                <Importe valor={datos.cuenta.saldoTotal} />
              </div>
            </div>
          )}
        </form>

        {!datos.cuenta ? (
          <Vacio
            titulo="Elija un tercero"
            descripcion="Aquí sale su movimiento contable completo, cuenta por cuenta."
          />
        ) : datos.cuenta.cuentas.length === 0 ? (
          <Vacio
            titulo={`${datos.cuenta.tercero.razonSocial} no tiene movimientos`}
            descripcion="Ningún asiento contabilizado lo menciona en el rango elegido."
          />
        ) : (
          <div className="space-y-5">
            {datos.cuenta.cuentas.map((c) => (
              <section key={c.cuenta} className="tarjeta overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
                  <h2 className="cifra text-sm font-semibold" style={{ textAlign: "left" }}>
                    Cuenta {c.cuenta}
                  </h2>
                  <div className="text-sm">
                    <span style={{ color: "var(--texto-suave)" }}>Saldo </span>
                    <span className="font-medium"><Importe valor={c.saldo} /></span>
                  </div>
                </div>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Asiento</th>
                      <th>Documento</th>
                      <th>Glosa</th>
                      <th className="text-right">Debe</th>
                      <th className="text-right">Haber</th>
                      <th className="text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.movimientos.map((m, i) => (
                      <tr key={`${m.asiento}-${i}`}>
                        <td className="cifra">{m.fecha}</td>
                        <td className="cifra" style={{ textAlign: "left" }}>{m.asiento}</td>
                        <td className="cifra" style={{ textAlign: "left" }}>{m.documento || "—"}</td>
                        <td className="max-w-[280px] truncate">{m.glosa}</td>
                        <td>
                          {m.debe === "0.00" ? (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          ) : (
                            <Importe valor={m.debe} />
                          )}
                        </td>
                        <td>
                          {m.haber === "0.00" ? (
                            <span style={{ color: "var(--texto-suave)" }}>—</span>
                          ) : (
                            <Importe valor={m.haber} />
                          )}
                        </td>
                        <td className="font-medium"><Importe valor={m.saldo} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
              Cada cuenta lleva su propio saldo: lo que se le debe a un proveedor y lo que él debe
              por un anticipo no se compensan solos, y presentarlos juntos esconde las dos cifras.
            </p>
          </div>
        )}
      </Contenido>
    </>
  );
}
