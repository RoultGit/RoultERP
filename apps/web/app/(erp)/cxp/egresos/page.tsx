import { programacionDeEgresos } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Importe, Insignia, Vacio, BotonEnlace } from "@/components/ui";

export const metadata = { title: "Programación de egresos · RoultERP" };
export const dynamic = "force-dynamic";

const HORIZONTES = [15, 30, 60, 90] as const;

export default async function Egresos({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const dias = HORIZONTES.includes(Number(params.dias) as (typeof HORIZONTES)[number])
    ? Number(params.dias)
    : 60;

  const p = await conEmpresa((db) => programacionDeEgresos(db, { dias }), "cxp:ver");
  const hayVencido = !money.isZero(money.dec(p.vencido));

  return (
    <>
      <Encabezado
        titulo="Programación de egresos"
        descripcion="Todo lo que hay que pagar y cuándo: facturas de proveedor y letras aceptadas."
        acciones={
          <>
            <BotonEnlace href="/cxp" variante="secundario">Cuentas por pagar</BotonEnlace>
            <BotonEnlace href="/cxp/letras" variante="secundario">Letras</BotonEnlace>
          </>
        }
      />
      <Contenido>
        <div className="flex flex-wrap items-center gap-2">
          {HORIZONTES.map((d) => (
            <a
              key={d}
              href={`/cxp/egresos?dias=${d}`}
              className="rounded border px-2.5 py-1 text-xs cifra transition-colors"
              style={{
                borderColor: d === dias ? "var(--acento)" : "var(--borde)",
                background: d === dias ? "var(--acento-suave)" : "var(--superficie)",
                color: d === dias ? "var(--acento)" : "var(--texto-suave)",
              }}
            >
              {d} días
            </a>
          ))}
          <span className="ml-auto flex items-center gap-3">
            {hayVencido && (
              <Insignia tono="peligro">
                Vencido: {money.toString(money.dec(p.vencido), 2)}
              </Insignia>
            )}
            <span className="text-sm">
              Total del periodo: <strong className="cifra">{p.total}</strong>
            </span>
          </span>
        </div>

        {p.lineas.length === 0 ? (
          <Vacio
            titulo={`Nada que pagar en los próximos ${dias} días`}
            descripcion="Aquí aparecen las facturas con saldo y las letras aceptadas, ordenadas por vencimiento."
          />
        ) : (
          <div className="bloque overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Vencimiento</th>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Proveedor</th>
                  <th>Mon.</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {p.lineas.map((l) => (
                  <tr key={`${l.tipo}-${l.id}`}>
                    <td>
                      <span className="cifra">{l.vencimiento}</span>
                      {l.dias < 0 ? (
                        <span className="ml-1.5">
                          <Insignia tono="peligro">{-l.dias} d vencida</Insignia>
                        </span>
                      ) : l.dias <= 7 ? (
                        <span className="ml-1.5">
                          <Insignia tono="alerta">en {l.dias} d</Insignia>
                        </span>
                      ) : null}
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>{l.documento}</td>
                    <td>
                      <Insignia>{l.tipo === "letra" ? "Letra" : "Factura"}</Insignia>
                    </td>
                    <td className="max-w-[240px] truncate">{l.tercero}</td>
                    <td>{l.moneda}</td>
                    <td><Importe valor={l.saldo} /></td>
                    {/* El acumulado es lo que hace útil la lista: dice cuánta
                        caja hace falta hasta esa fecha. */}
                    <td style={{ color: "var(--texto-suave)" }}>
                      <Importe valor={l.acumulado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Contenido>
    </>
  );
}
