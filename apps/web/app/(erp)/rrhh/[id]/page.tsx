import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { cargarTrabajador, parametrosDeEmpresa, TrabajadorInvalido } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioTrabajador, NuevaRemuneracion, NuevoContrato, Renovar, Cesar } from "../formularios";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const dynamic = "force-dynamic";

export default async function FichaTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db, s) => {
    try {
      const base = await cargarTrabajador(db, id);
      return {
        ...base,
        centros: await db
          .select({ id: schema.centrosCosto.id, nombre: schema.centrosCosto.nombre })
          .from(schema.centrosCosto)
          .orderBy(asc(schema.centrosCosto.codigo)),
        afps: (await parametrosDeEmpresa(db, s.empresaId, hoyEnPeru())).afp,
        liquidaciones: await db
          .select({
            id: schema.planillasSueldos.id,
            numero: schema.planillasSueldos.numero,
            fecha: schema.planillasSueldos.fecha,
            estado: schema.planillasSueldos.estado,
            neto: schema.planillasSueldos.totalNeto,
          })
          .from(schema.planillaTrabajadores)
          .innerJoin(
            schema.planillasSueldos,
            eq(schema.planillasSueldos.id, schema.planillaTrabajadores.planillaId),
          )
          .where(eq(schema.planillaTrabajadores.trabajadorId, id))
          .orderBy(desc(schema.planillasSueldos.fecha))
          .limit(12),
      };
    } catch (e) {
      if (e instanceof TrabajadorInvalido) return null;
      throw e;
    }
  }, "planillas:ver");

  if (!datos) notFound();

  const { trabajador: t, remuneraciones, contratos, centros, afps, liquidaciones } = datos;
  const puedeEditar = await tienePermiso("planillas:editar");
  const puedeAprobar = await tienePermiso("planillas:aprobar");
  const nombre = `${t.apellidoPaterno} ${t.apellidoMaterno ?? ""}`.trim() + `, ${t.nombres}`;
  const vigente = contratos.find((c) => c.estado === "vigente");

  return (
    <>
      <Encabezado
        titulo={nombre}
        descripcion={[t.cargo, t.area, `Ingresó el ${t.fechaIngreso}`].filter(Boolean).join(" · ")}
        acciones={
          <div className="flex items-center gap-2">
            {t.situacion === "cesado" ? (
              <Insignia>cesado el {t.fechaCese} · {t.motivoCese?.replace(/_/g, " ")}</Insignia>
            ) : (
              <Insignia tono="exito">en planilla</Insignia>
            )}
            <Link href={"/rrhh" as Route} className="boton boton-secundario">Trabajadores</Link>
          </div>
        }
      />
      <Contenido>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {/* ── Historial de remuneraciones ─────────────────────────── */}
            <section className="bloque overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Historial de remuneraciones
              </h2>
              {remuneraciones.length === 0 ? (
                <div className="p-4">
                  <Vacio titulo="Sin remuneración fijada"
                    descripcion="Sin ella no se le puede calcular la boleta." />
                </div>
              ) : (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Rige desde</th>
                      <th className="text-right">Anterior (S/)</th>
                      <th className="text-right">Nuevo (S/)</th>
                      <th className="text-right">Variación</th>
                      <th className="text-right">%</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remuneraciones.map((r) => (
                      <tr key={r.id}>
                        <td className="cifra" style={{ textAlign: "left" }}>{r.vigenteDesde}</td>
                        <td>
                          {r.anterior ? (
                            <span style={{ color: "var(--texto-suave)" }}>
                              <Importe valor={r.anterior} />
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="font-medium"><Importe valor={r.basico} /></td>
                        <td style={r.variacion && Number(r.variacion) < 0 ? { color: "var(--peligro)" } : { color: "var(--exito)" }}>
                          {r.variacion ? <Importe valor={r.variacion} /> : "—"}
                        </td>
                        <td className="cifra">{r.variacionPorcentaje ? `${r.variacionPorcentaje} %` : "—"}</td>
                        <td className="max-w-[220px] truncate">{r.motivo ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {puedeEditar && t.situacion === "activo" && <NuevaRemuneracion trabajadorId={id} />}
            </section>

            {/* ── Contratos ───────────────────────────────────────────── */}
            <section className="bloque overflow-x-auto">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                Contratos
              </h2>
              {contratos.length === 0 ? (
                <div className="p-4">
                  <Vacio titulo="Sin contratos registrados"
                    descripcion="Registre el vigente para que entre en el aviso de vencimientos." />
                </div>
              ) : (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Desde</th>
                      <th>Hasta</th>
                      <th>Cargo</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {contratos.map((c) => (
                      <tr key={c.id}>
                        <td className="text-xs">
                          {c.tipo.replace(/_/g, " ")}
                          {c.modalidad && (
                            <span className="block" style={{ color: "var(--texto-suave)" }}>{c.modalidad}</span>
                          )}
                        </td>
                        <td className="cifra" style={{ textAlign: "left" }}>{c.fechaInicio}</td>
                        <td className="cifra" style={{ textAlign: "left" }}>{c.fechaFin ?? "—"}</td>
                        <td className="max-w-[160px] truncate">{c.cargo ?? "—"}</td>
                        <td><Insignia tono={c.estado === "vigente" ? "exito" : "neutro"}>{c.estado}</Insignia></td>
                        <td>
                          {puedeEditar && c.estado === "vigente" && c.fechaFin && (
                            <Renovar contratoId={c.id} trabajadorId={id}
                              desde={new Date(new Date(`${c.fechaFin}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {puedeEditar && t.situacion === "activo" && <NuevoContrato trabajadorId={id} />}
            </section>

            {/* ── Datos ───────────────────────────────────────────────── */}
            {puedeEditar && (
              <details className="bloque">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none">
                  Editar datos del trabajador
                </summary>
                <div className="border-t p-4" style={{ borderColor: "var(--borde)" }}>
                  <FormularioTrabajador
                    centros={centros}
                    afps={afps.map((a) => ({ codigo: a.codigo, nombre: a.nombre }))}
                    inicial={{
                      id: t.id,
                      tipoDocumento: t.tipoDocumento,
                      numeroDocumento: t.numeroDocumento,
                      apellidoPaterno: t.apellidoPaterno,
                      apellidoMaterno: t.apellidoMaterno ?? "",
                      nombres: t.nombres,
                      fechaNacimiento: t.fechaNacimiento ?? "",
                      sexo: t.sexo ?? "",
                      email: t.email ?? "",
                      telefono: t.telefono ?? "",
                      direccion: t.direccion ?? "",
                      fechaIngreso: t.fechaIngreso,
                      cargo: t.cargo ?? "",
                      area: t.area ?? "",
                      centroCostoId: t.centroCostoId ?? "",
                      regimenPension: t.regimenPension,
                      afpCodigo: t.afpCodigo ?? "",
                      afpComision: t.afpComision ?? "flujo",
                      cuspp: t.cuspp ?? "",
                      tieneHijos: t.tieneHijos,
                      afiliadoEps: t.afiliadoEps,
                      cci: t.cci ?? "",
                      banco: t.banco ?? "",
                      ctsBanco: t.ctsBanco ?? "",
                      ctsCuenta: t.ctsCuenta ?? "",
                      observaciones: t.observaciones ?? "",
                    }}
                  />
                </div>
              </details>
            )}
          </div>

          {/* ── Lateral ───────────────────────────────────────────────── */}
          <aside className="space-y-5">
            <section className="bloque p-4">
              <h2 className="mb-3 text-sm font-semibold">Resumen</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--texto-suave)" }}>Documento</dt>
                  <dd className="cifra">{t.numeroDocumento}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--texto-suave)" }}>Pensiones</dt>
                  <dd>
                    {t.regimenPension === "afp"
                      ? `AFP ${t.afpCodigo} · ${t.afpComision}`
                      : t.regimenPension.toUpperCase()}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--texto-suave)" }}>Asignación familiar</dt>
                  <dd>{t.tieneHijos ? "sí" : "no"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--texto-suave)" }}>Contrato vigente</dt>
                  <dd>{vigente ? `${vigente.tipo.replace(/_/g, " ")}${vigente.fechaFin ? ` hasta ${vigente.fechaFin}` : ""}` : "—"}</dd>
                </div>
                {t.cci && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--texto-suave)" }}>CCI</dt>
                    <dd className="cifra">{t.cci}</dd>
                  </div>
                )}
              </dl>
            </section>

            {liquidaciones.length > 0 && (
              <section className="bloque overflow-hidden">
                <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
                  Sus planillas
                </h2>
                <ul className="divide-y" style={{ borderColor: "var(--borde)" }}>
                  {liquidaciones.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <Link href={`/planillas/${l.id}` as Route} className="underline">
                        {l.numero}
                      </Link>
                      <span style={{ color: "var(--texto-suave)" }}>{l.fecha}</span>
                      <Importe valor={l.neto} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {puedeAprobar && t.situacion === "activo" && <Cesar trabajadorId={id} nombre={t.nombres} />}
          </aside>
        </div>
      </Contenido>
    </>
  );
}
