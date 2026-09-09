import Link from "next/link";
import type { Route } from "next";
import { registroCompras, inventarioValorizado, LIBROS } from "@roulterp/servicios";
import { conEmpresa } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia } from "@/components/ui";

export const metadata = { title: "Libros electrónicos · RoultERP" };
export const dynamic = "force-dynamic";

function periodoActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Ple({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const params = await searchParams;
  const periodo = /^\d{6}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const libros = await conEmpresa(
    async (db, sesion) => [
      {
        codigo: LIBROS.COMPRAS,
        formato: "8.1",
        nombre: "Registro de compras",
        descripcion:
          "Sustenta el crédito fiscal. SUNAT lo cruza contra las ventas que declaran sus proveedores.",
        resultado: await registroCompras(db, sesion.empresaId, periodo),
      },
      {
        codigo: LIBROS.INVENTARIO_VALORIZADO,
        formato: "13.1",
        nombre: "Inventario permanente valorizado",
        descripcion:
          "Detalla movimiento a movimiento cómo se llegó al costo de las existencias. Se presenta por semestre.",
        resultado: await inventarioValorizado(db, sesion.empresaId, periodo),
      },
    ],
    "contabilidad:ver",
  );

  return (
    <>
      <Encabezado
        titulo="Libros electrónicos"
        descripcion={`Archivos del Programa de Libros Electrónicos para el periodo ${periodo}.`}
        acciones={
          <Link href={`/contabilidad?periodo=${periodo}` as Route} className="boton boton-secundario">
            Volver
          </Link>
        }
      />
      <Contenido>
        <form className="mb-5 flex items-end gap-2" action="/contabilidad/ple">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input
              id="periodo" name="periodo" defaultValue={periodo}
              className="campo w-32 cifra" style={{ textAlign: "left" }}
              pattern="\d{6}" placeholder="202609"
            />
          </div>
          <button className="boton boton-secundario">Cambiar</button>
        </form>

        <div className="space-y-3">
          {libros.map((l) => (
            <div key={l.codigo} className="tarjeta flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Insignia>Formato {l.formato}</Insignia>
                  <h2 className="font-medium">{l.nombre}</h2>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--texto-suave)" }}>
                  {l.descripcion}
                </p>
                <p className="cifra mt-1.5 text-xs" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
                  {l.resultado.nombre} · {l.resultado.filas}{" "}
                  {l.resultado.filas === 1 ? "línea" : "líneas"}
                </p>
              </div>
              <a
                href={`/api/ple?periodo=${periodo}&libro=${l.codigo}`}
                className={`boton ${l.resultado.filas === 0 ? "boton-secundario" : "boton-primario"}`}
                download
              >
                Descargar
              </a>
            </div>
          ))}
        </div>

        <div className="tarjeta mt-5 p-4 text-sm">
          <h2 className="mb-2 font-medium">Antes de subirlo al PLE</h2>
          <ul className="space-y-1" style={{ color: "var(--texto-suave)" }}>
            <li>· El archivo va en Latin-1 y con saltos CRLF, que es lo que espera el validador.</li>
            <li>· El nombre no se cambia: el aplicativo lo rechaza por el nombre antes de leerlo.</li>
            <li>· Un libro sin operaciones también se presenta; su nombre lo declara así.</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: "var(--texto-suave)" }}>
            Faltan por implementar los formatos 5.1 (diario), 6.1 (mayor), 8.2 (no domiciliados),
            12.1 (inventario en unidades) y 14.1 (ventas), este último cuando exista el módulo de
            ventas.
          </p>
        </div>
      </Contenido>
    </>
  );
}
