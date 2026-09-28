import Link from "next/link";
import type { Route } from "next";
import { pendientesDeLlegar } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";

export const metadata = { title: "Importaciones en camino · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * Lo que está en el agua o en aduana.
 *
 * Es la pantalla que se abre por la mañana, así que ordena por retraso y no por
 * fecha: la pregunta que responde es «¿a quién llamo hoy?». Un embarque
 * liquidado ya no es una pregunta abierta y no aparece.
 *
 * Tres columnas dicen tres cosas distintas y no se mezclan. **Días en curso**
 * cuenta desde la orden y sirve para el que no tiene fecha pactada. **Retraso**
 * sólo existe si alguien fijó la llegada, y en blanco significa «no se sabe
 * cuándo», que no es lo mismo que «llega a tiempo». **Papeles** son los
 * documentos anotados que siguen sin llegar, porque el que se descubre en el
 * puerto se paga en almacenaje.
 */
export default async function Pendientes() {
  const lista = await conEmpresa((db) => pendientesDeLlegar(db), "importaciones:ver");

  const enSoles = lista.reduce((a, f) => a + Number(f.fobSoles), 0);
  const atrasados = lista.filter((f) => (f.diasRetraso ?? 0) > 0);
  const sinFecha = lista.filter((f) => f.diasRetraso === null);

  return (
    <>
      <Encabezado
        titulo="Importaciones en camino"
        descripcion="Embarques ordenados, en tránsito o en aduana. Se ordenan por retraso: arriba está lo que hay que perseguir hoy."
        acciones={
          <div className="flex items-center gap-2">
            <Link href={"/importaciones/reportes" as Route} className="boton boton-secundario">
              Reportes
            </Link>
            <Link href={"/importaciones" as Route} className="boton boton-secundario">
              Todas
            </Link>
          </div>
        }
      />
      <Contenido>
        <dl className="tarjeta mb-5 flex flex-wrap gap-8 p-4">
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Embarques abiertos</dt>
            <dd className="text-lg font-medium">{lista.length}</dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>FOB comprometido (S/)</dt>
            <dd className="text-lg font-medium">
              <Importe valor={enSoles.toFixed(2)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Con retraso</dt>
            <dd className="text-lg font-medium" style={atrasados.length ? { color: "var(--peligro)" } : undefined}>
              {atrasados.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Sin fecha pactada</dt>
            <dd className="text-lg font-medium" style={sinFecha.length ? { color: "var(--alerta)" } : undefined}>
              {sinFecha.length}
            </dd>
          </div>
        </dl>

        <section className="tarjeta overflow-x-auto">
          {lista.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay embarques en camino"
                descripcion="Todo lo ordenado está liquidado. Cuando dé de alta una importación aparecerá aquí hasta que la liquide."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Importación</th>
                  <th>Proveedor del exterior</th>
                  <th>Estado</th>
                  <th>Origen</th>
                  <th className="text-right">FOB</th>
                  <th className="text-right">FOB (S/)</th>
                  <th className="text-right">Días en curso</th>
                  <th className="text-right">Retraso</th>
                  <th className="text-right">Papeles</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/importaciones/${f.id}` as Route} className="font-medium underline">
                        {f.numero}
                      </Link>
                      <div className="text-xs" style={{ color: "var(--texto-suave)" }}>
                        orden {f.fechaOrden}
                        {f.fechaLlegada ? ` · llega ${f.fechaLlegada}` : ""}
                      </div>
                    </td>
                    <td className="max-w-[240px] truncate">{f.proveedor}</td>
                    <td><EstadoDoc estado={f.estado} /></td>
                    <td className="text-xs" style={{ color: "var(--texto-suave)" }}>
                      {[f.puertoOrigen, f.incoterm].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td>
                      <Importe valor={f.fob} /> <span className="text-xs">{f.moneda}</span>
                    </td>
                    <td><Importe valor={f.fobSoles} /></td>
                    <td className="cifra">{f.diasEnCurso}</td>
                    <td className="cifra">
                      {f.diasRetraso === null ? (
                        <Insignia tono="alerta">sin fecha</Insignia>
                      ) : f.diasRetraso > 0 ? (
                        <strong style={{ color: "var(--peligro)" }}>{f.diasRetraso} d</strong>
                      ) : (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      )}
                    </td>
                    <td className="cifra">
                      {f.documentosVencidos > 0 ? (
                        <Insignia tono="peligro">faltan {f.documentosVencidos}</Insignia>
                      ) : (
                        <span style={{ color: "var(--texto-suave)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p
            className="border-t px-4 py-2 text-xs"
            style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}
          >
            El FOB en soles usa el tipo de cambio del embarque, que es el que después llevará la
            liquidación. No incluye flete, derechos ni agencia: eso sale del costo puesto en almacén,
            y sólo existe cuando el embarque se liquida.
          </p>
        </section>
      </Contenido>
    </>
  );
}
