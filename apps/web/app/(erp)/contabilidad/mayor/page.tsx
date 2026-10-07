import Link from "next/link";
import type { Route } from "next";
import { mayorDeCuenta, listarCuentas } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Vacio } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Mayor · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Mayor({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; periodo?: string }>;
}) {
  const { cuenta, periodo } = await searchParams;

  /*
   * Sin cuenta no se devuelve 404.
   *
   * Al mayor se llega desde el balance, con la cuenta en la dirección, pero
   * también se llega escribiendo la dirección o volviendo desde un marcador.
   * Antes eso era `notFound()`: la pantalla existía y contestaba «no existe».
   * Ahora ofrece el selector, que es lo que el usuario venía a hacer.
   */
  const cuentas = await conEmpresa((db) => listarCuentas(db, true), "contabilidad:ver");

  const filas = !cuenta ? [] : (await conEmpresa(
    (db) => mayorDeCuenta(db, cuenta, periodo),
    "contabilidad:ver",
  )) as unknown as {
    fecha: string;
    numero: string;
    glosa_asiento: string;
    glosa: string | null;
    debe: string;
    haber: string;
    documento_tipo: string | null;
    documento_serie: string | null;
    documento_numero: string | null;
  }[];

  // El saldo corrido se calcula recorriendo el mayor, que es como se lee: cada
  // línea muestra en qué quedó la cuenta después de ese movimiento.
  let saldo = money.ZERO;
  const conSaldo = filas.map((f) => {
    saldo = money.add(saldo, money.sub(money.dec(f.debe), money.dec(f.haber)));
    return { ...f, saldo };
  });

  return (
    <>
      <Encabezado
        titulo={cuenta ? `Mayor de la cuenta ${cuenta}` : "Mayor de cuentas"}
        descripcion={
          !cuenta
            ? "Elija la cuenta cuyo movimiento quiere ver."
            : periodo
              ? `Periodo ${periodo}`
              : "Todos los periodos"
        }
        acciones={
          <>
            <Imprimir />
            <Link
              href={(periodo ? `/contabilidad?periodo=${periodo}` : "/contabilidad") as Route}
              className="boton boton-secundario"
            >
              Volver al balance
            </Link>
          </>
        }
      />
      <Contenido>
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-[22rem]">
            <label className="etiqueta" htmlFor="cuenta">Cuenta</label>
            <select id="cuenta" name="cuenta" defaultValue={cuenta ?? ""} className="campo" required>
              <option value="" disabled>Elija una cuenta</option>
              {cuentas.map((c) => (
                <option key={c.cuenta} value={c.cuenta}>
                  {c.cuenta} · {c.descripcion}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo"
              name="periodo"
              defaultValue={periodo ?? ""}
              placeholder="202610"
              inputMode="numeric"
              pattern="[0-9]{6}"
              className="campo w-32"
            />
          </div>
          <button className="boton boton-primario">Ver</button>
        </form>

        {!cuenta ? (
          <Vacio
            titulo="Elija una cuenta"
            descripcion="El mayor se lee cuenta por cuenta. También se llega desde el balance de comprobación, pulsando el código de la cuenta."
            accion={
              <Link href="/contabilidad" className="boton boton-secundario">
                Ir al balance
              </Link>
            }
          />
        ) : conSaldo.length === 0 ? (
          <Vacio titulo="Sin movimientos" descripcion="Esta cuenta no tiene asientos en el periodo." />
        ) : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Asiento</th>
                  <th>Glosa</th>
                  <th>Documento</th>
                  <th className="text-right">Debe</th>
                  <th className="text-right">Haber</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {conSaldo.map((f, i) => (
                  <tr key={`${f.numero}-${i}`}>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.fecha}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.numero}</td>
                    <td className="max-w-[300px] truncate">{f.glosa ?? f.glosa_asiento}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {f.documento_serie ? `${f.documento_serie}-${f.documento_numero}` : "—"}
                    </td>
                    <td><Importe valor={f.debe} /></td>
                    <td><Importe valor={f.haber} /></td>
                    <td><strong><Importe valor={money.toString(f.saldo, 2)} /></strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
