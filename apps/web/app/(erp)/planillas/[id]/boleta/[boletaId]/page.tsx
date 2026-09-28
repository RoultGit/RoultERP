import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { cargarPlanillaSueldos, enLetras, PlanillaSueldosInvalida } from "@roulterp/servicios";
import { schema } from "@roulterp/db";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Documento } from "@/components/documento";

export const metadata = { title: "Boleta de pago · RoultERP" };
export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  mensual: "Boleta de pago",
  gratificacion: "Gratificación",
  cts: "Depósito de CTS",
  liquidacion: "Liquidación de beneficios sociales",
};

/**
 * La boleta de pago, en papel.
 *
 * Es un documento que la ley obliga a entregar y que el trabajador firma, así
 * que lleva lo que tiene que llevar: sus datos, los días trabajados, cada
 * concepto con su importe, y **los aportes del empleador en un bloque aparte**.
 *
 * Esa separación no es estética. El aporte a EsSalud es dinero que la empresa
 * pone por encima del sueldo y que no sale del bolsillo del trabajador;
 * mezclarlo con los descuentos —que es el error más común de una boleta hecha a
 * mano— le hace creer que le descuentan un 9 % más de lo que le descuentan.
 */
export default async function Boleta({
  params,
}: {
  params: Promise<{ id: string; boletaId: string }>;
}) {
  const { id, boletaId } = await params;

  const datos = await conEmpresa(async (db) => {
    try {
      const p = await cargarPlanillaSueldos(db, id);
      const boleta = p.boletas.find((b) => b.id === boletaId);
      if (!boleta) return null;
      const [t] = await db
        .select()
        .from(schema.trabajadores)
        .where(eq(schema.trabajadores.id, boleta.trabajadorId))
        .limit(1);
      return { cabecera: p.cabecera, boleta, trabajador: t };
    } catch (e) {
      if (e instanceof PlanillaSueldosInvalida) return null;
      throw e;
    }
  }, "planillas:ver");

  if (!datos?.trabajador) notFound();
  const { cabecera, boleta, trabajador: t } = datos;

  const ingresos = boleta.lineas.filter((l) => l.tipo === "ingreso");
  const descuentos = boleta.lineas.filter((l) => l.tipo === "descuento");
  const aportes = boleta.lineas.filter((l) => l.tipo === "aporte");
  const letras = enLetras(money.dec(boleta.neto), "PEN");

  const Bloque = ({
    titulo,
    filas,
    total,
    nota,
  }: {
    titulo: string;
    filas: typeof boleta.lineas;
    total: string;
    nota?: string;
  }) =>
    filas.length === 0 ? null : (
      <section className="mt-4">
        <h3 className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--texto-suave)" }}>
          {titulo}
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {filas.map((l) => (
              <tr key={l.id}>
                <td className="py-0.5">
                  <span className="cifra mr-2" style={{ color: "var(--texto-suave)" }}>{l.codigo}</span>
                  {l.nombre}
                </td>
                <td className="py-0.5 text-right">
                  <Importe valor={l.importe} />
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--borde)" }}>
              <td className="pt-1 font-medium">Total</td>
              <td className="pt-1 text-right font-medium">
                <Importe valor={total} />
              </td>
            </tr>
          </tbody>
        </table>
        {nota && (
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>{nota}</p>
        )}
      </section>
    );

  return (
    <Documento
      titulo={ETIQUETA[cabecera.tipo] ?? "Boleta"}
      numero={cabecera.numero}
      fecha={cabecera.fecha}
      volverA={`/planillas/${id}`}
      volverTexto="Volver a la planilla"
      firmas={["Entregado por la empresa", "Recibí conforme (trabajador)"]}
    >
      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Trabajador</dt>
          <dd className="font-medium">
            {`${t.apellidoPaterno} ${t.apellidoMaterno ?? ""}`.trim()}, {t.nombres}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Documento</dt>
          <dd className="cifra">{t.numeroDocumento}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Cargo</dt>
          <dd>{t.cargo ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Fecha de ingreso</dt>
          <dd className="cifra">{t.fechaIngreso}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Periodo</dt>
          <dd className="cifra">
            {cabecera.periodo}
            {cabecera.quincena ? ` · ${cabecera.quincena}.ª quincena` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Días trabajados</dt>
          <dd className="cifra">{boleta.diasTrabajados}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--texto-suave)" }}>Sistema de pensiones</dt>
          <dd>
            {boleta.regimenPension === "afp"
              ? `AFP ${boleta.afpCodigo ?? ""}${t.cuspp ? ` · CUSPP ${t.cuspp}` : ""}`
              : boleta.regimenPension.toUpperCase()}
          </dd>
        </div>
        {boleta.fechaCese && (
          <div className="flex justify-between gap-3">
            <dt style={{ color: "var(--texto-suave)" }}>Cese</dt>
            <dd>
              {boleta.fechaCese} · {boleta.motivoCese?.replace(/_/g, " ")}
            </dd>
          </div>
        )}
      </dl>

      <Bloque titulo="Ingresos" filas={ingresos} total={boleta.totalIngresos} />
      <Bloque titulo="Descuentos" filas={descuentos} total={boleta.totalDescuentos} />

      <section
        className="mt-4 flex items-baseline justify-between border-t pt-2"
        style={{ borderColor: "var(--borde-fuerte)" }}
      >
        <span className="font-semibold">Neto a pagar</span>
        <span className="text-lg font-semibold">
          <Importe valor={boleta.neto} moneda="PEN" />
        </span>
      </section>
      <p className="mt-1 text-sm">{letras.startsWith("SON ") ? letras : `SON ${letras}`}</p>

      <Bloque
        titulo="Aportes del empleador (no se descuentan al trabajador)"
        filas={aportes}
        total={boleta.totalAportes}
        nota="EsSalud y demás contribuciones las paga la empresa por encima del sueldo. Figuran aquí para constancia, no restan del neto."
      />

      {boleta.lineas.some((l) => l.nota) && (
        <section className="mt-4 text-xs" style={{ color: "var(--texto-suave)" }}>
          {boleta.lineas
            .filter((l) => l.nota)
            .map((l) => (
              <p key={l.id}>
                <strong>{l.nombre}:</strong> {l.nota}
              </p>
            ))}
        </section>
      )}
    </Documento>
  );
}
