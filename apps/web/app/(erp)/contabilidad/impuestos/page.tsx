import Link from "next/link";
import type { Route } from "next";
import { liquidacionMensual, type Casilla } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe } from "@/components/ui";

export const metadata = { title: "Liquidación de impuestos · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Un bloque del formulario, con sus casillas numeradas. */
function Bloque({ titulo, casillas }: { titulo: string; casillas: Casilla[] }) {
  if (casillas.length === 0) return null;
  return (
    <section className="bloque overflow-hidden">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
        {titulo}
      </h2>
      <table className="tabla">
        <tbody>
          {casillas.map((c, i) => (
            <tr
              key={`${c.numero}-${c.concepto}-${i}`}
              style={c.esTotal ? { background: "var(--superficie-2)" } : undefined}
            >
              <td className="cifra w-16" style={{ textAlign: "left", color: "var(--texto-suave)" }}>
                {c.numero}
              </td>
              <td
                style={{
                  paddingLeft: `${0.75 + c.nivel * 1}rem`,
                  fontWeight: c.esTotal ? 600 : 400,
                }}
              >
                {c.concepto}
              </td>
              <td className="text-right" style={{ fontWeight: c.esTotal ? 600 : 400 }}>
                <Importe valor={c.importe} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function Impuestos({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; saldo?: string; tasa?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const l = await conEmpresa(
    (db) =>
      liquidacionMensual(db, periodo, {
        ...(params.saldo ? { saldoAFavorAnterior: params.saldo } : {}),
        ...(params.tasa ? { tasaRenta: params.tasa } : {}),
      }),
    "contabilidad:ver",
  );

  return (
    <>
      <Encabezado
        titulo="Liquidación de impuestos"
        descripcion={`Borrador del PDT 621 para el periodo ${periodo}. Las cifras salen de las mismas filas que los libros electrónicos: si el PLE dice una cosa, aquí dice lo mismo.`}
        acciones={
          <>
            {/*
              Una descarga es una petición del navegador, no una navegación de
              Next: un <Link> la convertiría en transición de cliente y el
              archivo no llegaría nunca.
            */}
            <a
              href={`/api/pdt?periodo=${periodo}${params.saldo ? `&saldo=${encodeURIComponent(params.saldo)}` : ""}${params.tasa ? `&tasa=${encodeURIComponent(params.tasa)}` : ""}`}
              className="boton boton-secundario"
            >
              Exportar al PDT (CSV)
            </a>
            <Link href={`/contabilidad/ple?periodo=${periodo}` as Route} className="boton boton-secundario">
              Libros electrónicos
            </Link>
          </>
        }
      />
      <Contenido>
        <form className="bloque mb-5 flex flex-wrap items-end gap-3 p-4" action="/contabilidad/impuestos">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo} pattern="\d{6}"
              className="campo cifra w-32" style={{ textAlign: "left" }} placeholder="202609" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="saldo">Saldo a favor anterior</label>
            <input
              id="saldo" name="saldo" inputMode="decimal" defaultValue={params.saldo ?? ""}
              className="campo cifra w-40" placeholder="0.00" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="tasa">Tasa de renta (%)</label>
            <input
              id="tasa" name="tasa" inputMode="decimal" defaultValue={params.tasa ?? ""}
              className="campo cifra w-28" placeholder="1.5" />
          </div>
          <button className="boton boton-primario">Calcular</button>

          <dl className="ml-auto flex gap-6 text-right">
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>IGV a pagar</dt>
              <dd className="text-lg font-medium"><Importe valor={l.igvAPagar} /></dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Pago a cuenta renta</dt>
              <dd className="text-lg font-medium"><Importe valor={l.pagoACuentaRenta} /></dd>
            </div>
          </dl>

          {/*
            * La ayuda va debajo de la fila, no dentro de un campo.
            *
            * Estaba colgada del campo del saldo a favor, y con `items-end` eso
            * alineaba el borde inferior del bloque entero: el campo quedaba
            * veinte píxeles más arriba que los de al lado y la fila se veía
            * torcida. Una nota no debe mover el control que explica.
            */}
          <p className="w-full text-xs" style={{ color: "var(--texto-suave)" }}>
            El saldo a favor es la casilla 145 de la declaración del mes pasado.
          </p>
        </form>

        {l.avisos.length > 0 && (
          <div
            className="bloque mb-5 p-4 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--alerta) 45%, transparent)" }}
          >
            <p className="font-medium" style={{ color: "var(--alerta)" }}>Antes de declarar</p>
            <ul className="mt-1.5 space-y-1" style={{ color: "var(--texto-suave)" }}>
              {l.avisos.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Bloque titulo="Ventas" casillas={l.ventas} />
          <Bloque titulo="Compras" casillas={l.compras} />
          <Bloque titulo="Determinación del IGV" casillas={l.igv} />
          <Bloque titulo="Impuesto a la renta" casillas={l.renta} />
          {l.agente.length > 0 && (
            <div className="lg:col-span-2">
              <Bloque titulo="Retenciones y percepciones efectuadas" casillas={l.agente} />
            </div>
          )}
        </div>

        <p className="mt-5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Esto no declara nada: es el papel donde se apuntaban los números antes de teclearlos en el
          PDT. Declarar sigue siendo un acto de la empresa ante SUNAT. La exportación entrega las
          casillas en CSV; el archivo binario que el PDT importa cambia de estructura con cada
          versión del programa, y no se genera hasta tener la de la versión que usa la empresa.
        </p>
      </Contenido>
    </>
  );
}
