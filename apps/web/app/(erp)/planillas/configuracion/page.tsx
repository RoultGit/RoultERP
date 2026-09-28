import Link from "next/link";
import type { Route } from "next";
import {
  listarParametrosLaborales, catalogoConceptos, parametrosDeEmpresa,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia } from "@/components/ui";
import { FormularioParametro, FormularioConcepto } from "../formularios";
import { hoyEnPeru } from "@roulterp/core/fecha";

export const metadata = { title: "Configuración de planillas · RoultERP" };
export const dynamic = "force-dynamic";

const CLAVES = [
  { clave: "rmv", nombre: "Remuneración mínima vital (S/)" },
  { clave: "uit", nombre: "UIT (S/)" },
  { clave: "tasa_onp", nombre: "Tasa de ONP" },
  { clave: "tasa_essalud", nombre: "Tasa de EsSalud" },
  { clave: "tasa_asignacion_familiar", nombre: "Tasa de asignación familiar" },
  { clave: "tasa_bonificacion_gratificacion", nombre: "Bonificación extraordinaria de gratificación" },
  { clave: "tasa_senati", nombre: "Tasa de SENATI" },
  { clave: "remuneracion_maxima_asegurable", nombre: "Remuneración máxima asegurable (S/)" },
] as const;

const NOMBRE = new Map<string, string>(CLAVES.map((c) => [c.clave, c.nombre]));

/**
 * Lo que decide cómo se calcula la planilla.
 *
 * Dos tablas y la misma idea detrás de las dos: **el programa trae el valor de
 * la ley y la empresa guarda sólo lo que cambió**. Es el mismo trato que reciben
 * el plan de cuentas y las cuentas de integración contable, y es lo que permite
 * que una empresa creada hoy y una de hace un año se comporten igual sin
 * sembrar nada.
 *
 * SERVIDIMAR pidió conservar las fórmulas que usa hoy. Esta pantalla es donde se
 * ajustan: lo que trae el programa es lo que manda la norma, no necesariamente
 * lo que hace su planilla actual.
 */
export default async function ConfiguracionPlanillas() {
  const { parametros, conceptos, vigentes } = await conEmpresa(
    async (db, s) => ({
      parametros: await listarParametrosLaborales(db),
      conceptos: await catalogoConceptos(db),
      vigentes: await parametrosDeEmpresa(db, s.empresaId, hoyEnPeru()),
    }),
    "planillas:ver",
  );
  const puedeEditar = await tienePermiso("planillas:editar");
  const d6 = (v: money.Dec) => money.toString(v, 6).replace(/0+$/, "").replace(/\.$/, "");

  return (
    <>
      <Encabezado
        titulo="Configuración de planillas"
        descripcion="Los valores de la ley y el catálogo de conceptos. Lo que no se toca aquí sale del valor que trae el programa."
        acciones={
          <Link href={"/planillas" as Route} className="boton boton-secundario">Planillas</Link>
        }
      />
      <Contenido>
        {/* ── Vigentes hoy ─────────────────────────────────────────────── */}
        <section className="tarjeta mb-5 p-4">
          <h2 className="mb-3 text-sm font-semibold">Vigentes hoy</h2>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>RMV</dt>
              <dd className="cifra">{d6(vigentes.rmv)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>UIT</dt>
              <dd className="cifra">{d6(vigentes.uit)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>ONP</dt>
              <dd className="cifra">{d6(vigentes.tasaOnp)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>EsSalud</dt>
              <dd className="cifra">{d6(vigentes.tasaEsSalud)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>Asignación familiar</dt>
              <dd className="cifra">{d6(vigentes.tasaAsignacionFamiliar)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--texto-suave)" }}>Rem. máxima asegurable</dt>
              <dd className="cifra">{d6(vigentes.remuneracionMaximaAsegurable)}</dd>
            </div>
          </dl>
          <h3 className="mt-4 mb-2 text-xs font-semibold uppercase" style={{ color: "var(--texto-suave)" }}>
            Tasas de AFP
          </h3>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>AFP</th>
                  <th className="text-right">Aporte</th>
                  <th className="text-right">Comisión por flujo</th>
                  <th className="text-right">Comisión sobre saldo</th>
                  <th className="text-right">Prima de seguro</th>
                </tr>
              </thead>
              <tbody>
                {vigentes.afp.map((a) => (
                  <tr key={a.codigo}>
                    <td>{a.nombre}</td>
                    <td className="cifra">{a.aporte}</td>
                    <td className="cifra">{a.comisionFlujo}</td>
                    <td className="cifra">{a.comisionSaldo}</td>
                    <td className="cifra">{a.primaSeguro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--texto-suave)" }}>
            Las publica la SBS y cambian cada pocos meses. Se guardan con su vigencia para que
            recalcular un mes viejo dé lo que dio entonces, y no lo que daría hoy.
          </p>
        </section>

        {/* ── Excepciones cargadas ─────────────────────────────────────── */}
        <section className="tarjeta mb-5 overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Valores propios de la empresa
          </h2>
          {parametros.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: "var(--texto-suave)" }}>
              Ninguno. Se están usando los valores que trae el programa.
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Rige desde</th>
                  <th className="text-right">Valor</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {parametros.map((p) => (
                  <tr key={p.id}>
                    <td>{NOMBRE.get(p.clave) ?? p.clave}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{p.vigenteDesde}</td>
                    <td className="cifra">{p.valor}</td>
                    <td className="text-xs" style={{ color: "var(--texto-suave)" }}>{p.observaciones ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {puedeEditar && <FormularioParametro claves={CLAVES} />}
        </section>

        {/* ── Conceptos ────────────────────────────────────────────────── */}
        <section className="tarjeta overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Conceptos de la boleta ({conceptos.length})
          </h2>
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-20">Código</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th>Cálculo</th>
                <th>Bases</th>
                <th>Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => (
                <tr key={c.codigo}>
                  <td className="cifra" style={{ textAlign: "left" }}>{c.codigo}</td>
                  <td>{c.nombre}</td>
                  <td className="text-xs">
                    {c.tipo === "aporte" ? (
                      <Insignia>empleador</Insignia>
                    ) : c.tipo === "descuento" ? (
                      <span style={{ color: "var(--peligro)" }}>descuento</span>
                    ) : (
                      <span style={{ color: "var(--exito)" }}>ingreso</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {c.calculo === "legal" ? `legal · ${c.regla}` : c.calculo}
                    {c.tasa ? ` · ${c.tasa}` : ""}
                  </td>
                  <td className="text-xs" style={{ color: "var(--texto-suave)" }}>
                    {[c.remunerativo && "remunerativo", c.afectaQuinta && "quinta", c.computableCts && "CTS"]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="cifra" style={{ textAlign: "left" }}>{c.cuenta ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {puedeEditar && <FormularioConcepto />}
          <p className="border-t px-4 py-2 text-xs"
            style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            «Remunerativo» es la casilla que más caro sale equivocar: decide si el concepto entra en
            la base de pensiones, EsSalud, CTS y gratificación. La movilidad de reparto no lo es; una
            bonificación regular sí. El error viaja hasta la liquidación y aparece años después.
          </p>
        </section>
      </Contenido>
    </>
  );
}
