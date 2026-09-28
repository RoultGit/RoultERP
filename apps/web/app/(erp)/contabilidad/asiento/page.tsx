import Link from "next/link";
import type { Route } from "next";
import { asc, eq } from "drizzle-orm";
import { listarCuentas, listarTerceros, cargarAsiento } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia } from "@/components/ui";
import { FormularioAsiento, type AsientoCargado } from "./formulario";

export const metadata = { title: "Asiento contable · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Asiento({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; periodo?: string }>;
}) {
  const { id, periodo } = await searchParams;

  const datos = await conEmpresa(async (db) => {
    const [cuentas, terceros, centros] = await Promise.all([
      listarCuentas(db, true),
      listarTerceros(db),
      db
        .select()
        .from(schema.centrosCosto)
        .where(eq(schema.centrosCosto.activo, true))
        .orderBy(asc(schema.centrosCosto.codigo)),
    ]);
    const cargado = id ? await cargarAsiento(db, id) : null;
    return { cuentas, terceros, centros, cargado };
  }, "contabilidad:crear");

  const cargado = datos.cargado;

  // Un asiento ya contabilizado no se edita: se muestra y, si hay que
  // corregirlo, se extorna. Editarlo reescribiría un libro ya declarado.
  if (cargado && cargado.cabecera.estado !== "borrador") {
    const { cabecera, lineas } = cargado;
    return (
      <>
        <Encabezado
          titulo={`Asiento ${cabecera.numero}`}
          descripcion={`${cabecera.periodo} · subdiario ${cabecera.subdiario} · ${cabecera.glosa}`}
          acciones={
            <Link href={`/contabilidad?periodo=${cabecera.periodo}` as Route} className="boton boton-secundario">
              Volver
            </Link>
          }
        />
        <Contenido>
          <div className="mb-3">
            <Insignia tono={cabecera.estado === "extornado" ? "alerta" : "exito"}>
              {cabecera.estado}
            </Insignia>
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Glosa</th>
                  <th className="text-right">Debe</th>
                  <th className="text-right">Haber</th>
                  <th className="text-right">Debe S/</th>
                  <th className="text-right">Haber S/</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{l.cuenta}</td>
                    <td className="max-w-[280px] truncate">{l.glosa ?? "—"}</td>
                    <td><Importe valor={l.debe} /></td>
                    <td><Importe valor={l.haber} /></td>
                    <td><Importe valor={l.debeFuncional} /></td>
                    <td><Importe valor={l.haberFuncional} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Contenido>
      </>
    );
  }

  const asiento: AsientoCargado | undefined = cargado
    ? {
        id: cargado.cabecera.id,
        periodo: cargado.cabecera.periodo,
        fecha: cargado.cabecera.fecha,
        subdiario: cargado.cabecera.subdiario,
        glosa: cargado.cabecera.glosa,
        moneda: cargado.cabecera.moneda,
        tipoCambio: cargado.cabecera.tipoCambio,
        lineas: cargado.lineas.map((l) => ({
          cuenta: l.cuenta,
          glosa: l.glosa ?? "",
          // El formulario trabaja en la moneda de la operación; los
          // equivalentes funcionales los recalcula el servidor al guardar.
          debe: l.debe === "0.000000" ? "" : l.debe,
          haber: l.haber === "0.000000" ? "" : l.haber,
          centroCostoId: l.centroCostoId ?? "",
          anexoId: l.anexoId ?? "",
        })),
      }
    : undefined;

  return (
    <>
      <Encabezado
        titulo={asiento ? `Borrador ${cargado!.cabecera.numero}` : "Nuevo asiento"}
        descripcion="Se guarda como borrador hasta que cuadre; sólo al contabilizarlo entra al balance y a los libros."
      />
      <Contenido>
        <FormularioAsiento
          cuentas={datos.cuentas.map((c) => ({
            id: c.cuenta,
            etiqueta: `${c.cuenta} — ${c.descripcion}`,
            exigeAnexo: c.exigeAnexo,
            exigeCentroCosto: c.exigeCentroCosto,
          }))}
          centrosCosto={datos.centros.map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
          terceros={datos.terceros.map((t) => ({
            id: t.id,
            etiqueta: `${t.razonSocial} · ${t.numeroDocumento}`,
          }))}
          periodoPorDefecto={/^\d{6}$/.test(periodo ?? "") ? periodo! : periodoActual()}
          {...(asiento ? { asiento } : {})}
        />
      </Contenido>
    </>
  );
}
