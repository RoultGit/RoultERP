"use client";

/**
 * Carga en serie del registro de compras.
 *
 * Dos pasos y en este orden: se pega, se **mira el cuadro**, y sólo entonces se
 * registra. Contabilizar doscientas facturas sin que nadie haya visto qué
 * entendió el sistema es exactamente lo que esta pantalla existe para evitar:
 * una compra mal registrada ya no se borra, se extorna.
 *
 * La hoja se pega tal cual sale de Excel —tabulaciones— o de un CSV con punto y
 * coma. No hay subida de archivo ni asignación de columnas: pegar es lo que la
 * contadora ya sabe hacer, y un diálogo de columnas es una pantalla más que
 * aprender para ahorrar un Ctrl+V.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { analizarAccion, registrarAccion, type EstadoLote } from "./acciones";

const EJEMPLO = [
  "01/09/2026\t01\tF001\t1234\t20512333338\tPEN\t1\t1500.00\t270.00\t639\tGEN\tAgenciamiento",
  "03/09/2026\t01\tF001\t1235\t20512333338\tPEN\t1\t850.50\t153.09\t639\tGEN\tGastos operativos",
].join("\n");

const CABECERAS = [
  "Fecha", "Tipo", "Serie", "Número", "RUC", "Moneda", "T.C.",
  "Base", "IGV", "Cuenta", "C. costo", "Glosa",
];

function Boton({ texto, variante = "primario" }: { texto: string; variante?: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${variante}`} disabled={pending}>
      {pending ? "Procesando…" : texto}
    </button>
  );
}

export function CargaEnSerie() {
  const [analisis, analizar] = useActionState<EstadoLote, FormData>(analizarAccion, {});
  const [registro, registrar] = useActionState<EstadoLote, FormData>(registrarAccion, {});

  // Gana lo último que se hizo: tras registrar, el cuadro muestra el resultado.
  const estado = registro.analisis || registro.error ? registro : analisis;
  const a = estado.analisis;
  const r = estado.resultado;
  type Desenlace = { tono: "exito" | "peligro" | "neutro"; texto: string };
  const porLinea = new Map<number, Desenlace>([
    ...(r?.rechazadas ?? []).map(
      (x) => [x.linea, { tono: "peligro", texto: x.motivo }] as [number, Desenlace],
    ),
    ...(r?.registradas ?? []).map(
      (x) => [x.linea, { tono: "exito", texto: "registrada" }] as [number, Desenlace],
    ),
    ...(r?.omitidas ?? []).map(
      (x) => [x.linea, { tono: "neutro", texto: x.motivo }] as [number, Desenlace],
    ),
  ]);

  return (
    <div className="space-y-5">
      <form action={analizar} className="tarjeta p-4">
        <label className="etiqueta" htmlFor="hoja">
          Pegue aquí las filas, una factura por línea
        </label>
        <textarea
          id="hoja"
          name="hoja"
          className="campo font-mono"
          rows={10}
          spellCheck={false}
          defaultValue={estado.hoja ?? ""}
          placeholder={EJEMPLO}
          style={{ whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }}
        />
        <div className="mt-2 overflow-x-auto">
          <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
            Columnas, en este orden: <strong>{CABECERAS.join(" · ")}</strong>. Separadas por
            tabulación (copiar y pegar desde Excel) o por punto y coma. Si la primera fila son los
            títulos, se descarta sola. Las cifras admiten el formato peruano: 1.500,00.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Boton texto="Analizar" variante="secundario" />
          <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
            Analizar no registra nada.
          </span>
        </div>
      </form>

      {estado.error && (
        <div className="aviso" role="alert">
          {estado.error}
        </div>
      )}
      {estado.exito && (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            color: "var(--exito)",
            borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)",
          }}
          role="status"
        >
          {estado.exito}
        </p>
      )}

      {a && (
        <section className="tarjeta overflow-x-auto">
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: "var(--borde)" }}
          >
            <dl className="flex flex-wrap gap-6">
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Listas</dt>
                <dd className="text-lg font-medium" style={{ color: "var(--exito)" }}>{a.listas}</dd>
              </div>
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Con problemas</dt>
                <dd className="text-lg font-medium" style={a.conProblemas ? { color: "var(--peligro)" } : undefined}>
                  {a.conProblemas}
                </dd>
              </div>
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>Ya registradas</dt>
                <dd className="text-lg font-medium">{a.repetidas}</dd>
              </div>
              <div>
                <dt className="text-xs" style={{ color: "var(--texto-suave)" }}>A contabilizar (S/)</dt>
                <dd className="text-lg font-medium">{a.totalAContabilizar}</dd>
              </div>
            </dl>

            {a.listas > 0 && !r && (
              <form action={registrar}>
                <input type="hidden" name="hoja" value={estado.hoja ?? ""} />
                <Boton texto={`Registrar ${a.listas} factura${a.listas === 1 ? "" : "s"}`} />
              </form>
            )}
          </div>

          {a.proveedoresFaltantes.length > 0 && (
            <p className="border-b px-4 py-2 text-sm" style={{ borderColor: "var(--borde)" }}>
              {/*
                No se dan de alta solos: hacerlo desde una hoja pegada llenaría el
                maestro de razones sociales mal escritas y duplicadas.
              */}
              Faltan estos proveedores en el maestro:{" "}
              <span className="cifra">{a.proveedoresFaltantes.join(", ")}</span>. Déles de alta en
              Maestros → Terceros y vuelva a pegar la hoja.
            </p>
          )}

          <table className="tabla">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Fecha</th>
                <th>Documento</th>
                <th>Proveedor</th>
                <th>Cuenta</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {a.filas.map((f) => {
                const desenlace = porLinea.get(f.linea);
                const mal = f.problemas.length > 0;
                return (
                  <tr
                    key={f.linea}
                    style={
                      mal
                        ? { background: "color-mix(in srgb, var(--peligro) 6%, transparent)" }
                        : undefined
                    }
                  >
                    <td className="cifra">{f.linea}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>{f.crudo.fecha}</td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {f.crudo.serie}-{f.crudo.numero}
                    </td>
                    <td className="max-w-[240px] truncate">
                      {f.proveedor ?? (
                        <span className="cifra" style={{ color: "var(--texto-suave)" }}>
                          {f.crudo.rucProveedor || "—"}
                        </span>
                      )}
                    </td>
                    <td className="cifra" style={{ textAlign: "left" }}>
                      {f.crudo.cuenta}
                      {f.crudo.centroCosto ? ` · ${f.crudo.centroCosto}` : ""}
                    </td>
                    <td className="cifra">{f.total}</td>
                    <td className="text-xs">
                      {desenlace ? (
                        <span
                          style={{
                            color:
                              desenlace.tono === "exito"
                                ? "var(--exito)"
                                : desenlace.tono === "peligro"
                                  ? "var(--peligro)"
                                  : "var(--texto-suave)",
                          }}
                        >
                          {desenlace.texto}
                        </span>
                      ) : mal ? (
                        <span style={{ color: "var(--peligro)" }}>{f.problemas.join("; ")}</span>
                      ) : f.repetida ? (
                        <span style={{ color: "var(--texto-suave)" }}>ya registrada</span>
                      ) : (
                        <span style={{ color: "var(--exito)" }}>lista</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p
            className="border-t px-4 py-2 text-xs"
            style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}
          >
            Cada factura se registra por separado: una fila con un error no impide que entren las
            demás. Corrija las que fallaron y vuelva a pegar la hoja entera — las que ya entraron se
            reconocen y no se duplican.
          </p>
        </section>
      )}
    </div>
  );
}
