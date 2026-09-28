import { sql } from "drizzle-orm";
import { ajustesDeEmpresa } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado } from "@/components/ui";
import { FormularioEmpresa } from "./formulario";

export const metadata = { title: "Datos de la empresa · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * Los datos de la propia empresa.
 *
 * Se fijaban al dar de alta y después no había dónde corregirlos, así que la
 * cuenta de detracciones, el ubigeo o la designación como agente de retención
 * quedaban como se pusieron el primer día. Son datos que cambian —una mudanza,
 * una resolución de SUNAT— y que salen impresos en los comprobantes.
 */
export default async function DatosEmpresa() {
  const { empresa, conKardex } = await conEmpresa(async (db, s) => {
    const e = await ajustesDeEmpresa(db, s.empresaId);
    const [{ hay }] = (await db.execute(
      sql`SELECT EXISTS (SELECT 1 FROM movimientos_inventario WHERE empresa_id = ${s.empresaId}) AS hay`,
    )) as unknown as [{ hay: boolean }];
    return { empresa: e, conKardex: hay };
  }, "maestros:ver");

  const puedeEditar = await tienePermiso("maestros:editar");

  return (
    <>
      <Encabezado
        titulo="Datos de la empresa"
        descripcion="Lo que sale impreso en los comprobantes y lo que decide cómo se costea el almacén."
      />
      <Contenido>
        <FormularioEmpresa
          empresa={{
            ruc: empresa.ruc,
            razonSocial: empresa.razonSocial,
            nombreComercial: empresa.nombreComercial,
            direccion: empresa.direccion,
            ubigeo: empresa.ubigeo,
            monedaFuncional: empresa.monedaFuncional,
            metodoValorizacion: empresa.metodoValorizacion,
            redondeoDetraccion: empresa.redondeoDetraccion,
            cuentaDetracciones: empresa.cuentaDetracciones,
            esAgenteRetencion: empresa.esAgenteRetencion,
            esAgentePercepcion: empresa.esAgentePercepcion,
          }}
          puedeEditar={puedeEditar}
          conKardex={conKardex}
        />
      </Contenido>
    </>
  );
}
