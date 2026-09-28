import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, SinPermiso } from "@/components/ui";
import { CargaDeApertura } from "./formulario";

export const metadata = { title: "Saldos de apertura · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * La carga de los saldos del día del cambio.
 *
 * Es lo que el cliente eligió en el cuestionario: traer sólo los saldos —deudas
 * de clientes, deudas a proveedores y stock—, no el histórico. El histórico se
 * consulta en el sistema anterior, que no se apaga.
 */
export default async function Apertura({
  searchParams,
}: {
  searchParams: Promise<{ hecho?: string }>;
}) {
  const { hecho } = await searchParams;
  if (!(await tienePermiso("maestros:ver"))) return <SinPermiso />;

  const { yaCargada } = await conEmpresa(async (db) => {
    const [f] = (await db.execute(
      sql`SELECT EXISTS (SELECT 1 FROM comprobantes WHERE es_apertura) AS hay`,
    )) as unknown as [{ hay: boolean }];
    return { yaCargada: f?.hay ?? false };
  }, "maestros:ver");

  return (
    <>
      <Encabezado
        titulo="Saldos de apertura"
        descripcion="Lo que se trae del sistema anterior el día del cambio: lo que deben los clientes, lo que se debe a los proveedores y lo que hay en el almacén."
        acciones={
          <Link href={"/maestros" as Route} className="boton boton-secundario">Maestros</Link>
        }
      />
      <Contenido>
        {hecho && (
          <p
            className="mb-5 rounded border px-3 py-2 text-sm"
            style={{
              color: "var(--exito)",
              borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)",
            }}
            role="status"
          >
            Saldos cargados. Revise el balance de comprobación del periodo antes de seguir.
          </p>
        )}

        <div className="tarjeta mb-5 p-4 text-sm">
          <p className="mb-2 font-medium">Antes de cargar</p>
          <ol className="list-decimal space-y-1 pl-5" style={{ color: "var(--texto-suave)" }}>
            <li>
              Los clientes, proveedores, productos y almacenes tienen que estar dados de alta. Lo
              que falte se denuncia en el cuadro, con su documento, y no se crea solo.
            </li>
            <li>
              Lo que se carga es el <strong>saldo pendiente</strong>, no el importe original de cada
              factura: los cobros y pagos parciales ocurrieron en el sistema anterior.
            </li>
            <li>
              Estas facturas <strong>no entran</strong> en el registro de ventas, en el PLE ni en la
              liquidación del PDT. Ya se declararon allá; volver a declararlas pagaría dos veces su
              IGV.
            </li>
            <li>La carga se hace una sola vez. Repetirla duplicaría la cartera y el stock.</li>
          </ol>
        </div>

        <CargaDeApertura yaCargada={yaCargada} />
      </Contenido>
    </>
  );
}
