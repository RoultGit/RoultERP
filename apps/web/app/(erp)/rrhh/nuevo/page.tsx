import { asc } from "drizzle-orm";
import { parametrosDeEmpresa } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";
import { FormularioTrabajador } from "../formularios";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Nuevo trabajador · RoultERP" };
export const dynamic = "force-dynamic";

export default async function NuevoTrabajador() {
  const { centros, afps } = await conEmpresa(async (db, s) => {
    const hoy = hoyEnPeru();
    return {
      centros: await db
        .select({ id: schema.centrosCosto.id, nombre: schema.centrosCosto.nombre })
        .from(schema.centrosCosto)
        .orderBy(asc(schema.centrosCosto.codigo)),
      afps: (await parametrosDeEmpresa(db, s.empresaId, hoy)).afp,
    };
  }, "planillas:editar");

  return (
    <>
      <Encabezado
        titulo="Nuevo trabajador"
        descripcion="Lo que se llena aquí decide cómo sale su boleta: el sistema de pensiones, la asignación familiar y el centro de costo al que se carga su sueldo."
      />
      <Contenido>
        <FormularioTrabajador
          centros={centros}
          afps={afps.map((a) => ({ codigo: a.codigo, nombre: a.nombre }))}
        />
      </Contenido>
    </>
  );
}
