import Link from "next/link";
import type { Route } from "next";
import { POR_PAGINA, totalPaginas } from "@/lib/paginacion";

/**
 * Pie de paginación de un listado.
 *
 * Dos enlaces y una cuenta. No hay numeritos del 1 al 20 porque en un ERP no se
 * navega por número de página: se filtra y se busca. Lo único que de verdad se
 * usa es «la siguiente» y saber cuántas filas hay en total, que es el dato que
 * contesta «¿está todo?».
 *
 * Son enlaces, no botones: funcionan sin JavaScript, el navegador los precarga,
 * se abren en otra pestaña con el botón del medio y el botón de atrás hace lo
 * que debe. Un componente de cliente con estado aquí sería trabajo de más para
 * hacerlo peor.
 *
 * Conserva el resto de los parámetros de la dirección. Sin eso, pasar de página
 * en una lista filtrada borraría el filtro, que es la forma más rápida de que
 * el usuario pierda lo que estaba viendo.
 */
export function Paginacion({
  total,
  pagina,
  porPagina = POR_PAGINA,
  params,
  etiqueta = "filas",
}: {
  /** Filas que hay en total, no las de esta página. */
  total: number;
  pagina: number;
  porPagina?: number;
  /** Los `searchParams` de la pantalla, para no perder los filtros al paginar. */
  params: Record<string, string | string[] | undefined>;
  /** Cómo se llama lo que se lista: «cuentas», «asientos», «trabajadores». */
  etiqueta?: string;
}) {
  const ultima = totalPaginas(total, porPagina);
  if (ultima <= 1) return null;

  const actual = Math.min(Math.max(1, pagina), ultima);
  const desde = (actual - 1) * porPagina + 1;
  const hasta = Math.min(actual * porPagina, total);

  const enlace = (p: number): Route => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "pagina" || v === undefined) continue;
      for (const uno of Array.isArray(v) ? v : [v]) q.append(k, uno);
    }
    if (p > 1) q.set("pagina", String(p));
    const cola = q.toString();
    return (cola ? `?${cola}` : "?") as Route;
  };

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
      style={{ borderColor: "var(--borde)" }}
      aria-label="Paginación"
    >
      <p className="text-[13px]" style={{ color: "var(--texto-suave)" }}>
        <span className="cifra">{desde}</span>
        {"–"}
        <span className="cifra">{hasta}</span> de <span className="cifra">{total}</span> {etiqueta}
      </p>
      <div className="flex gap-2">
        {actual > 1 ? (
          <Link href={enlace(actual - 1)} className="boton boton-secundario" rel="prev">
            Anterior
          </Link>
        ) : (
          <span className="boton boton-secundario opacity-40" aria-disabled="true">
            Anterior
          </span>
        )}
        <span className="self-center text-[13px]" style={{ color: "var(--texto-tenue)" }}>
          <span className="cifra">{actual}</span> / <span className="cifra">{ultima}</span>
        </span>
        {actual < ultima ? (
          <Link href={enlace(actual + 1)} className="boton boton-secundario" rel="next">
            Siguiente
          </Link>
        ) : (
          <span className="boton boton-secundario opacity-40" aria-disabled="true">
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
