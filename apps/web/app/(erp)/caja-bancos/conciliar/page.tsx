import Link from "next/link";
import type { Route } from "next";
import { eq, inArray } from "drizzle-orm";
import {
  cuentasConSaldo, proponerConciliacion, estadoConciliacion,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioExtracto, FormularioConciliar } from "../formularios";

export const metadata = { title: "Conciliación bancaria · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Conciliar({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string }>;
}) {
  const { cuenta } = await searchParams;

  const datos = !cuenta ? null : await conEmpresa(async (db) => {
    const cuentas = await cuentasConSaldo(db);
    const elegida = cuentas.find((c) => c.id === cuenta);
    if (!elegida) return null;

    const propuestas = await proponerConciliacion(db, cuenta);
    const estado = await estadoConciliacion(db, cuenta);

    // Se traen los datos de ambos lados para poder mostrar qué se está
    // apareando con qué: confirmar a ciegas no es conciliar.
    const extractoIds = propuestas.map((p) => p.extractoId);
    const movimientoIds = propuestas.map((p) => p.movimientoId);

    const lineasExtracto = extractoIds.length
      ? await db
          .select()
          .from(schema.extractoBancario)
          .where(inArray(schema.extractoBancario.id, extractoIds))
      : [];
    const movimientos = movimientoIds.length
      ? await db
          .select()
          .from(schema.movimientosEfectivo)
          .where(inArray(schema.movimientosEfectivo.id, movimientoIds))
      : [];

    return { cuenta: elegida, propuestas, estado, lineasExtracto, movimientos };
  }, "caja_bancos:ver");

  /*
   * Sin cuenta elegida se ofrece elegirla, en vez de devolver 404.
   *
   * La conciliación se abre desde la cuenta bancaria, pero la pantalla también
   * se alcanza escribiendo la dirección. Antes contestaba «no existe» a una
   * pantalla que existe, y eso se lee como una función rota. El retorno
   * temprano mantiene el render de abajo sin un solo `null` que comprobar.
   */
  if (!datos) return <ElegirCuenta />;

  const { cuenta: cta, propuestas, estado, lineasExtracto, movimientos } = datos;
  const puedeConciliar = await tienePermiso("caja_bancos:aprobar");
  const puedeImportar = await tienePermiso("caja_bancos:crear");

  const vista = propuestas.flatMap((p) => {
    const e = lineasExtracto.find((x) => x.id === p.extractoId);
    const m = movimientos.find((x) => x.id === p.movimientoId);
    if (!e || !m) return [];
    return [
      {
        clave: `${p.extractoId}|${p.movimientoId}`,
        motivo: p.motivo,
        extracto: { fecha: e.fecha, descripcion: e.descripcion, importe: e.importe },
        movimiento: {
          fecha: m.fecha,
          concepto: m.concepto,
          importe: m.importe,
          sentido: m.sentido,
        },
      },
    ];
  });

  return (
    <>
      <Encabezado
        titulo={`Conciliación · ${cta.nombre}`}
        descripcion={[cta.banco, cta.numero_cuenta].filter(Boolean).join(" · ")}
        acciones={
          <Link href={`/caja-bancos/${cta.id}` as Route} className="boton boton-secundario">
            Ver la cuenta
          </Link>
        }
      />
      <Contenido>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Tarjeta titulo="Saldo según el libro" valor={money.toString(estado.saldoLibro, 2)} />
          <Tarjeta titulo="Saldo según el banco" valor={money.toString(estado.saldoBanco, 2)} />
          <Tarjeta
            titulo="Diferencia"
            valor={money.toString(estado.diferencia, 2)}
            alerta={!money.isZero(money.round(estado.diferencia, 2))}
          />
        </div>

        <p className="mb-5 text-sm" style={{ color: "var(--texto-suave)" }}>
          La diferencia debe explicarse enteramente por lo que está en tránsito y por lo que el
          banco cobró sin que nadie lo registrara. Lo que sobre después de eso es un error real.
        </p>

        {vista.length > 0 && (
          <section className="bloque mb-5 overflow-x-auto">
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
              <h2 className="text-sm font-semibold">Parejas propuestas</h2>
              <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                Nada se concilia sin que alguien lo confirme
              </span>
            </div>
            {puedeConciliar ? (
              <FormularioConciliar cuentaId={cta.id} propuestas={vista} />
            ) : (
              <p className="p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
                No tiene permiso para conciliar.
              </p>
            )}
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="bloque overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              En tránsito · movimientos que el banco aún no reconoce
            </h2>
            {estado.enTransito.length === 0 ? (
              <div className="p-4"><Vacio titulo="Nada en tránsito" /></div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {estado.enTransito.map((m) => (
                    <tr key={m.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>{m.fecha}</td>
                      <td className="max-w-[240px] truncate">{m.concepto}</td>
                      <td>
                        <span className={m.sentido === "egreso" ? "cifra negativo" : "cifra"}>
                          {m.sentido === "egreso" ? "−" : ""}
                          <Importe valor={m.importe} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bloque overflow-x-auto">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
              Sin registrar · lo que el banco movió y nadie anotó
            </h2>
            {estado.noRegistrados.length === 0 ? (
              <div className="p-4"><Vacio titulo="Nada pendiente de registrar" /></div>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {estado.noRegistrados.map((l) => (
                    <tr key={l.id}>
                      <td className="cifra" style={{ textAlign: "left" }}>{l.fecha}</td>
                      <td className="max-w-[240px] truncate">{l.descripcion}</td>
                      <td><Importe valor={l.importe} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {estado.noRegistrados.length > 0 && (
              <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
                Cada una de estas líneas necesita su movimiento: regístrelo desde la cuenta y
                vuelva a conciliar.
              </p>
            )}
          </section>
        </div>

        {puedeImportar && (
          <section className="bloque mt-5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Importar extracto</h2>
            <FormularioExtracto cuentaId={cta.id} />
          </section>
        )}
      </Contenido>
    </>
  );
}

function Tarjeta({
  titulo,
  valor,
  alerta,
}: {
  titulo: string;
  valor: string;
  alerta?: boolean;
}) {
  return (
    <div className="bloque p-4">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--texto-suave)" }}>
        {titulo}
      </div>
      <div
        className="cifra mt-1.5 text-2xl font-semibold"
        style={{ textAlign: "left", color: alerta ? "var(--peligro)" : undefined }}
      >
        <span className="mr-1 text-base opacity-60">S/</span>
        <Importe valor={valor} />
      </div>
    </div>
  );
}

/**
 * Pantalla de «elija la cuenta», para cuando se llega sin ninguna.
 *
 * Vuelve a consultar las cuentas en vez de recibirlas: así el camino normal
 * —que llega con la cuenta en la dirección— no paga una consulta que no usa.
 */
async function ElegirCuenta() {
  const cuentas = await conEmpresa((db) => cuentasConSaldo(db), "caja_bancos:ver");
  return (
    <>
      <Encabezado
        titulo="Conciliación bancaria"
        descripcion="Elija la cuenta que quiere conciliar contra su extracto."
      />
      <Contenido>
        {cuentas.length === 0 ? (
          <Vacio
            titulo="No hay cuentas bancarias"
            descripcion="Registre primero la cuenta y sus movimientos."
            accion={
              <Link href="/caja-bancos" className="boton boton-primario">
                Ir a caja y bancos
              </Link>
            }
          />
        ) : (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[22rem]">
              <label className="etiqueta" htmlFor="cuenta">Cuenta</label>
              <select id="cuenta" name="cuenta" className="campo" required defaultValue="">
                <option value="" disabled>Elija una cuenta</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.nombre, c.banco, c.numero_cuenta].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </div>
            <button className="boton boton-primario">Conciliar</button>
          </form>
        )}
      </Contenido>
    </>
  );
}
