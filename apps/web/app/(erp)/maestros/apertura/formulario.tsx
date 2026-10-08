"use client";

/**
 * Carga de los saldos del día del cambio.
 *
 * Tres hojas y un solo botón, en este orden: se pegan, **se mira el cuadro** y
 * recién entonces se carga. La apertura no es una operación repetible —duplica
 * la cartera si se corre dos veces, y no se deshace una vez que hay cobranzas
 * encima—, así que la pantalla insiste en el paso intermedio.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { analizarAccion, cargarAccion, type EstadoApertura } from "./acciones";

type Hoja = {
  clave: "cxc" | "cxp" | "stock";
  titulo: string;
  columnas: string;
  ejemplo: string;
  nota: string;
};

const HOJAS: Hoja[] = [
  {
    clave: "cxc",
    titulo: "Deudas de clientes",
    columnas: "Tipo · Serie · Número · RUC del cliente · Emisión · Vencimiento · Moneda · T.C. · Saldo",
    ejemplo: "01\tFA01\t1200\t20522633721\t15/07/2026\t14/09/2026\tPEN\t1\t8500.00",
    nota:
      "El saldo es lo que queda por cobrar, no el importe original de la factura: " +
      "sus cobranzas parciales ocurrieron en el sistema anterior.",
  },
  {
    clave: "cxp",
    titulo: "Deudas a proveedores",
    columnas: "Tipo · Serie · Número · RUC del proveedor · Emisión · Vencimiento · Moneda · T.C. · Saldo",
    ejemplo: "01\tF500\t880\t20512333338\t20/07/2026\t19/09/2026\tPEN\t1\t4700.00",
    nota: "Igual que arriba: lo que queda por pagar.",
  },
  {
    clave: "stock",
    titulo: "Existencias",
    columnas: "Código del producto · Código del almacén · Cantidad · Costo unitario",
    ejemplo: "P001\t001\t40\t320.00",
    nota:
      "El costo unitario es con el que la mercadería entra al kardex y desde el " +
      "que sigue el promedio. Un costo mal puesto arrastra el costo de ventas de todo el año.",
  },
];

function Boton({ texto, variante = "primario" }: { texto: string; variante?: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${variante}`} disabled={pending}>
      {pending ? "Procesando…" : texto}
    </button>
  );
}

const Cifra = ({ v }: { v: string }) => (
  <span className="cifra">{Number(v).toLocaleString("es-PE", { minimumFractionDigits: 2 })}</span>
);

export function CargaDeApertura({ yaCargada }: { yaCargada: boolean }) {
  const [analisis, analizar] = useActionState<EstadoApertura, FormData>(analizarAccion, {});
  const [carga, cargar] = useActionState<EstadoApertura, FormData>(cargarAccion, {});
  const estado = carga.error ? carga : analisis;
  const a = estado.analisis;

  if (yaCargada) {
    return (
      <section className="bloque p-4">
        <h2 className="mb-2 text-sm font-semibold">Los saldos ya están cargados</h2>
        <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
          Esta empresa ya tiene su apertura hecha. Volver a cargarla duplicaría la cartera y el
          stock, así que la pantalla no lo permite. Si hubo un error, hay que extornar el asiento de
          apertura y anular los documentos uno a uno — conviene revisarlo antes de que haya
          cobranzas y pagos encima.
        </p>
      </section>
    );
  }

  const filasConProblema = a
    ? [...a.cxc, ...a.cxp, ...a.stock].filter((f) => f.problemas.length > 0)
    : [];

  return (
    <div className="space-y-5">
      <form action={analizar} className="space-y-5">
        <section className="bloque p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="fecha">Fecha de corte</label>
              <input id="fecha" name="fecha" type="date" className="campo" required
                defaultValue={estado.fecha ?? ""} />
              <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
                El último día que se trabajó en el sistema anterior. Es la fecha del asiento.
              </p>
            </div>
            <div>
              <label className="etiqueta" htmlFor="glosa">Glosa del asiento</label>
              <input id="glosa" name="glosa" className="campo" maxLength={200}
                placeholder="Saldos de apertura al…" />
            </div>
          </div>
        </section>

        {HOJAS.map((h) => (
          <section key={h.clave} className="bloque p-4">
            <label className="etiqueta" htmlFor={h.clave}>{h.titulo}</label>
            <textarea
              id={h.clave}
              name={h.clave}
              className="campo font-mono"
              rows={6}
              spellCheck={false}
              defaultValue={estado.hojas?.[h.clave] ?? ""}
              placeholder={h.ejemplo}
              style={{ whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" }}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              <strong>{h.columnas}</strong>. {h.nota}
            </p>
          </section>
        ))}

        <div className="flex items-center gap-3">
          <Boton texto="Analizar" variante="secundario" />
          <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
            Analizar no carga nada. Columnas separadas por tabulación (pegar desde Excel) o punto y
            coma; las cifras admiten el formato peruano 1.500,00.
          </span>
        </div>
      </form>

      {estado.error && (
        <div className="aviso" role="alert">
          {estado.error}
          {estado.motivos && estado.motivos.length > 1 && (
            <ul className="mt-1 list-disc pl-5">
              {estado.motivos.slice(1).map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </div>
      )}

      {a && (
        <section className="bloque">
          <div className="grid gap-6 border-b p-4 sm:grid-cols-4" style={{ borderColor: "var(--borde)" }}>
            <div>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>Deudas de clientes</p>
              <p className="text-lg font-medium"><Cifra v={a.totales.cxc} /></p>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>{a.cxc.length} documentos</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>Deudas a proveedores</p>
              <p className="text-lg font-medium"><Cifra v={a.totales.cxp} /></p>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>{a.cxp.length} documentos</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>Existencias</p>
              <p className="text-lg font-medium"><Cifra v={a.totales.stock} /></p>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>{a.stock.length} artículos</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
                Contrapartida · cuenta {a.cuentaContrapartida}
              </p>
              <p className="text-lg font-medium"><Cifra v={a.contrapartida} /></p>
              {/*
                Es la cifra que el contador tiene que mirar antes de confirmar. Un
                descuadre en el asiento de apertura contamina todos los estados
                financieros del ejercicio y no se encuentra nunca.
              */}
              <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
                el patrimonio con el que empieza aquí
              </p>
            </div>
          </div>

          {(a.faltantes.terceros.length > 0 ||
            a.faltantes.productos.length > 0 ||
            a.faltantes.almacenes.length > 0) && (
            <div className="border-b px-4 py-3 text-sm" style={{ borderColor: "var(--borde)" }}>
              {/*
                No se dan de alta solos: hacerlo desde una hoja pegada llenaría el
                maestro de razones sociales mal escritas y duplicadas.
              */}
              <p className="mb-1 font-medium">Falta darlos de alta antes de cargar:</p>
              <ul className="list-disc pl-5" style={{ color: "var(--texto-suave)" }}>
                {a.faltantes.terceros.length > 0 && (
                  <li>Terceros: <span className="cifra">{a.faltantes.terceros.join(", ")}</span></li>
                )}
                {a.faltantes.productos.length > 0 && (
                  <li>Productos: <span className="cifra">{a.faltantes.productos.join(", ")}</span></li>
                )}
                {a.faltantes.almacenes.length > 0 && (
                  <li>Almacenes: <span className="cifra">{a.faltantes.almacenes.join(", ")}</span></li>
                )}
              </ul>
            </div>
          )}

          {filasConProblema.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="w-12">Línea</th>
                    <th>Fila</th>
                    <th>Problema</th>
                  </tr>
                </thead>
                <tbody>
                  {filasConProblema.map((f, i) => (
                    <tr key={i} style={{ background: "color-mix(in srgb, var(--peligro) 6%, transparent)" }}>
                      <td className="cifra">{f.linea}</td>
                      <td className="cifra max-w-[320px] truncate" style={{ textAlign: "left" }}>
                        {Object.values(f.campos).filter(Boolean).join(" · ")}
                      </td>
                      <td className="text-xs" style={{ color: "var(--peligro)" }}>
                        {f.problemas.join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t px-4 py-2 text-xs"
                style={{ borderColor: "var(--borde)", color: "var(--peligro)" }}>
                La apertura es todo o nada: no se carga nada mientras quede una fila con problemas.
                A diferencia de la carga en serie de compras, aquí una carga a medias dejaría el
                balance descuadrado desde el primer día.
              </p>
            </div>
          ) : (
            <form action={cargar} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <input type="hidden" name="fecha" value={estado.fecha ?? ""} />
              {HOJAS.map((h) => (
                <input key={h.clave} type="hidden" name={h.clave} value={estado.hojas?.[h.clave] ?? ""} />
              ))}
              <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
                Todo se entiende. Se cargará en una sola transacción y <strong>no se puede repetir</strong>.
              </p>
              <Boton texto="Cargar los saldos" />
            </form>
          )}
        </section>
      )}
    </div>
  );
}
