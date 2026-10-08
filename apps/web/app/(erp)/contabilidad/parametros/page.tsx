import Link from "next/link";
import type { Route } from "next";
import { listarParametrosContables, listarCuentas } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia } from "@/components/ui";
import { FormularioParametros } from "./formulario";

export const metadata = { title: "Cuentas de integración · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Parametros({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { hecho } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const [parametros, cuentas] = await Promise.all([
      listarParametrosContables(db),
      listarCuentas(db, true),
    ]);
    return { parametros, cuentas };
  }, "contabilidad:ver");

  const puedeEditar = await tienePermiso("contabilidad:editar");
  const cambiadas = datos.parametros.filter((p) => p.personalizada).length;

  return (
    <>
      <Encabezado
        titulo="Cuentas de integración"
        descripcion="Qué cuenta usa el programa cuando contabiliza solo: la venta, el IGV, el cliente, el proveedor. Si su plan de cuentas usa otras divisionarias, se cambian aquí y no hay que tocar el programa."
        acciones={
          <Link href={"/maestros/cuentas" as Route} className="boton boton-secundario">
            Plan de cuentas
          </Link>
        }
      />
      <Contenido>
        {hecho && (
          <p className="bloque mb-5 p-3 text-sm" role="status">
            Cuentas guardadas. Los asientos que se generen desde ahora las usan; los ya
            contabilizados no cambian.
          </p>
        )}

        <p className="mb-5 text-sm" style={{ color: "var(--texto-suave)" }}>
          {cambiadas === 0 ? (
            <>Todas siguen las cuentas del plan general.</>
          ) : (
            <>
              <Insignia tono="alerta">{cambiadas} cambiadas</Insignia> respecto del plan general.
              La columna «de partida» dice cuál era.
            </>
          )}
        </p>

        {puedeEditar ? (
          <FormularioParametros
            parametros={datos.parametros}
            cuentas={datos.cuentas.map((c) => ({ cuenta: c.cuenta, descripcion: c.descripcion }))}
          />
        ) : (
          <section className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Módulo</th>
                  <th>Cuenta</th>
                </tr>
              </thead>
              <tbody>
                {datos.parametros.map((p) => (
                  <tr key={p.clave}>
                    <td>{p.nombre}</td>
                    <td style={{ color: "var(--texto-suave)" }}>{p.modulo}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {p.cuenta} — {p.descripcionCuenta ?? "no está en el plan"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="mt-5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Sólo se ofrecen cuentas que admiten movimiento: una cuenta de agrupación no puede recibir
          un asiento, y elegirla rompería la primera operación que la usara. Cambiar una cuenta no
          reescribe lo ya contabilizado; si quiere reclasificar el pasado, eso es un asiento de
          ajuste.
        </p>
      </Contenido>
    </>
  );
}
