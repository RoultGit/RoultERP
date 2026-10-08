import { listarCuentas } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia, BotonEnlace } from "@/components/ui";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import { Sincronizar } from "./formulario";

export const metadata = { title: "Plan de cuentas · RoultERP" };
export const dynamic = "force-dynamic";

const ELEMENTO: Record<string, string> = {
  "1": "Activo disponible y exigible",
  "2": "Activo realizable",
  "3": "Activo inmovilizado",
  "4": "Pasivo",
  "5": "Patrimonio",
  "6": "Gastos por naturaleza",
  "7": "Ingresos",
  "8": "Saldos intermediarios de gestión",
  "9": "Contabilidad analítica",
};

export default async function PlanDeCuentas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { q } = params;
  const [cuentas, puedeEditar] = await Promise.all([
    conEmpresa((db) => listarCuentas(db), "maestros:ver"),
    tienePermiso("maestros:editar"),
  ]);

  const filtro = (q ?? "").trim().toLowerCase();
  const visibles = filtro
    ? cuentas.filter(
        (c) =>
          c.cuenta.startsWith(filtro) || c.descripcion.toLowerCase().includes(filtro),
      )
    : cuentas;

  /*
   * El plan completo son setecientas cuentas y la tabla medía casi seis mil
   * píxeles: seis pantallas de rueda para llegar a la 70 y ninguna forma de
   * saber cuánto falta. Se pagina.
   *
   * El corte es en memoria y no en SQL a propósito: el plan de cuentas se
   * consulta entero para el buscador —filtrar por descripción tiene que mirar
   * las setecientas, no las cincuenta visibles— así que traerlo partido
   * obligaría a dos consultas para ahorrar unas decenas de kilobytes.
   */
  const pagina = paginaDe(params.pagina);
  const pagLista = rodaja(visibles, pagina);

  return (
    <>
      <Encabezado
        titulo="Plan de cuentas"
        descripcion="El PCGE de la empresa. Cada cuenta declara qué exige al contabilizar: tercero, centro de costo o documento."
        acciones={
          <div className="flex flex-wrap items-start gap-2">
            <BotonEnlace href="/maestros" variante="secundario">Maestros</BotonEnlace>
            {puedeEditar && <Sincronizar />}
          </div>
        }
      />
      <Contenido>
        <form className="flex items-end gap-2">
          <div>
            <label className="etiqueta" htmlFor="q">Buscar</label>
            <input
              id="q" name="q" defaultValue={q ?? ""} className="campo max-w-xs"
              placeholder="42 o «proveedores»"
            />
          </div>
          <button className="boton boton-secundario">Filtrar</button>
          <span className="ml-auto text-sm" style={{ color: "var(--texto-suave)" }}>
            {visibles.length} de {cuentas.length} cuentas
          </span>
        </form>

        <div className="bloque overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Descripción</th>
                <th>Elemento</th>
                <th>Naturaleza</th>
                <th>Exige</th>
              </tr>
            </thead>
            <tbody>
              {pagLista.map((c) => (
                <tr key={c.cuenta}>
                  <td className="cifra" style={{ textAlign: "left" }}>
                    {/* Las de movimiento son las que admiten asiento; las demás
                        son sólo el árbol que las agrupa. */}
                    {c.esMovimiento ? <strong>{c.cuenta}</strong> : c.cuenta}
                  </td>
                  <td style={{ paddingLeft: `${0.75 + (c.cuenta.length - 2) * 0.6}rem` }}>
                    {c.descripcion}
                  </td>
                  <td style={{ color: "var(--texto-suave)" }}>
                    {ELEMENTO[c.cuenta[0] ?? ""] ?? "—"}
                  </td>
                  <td style={{ color: "var(--texto-suave)" }}>{c.naturaleza}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {c.exigeAnexo && <Insignia tono="alerta">tercero</Insignia>}
                      {c.exigeCentroCosto && <Insignia tono="alerta">centro de costo</Insignia>}
                      {c.exigeDocumento && <Insignia tono="alerta">documento</Insignia>}
                      {!c.esMovimiento && <Insignia>no acepta asiento</Insignia>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginacion total={visibles.length} pagina={pagina} params={params} etiqueta="cuentas" />
        </div>
      </Contenido>
    </>
  );
}
