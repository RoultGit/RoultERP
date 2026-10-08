import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";

export const metadata = { title: "Maestros · RoultERP" };
export const dynamic = "force-dynamic";

const FICHAS = [
  {
    href: "/maestros/productos",
    titulo: "Productos",
    descripcion: "Bienes y servicios, con su unidad, peso, cuentas contables y afectación de IGV.",
    tabla: "productos",
  },
  {
    href: "/maestros/terceros",
    titulo: "Clientes y proveedores",
    descripcion: "Una sola ficha por RUC: el mismo tercero suele ser las dos cosas.",
    tabla: "terceros",
  },
  {
    href: "/maestros/cuentas",
    titulo: "Plan de cuentas",
    descripcion: "PCGE de la empresa, con las exigencias de cada cuenta al contabilizar.",
    tabla: "plan_cuentas",
  },
  {
    href: "/maestros/centros-costo",
    titulo: "Centros de costo",
    descripcion: "A dónde se imputa cada gasto. Varias cuentas del plan lo exigen al contabilizar.",
    tabla: "centros_costo",
  },
  {
    href: "/maestros/almacenes",
    titulo: "Almacenes y sucursales",
    descripcion: "Establecimientos donde se guarda existencia; el kardex se lleva por almacén.",
    tabla: "almacenes",
  },
] as const;

export default async function Maestros() {
  const conteos = await conEmpresa(async (db) => {
    const filas = (await db.execute(sql`
      SELECT 'productos'    AS tabla, count(*)::int AS n FROM productos WHERE activo
      UNION ALL SELECT 'terceros',    count(*)::int FROM terceros WHERE activo
      UNION ALL SELECT 'plan_cuentas', count(*)::int FROM plan_cuentas WHERE activa
      UNION ALL SELECT 'almacenes',   count(*)::int FROM almacenes WHERE activo
      UNION ALL SELECT 'centros_costo', count(*)::int FROM centros_costo WHERE activo
    `)) as unknown as { tabla: string; n: number }[];
    return new Map(filas.map((f) => [f.tabla, f.n]));
  }, "maestros:ver");

  return (
    <>
      <Encabezado
        titulo="Maestros"
        descripcion="La información que el resto de módulos referencia y que casi nunca cambia."
      />
      <Contenido>
        <div className="grid gap-4 sm:grid-cols-2">
          {FICHAS.map((f) => (
            <Link
              key={f.href}
              href={f.href as Route}
              className="bloque block p-4 transition-colors hover:bg-[var(--superficie-2)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{f.titulo}</h2>
                <span className="cifra text-sm" style={{ color: "var(--texto-suave)" }}>
                  {conteos.get(f.tabla) ?? 0}
                </span>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--texto-suave)" }}>
                {f.descripcion}
              </p>
            </Link>
          ))}
        </div>
      </Contenido>
    </>
  );
}
