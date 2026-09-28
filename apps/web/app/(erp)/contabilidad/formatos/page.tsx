import Link from "next/link";
import type { Route } from "next";
import { listarFormatos, cargarFormato, FormatoInvalido } from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Contenido, Encabezado, Insignia, Vacio } from "@/components/ui";
import { FormularioFormato, Eliminar, Restaurar } from "./formulario";

export const metadata = { title: "Formatos de estados financieros · RoultERP" };
export const dynamic = "force-dynamic";

const TIPO: Record<string, string> = {
  situacion: "Situación financiera",
  resultados: "Resultados",
};

export default async function Formatos({
  searchParams,
}: {
  searchParams: Promise<{ formato?: string; nuevo?: string; hecho?: string }>;
}) {
  const { formato, nuevo, hecho } = await searchParams;
  const [puedeEditar, puedeAnular] = await Promise.all([
    tienePermiso("contabilidad:editar"),
    tienePermiso("contabilidad:anular"),
  ]);

  const datos = await conEmpresa(async (db) => {
    const formatos = await listarFormatos(db);
    const elegido = formato
      ? await cargarFormato(db, formato).catch((e) => {
          if (e instanceof FormatoInvalido) return null;
          throw e;
        })
      : null;
    return { formatos, elegido };
  }, "contabilidad:ver");

  const anuncio: Record<string, string> = {
    guardado: "Formato guardado. Los estados financieros ya lo ofrecen.",
    restaurados: "Formatos de partida restaurados.",
  };

  return (
    <>
      <Encabezado
        titulo="Formatos de estados financieros"
        descripcion="La plantilla decide cómo se presenta cada estado: qué cuentas entran en cada renglón, en qué orden y con qué subtotales. Los saldos siguen saliendo de los asientos."
        acciones={
          <>
            {puedeEditar && <Restaurar />}
            <Link href={"/contabilidad/estados" as Route} className="boton boton-secundario">
              Ver los estados
            </Link>
          </>
        }
      />
      <Contenido>
        {hecho && anuncio[hecho] && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {anuncio[hecho]}
          </p>
        )}

        <section className="tarjeta mb-5 overflow-x-auto">
          <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
            <h2 className="text-sm font-semibold">Plantillas</h2>
            {puedeEditar && (
              <Link
                href={"/contabilidad/formatos?nuevo=1" as Route}
                className="boton boton-primario !py-1 !text-xs"
              >
                Nuevo formato
              </Link>
            )}
          </div>
          {datos.formatos.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="No hay formatos"
                descripcion="Pulse «Restaurar los de partida» para volver a los dos que trae el programa."
              />
            </div>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th className="text-right">Renglones</th>
                  <th />
                  {puedeAnular && <th className="w-32" />}
                </tr>
              </thead>
              <tbody>
                {datos.formatos.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link
                        href={`/contabilidad/formatos?formato=${f.id}` as Route}
                        className="cifra font-medium underline"
                        style={{ textAlign: "left" }}
                      >
                        {f.codigo}
                      </Link>
                    </td>
                    <td className="max-w-[300px] truncate">{f.nombre}</td>
                    <td>{TIPO[f.tipo] ?? f.tipo}</td>
                    <td className="cifra">{f.renglones}</td>
                    <td>
                      {f.esPredeterminado && <Insignia tono="exito">predeterminado</Insignia>}
                    </td>
                    {puedeAnular && (
                      <td>{!f.esPredeterminado && <Eliminar formatoId={f.id} />}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {puedeEditar && (datos.elegido || nuevo) && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">
              {datos.elegido
                ? `Editar ${datos.elegido.cabecera.codigo}`
                : "Nuevo formato"}
            </h2>
            <FormularioFormato
              inicial={
                datos.elegido
                  ? {
                      codigo: datos.elegido.cabecera.codigo,
                      nombre: datos.elegido.cabecera.nombre,
                      tipo: datos.elegido.cabecera.tipo,
                      esPredeterminado: datos.elegido.cabecera.esPredeterminado,
                      lineas: datos.elegido.lineas.map((l) => ({
                        codigo: l.codigo ?? "",
                        concepto: l.concepto,
                        clase: l.clase,
                        nivel: l.nivel,
                        cuentas: l.cuentas ?? "",
                        signo: l.signo,
                        suma: l.suma ?? "",
                        columna: l.columna ?? "",
                      })),
                    }
                  : null
              }
            />
          </section>
        )}
      </Contenido>
    </>
  );
}
