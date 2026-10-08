import Link from "next/link";
import type { Route } from "next";
import { asc, eq } from "drizzle-orm";
import {
  certificadoActivo, credencialesActuales, listaParaEmitir, verificarCertificado,
} from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { kekMaestra } from "@/lib/entorno";
import { Contenido, Encabezado, Insignia, Vacio } from "@/components/ui";
import {
  FormularioCertificado, FormularioCredenciales, FormularioCredencialesGre, FormularioSerie,
} from "./formularios";

export const metadata = { title: "Facturación electrónica · RoultERP" };
export const dynamic = "force-dynamic";

const TIPO: Record<string, string> = {
  "01": "Factura", "03": "Boleta", "07": "Nota de crédito", "08": "Nota de débito",
  "09": "Guía de remisión", "20": "Comprobante de retención",
  "40": "Comprobante de percepción",
};

export default async function ConfiguracionCpe() {
  const datos = await conEmpresa(
    async (db, sesion) => ({
      certificado: await certificadoActivo(db),
      verificacion: await verificarCertificado(db, sesion.empresaId, kekMaestra),
      credenciales: await credencialesActuales(db),
      preparacion: await listaParaEmitir(db, sesion.empresaId, kekMaestra),
      series: await db
        .select()
        .from(schema.seriesDocumento)
        .orderBy(asc(schema.seriesDocumento.tipoDocumento), asc(schema.seriesDocumento.serie)),
      empresa: (
        await db.select({ ruc: schema.empresas.ruc }).from(schema.empresas).limit(1)
      )[0],
    }),
    "cpe:ver",
  );

  const puedeEditar = await tienePermiso("cpe:editar");

  return (
    <>
      <Encabezado
        titulo="Facturación electrónica"
        descripcion="Certificado digital, credenciales SOL y series de emisión."
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            {datos.preparacion.puedeEnviar ? (
              <Insignia tono="exito">Lista para emitir y enviar</Insignia>
            ) : datos.preparacion.puedeEmitir ? (
              <Insignia tono="alerta">Puede emitir, no enviar</Insignia>
            ) : (
              <Insignia tono="alerta">Configuración incompleta</Insignia>
            )}
            <Link href={"/cpe/resumenes" as Route} className="boton boton-secundario">
              Resúmenes y bajas
            </Link>
            <Link href={"/cpe/retenciones" as Route} className="boton boton-secundario">
              Retenciones y percepciones
            </Link>
          </div>
        }
      />
      <Contenido>
        {!datos.preparacion.puedeEnviar && (
          <div className="mb-5 aviso">
            <p className="font-medium">
              {datos.preparacion.puedeEmitir
                ? "Ya puede facturar. Falta esto para poder enviar a SUNAT:"
                : "Falta lo siguiente:"}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {[...datos.preparacion.faltantesEmision, ...datos.preparacion.faltantesEnvio].map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="bloque p-4">
            <h2 className="mb-1 text-sm font-semibold">Certificado digital</h2>
            <p className="mb-4 text-xs" style={{ color: "var(--texto-suave)" }}>
              El archivo <code>.pfx</code> que emitió la entidad acreditada a nombre del RUC{" "}
              <span className="cifra" style={{ textAlign: "left" }}>{datos.empresa?.ruc}</span>. Se
              guarda cifrado; ni el archivo ni su contraseña quedan legibles en la base de datos.
            </p>

            {datos.certificado ? (
              <dl className="mb-4 space-y-1.5 text-sm">
                <Dato etiqueta="RUC del certificado" valor={datos.certificado.ruc ?? "—"} />
                <Dato etiqueta="Vigente hasta" valor={datos.certificado.vigenteHasta ?? "—"} />
                <Dato
                  etiqueta="Estado"
                  valor={
                    !datos.verificacion.ok ? (
                      <Insignia tono="peligro">{datos.verificacion.motivo}</Insignia>
                    ) : datos.certificado.diasParaVencer !== null &&
                      datos.certificado.diasParaVencer < 30 ? (
                      <Insignia tono="alerta">
                        vence en {datos.certificado.diasParaVencer} días
                      </Insignia>
                    ) : (
                      <Insignia tono="exito">
                        vigente · {datos.certificado.diasParaVencer} días
                      </Insignia>
                    )
                  }
                />
              </dl>
            ) : (
              <div className="mb-4">
                <Vacio titulo="Sin certificado cargado" />
              </div>
            )}

            {puedeEditar && <FormularioCertificado tieneUno={!!datos.certificado} />}
          </section>

          <section className="bloque p-4">
            <h2 className="mb-1 text-sm font-semibold">Credenciales SOL</h2>
            <p className="mb-4 text-xs" style={{ color: "var(--texto-suave)" }}>
              El usuario secundario de SUNAT con el que se envían los comprobantes. Va sin el RUC
              delante: el sistema lo concatena al enviar.
            </p>

            {datos.credenciales ? (
              <dl className="mb-4 space-y-1.5 text-sm">
                <Dato etiqueta="Usuario SOL" valor={datos.credenciales.usuarioSol} />
                <Dato
                  etiqueta="Entorno"
                  valor={
                    datos.credenciales.entorno === "produccion" ? (
                      <Insignia tono="exito">producción</Insignia>
                    ) : (
                      <Insignia tono="alerta">pruebas (beta)</Insignia>
                    )
                  }
                />
              </dl>
            ) : (
              <div className="mb-4">
                <Vacio titulo="Sin credenciales configuradas" />
              </div>
            )}

            {puedeEditar && (
              <FormularioCredenciales
                usuarioActual={datos.credenciales?.usuarioSol ?? ""}
                entornoActual={datos.credenciales?.entorno ?? "beta"}
              />
            )}
          </section>

          <section className="bloque p-4">
            <h2 className="mb-1 text-sm font-semibold">Credenciales de la GRE</h2>
            <p className="mb-4 text-xs" style={{ color: "var(--texto-suave)" }}>
              Las guías de remisión van por una API distinta, con un client_id y un client_secret
              propios que se generan aparte en el menú SOL. Las credenciales SOL no sirven aquí.
            </p>

            {datos.credenciales?.greClientId ? (
              <dl className="mb-4 space-y-1.5 text-sm">
                <Dato etiqueta="client_id" valor={datos.credenciales.greClientId} />
                <Dato etiqueta="client_secret" valor={<Insignia tono="exito">guardado</Insignia>} />
              </dl>
            ) : (
              <div className="mb-4">
                <Vacio titulo="Sin credenciales de la GRE" />
              </div>
            )}

            {puedeEditar && (
              <FormularioCredencialesGre
                clientIdActual={datos.credenciales?.greClientId ?? ""}
              />
            )}
          </section>
        </div>

        <section className="bloque overflow-x-auto">
          <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
            <h2 className="text-sm font-semibold">Series de emisión</h2>
            <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
              El correlativo avanza solo al emitir
            </span>
          </div>

          {datos.series.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Sin series registradas"
                descripcion="Una serie de factura empieza por F y una de boleta por B, seguidas de tres dígitos."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Serie</th>
                  <th className="text-right">Último número</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {datos.series.map((s) => (
                  <tr key={s.id}>
                    <td>{TIPO[s.tipoDocumento] ?? s.tipoDocumento}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{s.serie}</td>
                    <td className="cifra">{String(s.correlativo).padStart(8, "0")}</td>
                    <td>
                      {s.activa ? <Insignia tono="exito">activa</Insignia> : <Insignia>inactiva</Insignia>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {puedeEditar && (
            <div className="border-t p-4" style={{ borderColor: "var(--borde)" }}>
              <FormularioSerie />
            </div>
          )}
        </section>

        <p className="mt-5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Falta implementar el resumen diario de boletas, la comunicación de baja y la guía de
          remisión electrónica.
        </p>
      </Contenido>
    </>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--texto-suave)" }}>{etiqueta}</dt>
      <dd className="cifra" style={{ textAlign: "right" }}>{valor}</dd>
    </div>
  );
}
