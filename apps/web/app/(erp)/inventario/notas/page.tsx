import Link from "next/link";
import type { Route } from "next";
import { asc, eq } from "drizzle-orm";
import {
  listarNotas, cargarNota, listarAlmacenes, listarProductos, listarCuentas,
  listarCentrosCosto, listarTerceros,
} from "@roulterp/servicios";
import { conEmpresa, tienePermiso } from "@/lib/sesion";
import { Paginacion } from "@/components/paginacion";
import { paginaDe, rodaja } from "@/lib/paginacion";
import { Contenido, Encabezado, EstadoDoc, Importe, Insignia, Vacio } from "@/components/ui";
import { FormularioNota } from "./formulario";

export const metadata = { title: "Notas de almacén · RoultERP" };
export const dynamic = "force-dynamic";

const TIPO: Record<string, string> = {
  ingreso: "Ingreso",
  salida: "Salida",
  transferencia: "Transferencia",
  ajuste: "Ajuste",
};

/** Catálogo 12 de SUNAT, con el nombre que entiende el almacenero. */
const OPERACION: Record<string, string> = {
  "00": "Saldo inicial", "03": "Devolución recibida", "04": "Devolución entregada",
  "05": "Transferencia entrada", "06": "Transferencia salida", "10": "Consumo",
  "16": "Ajuste entrada", "17": "Ajuste salida",
};

export default async function NotasAlmacen({
  searchParams,
}: {
  searchParams: Promise<{ nota?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { nota } = params;
  const pagina = paginaDe(params.pagina);
  const puedeCrear = await tienePermiso("inventario:crear");

  const datos = await conEmpresa(async (db) => {
    const [notas, almacenes, productos, cuentas, centros, terceros] = await Promise.all([
      listarNotas(db),
      listarAlmacenes(db),
      listarProductos(db),
      listarCuentas(db, true),
      listarCentrosCosto(db),
      listarTerceros(db),
    ]);
    const reciente = nota ? await cargarNota(db, nota).catch(() => null) : null;
    return { notas, almacenes, productos, cuentas, centros, terceros, reciente };
  }, "inventario:ver");

  return (
    <>
      <Encabezado
        titulo="Notas de almacén"
        descripcion="Los movimientos que no vienen de comprar ni de vender: consumos, mermas, traslados entre almacenes y el cuadre del inventario físico."
        acciones={<Link href={"/inventario" as Route} className="boton boton-secundario">Existencias</Link>}
      />
      <Contenido>
        {datos.reciente && (
          <p
            className="mb-4 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)",
              color: "var(--exito)",
            }}
            role="status"
          >
            {TIPO[datos.reciente.cabecera.tipo]} {datos.reciente.cabecera.numero} registrada
            {datos.reciente.cabecera.asientoId
              ? " y contabilizada."
              : ". Una transferencia no genera asiento: la mercadería no cambia de cuenta."}
          </p>
        )}

        {puedeCrear && (
          <div className="mb-5">
            <FormularioNota
              almacenes={datos.almacenes
                .filter((a) => a.activo)
                .map((a) => ({ id: a.id, etiqueta: a.nombre }))}
              productos={datos.productos
                .filter((p) => p.tipo === "bien")
                .map((p) => ({ id: p.id, etiqueta: `${p.codigo} — ${p.descripcion}` }))}
              cuentas={datos.cuentas
                // Contrapartidas razonables: gasto, ingreso o patrimonio. La 20
                // no se ofrece: es siempre el otro lado del asiento.
                .filter((c) => /^(5|6|7)/.test(c.cuenta))
                .map((c) => ({ id: c.cuenta, etiqueta: `${c.cuenta} — ${c.descripcion}` }))}
              centrosCosto={datos.centros
                .filter((c) => c.activo)
                .map((c) => ({ id: c.id, etiqueta: `${c.codigo} — ${c.nombre}` }))}
              terceros={datos.terceros.map((t) => ({
                id: t.id,
                etiqueta: `${t.razonSocial} · ${t.numeroDocumento}`,
              }))}
            />
          </div>
        )}

        <section className="bloque overflow-x-auto">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--borde)" }}>
            Registradas
          </h2>
          {datos.notas.length === 0 ? (
            <div className="p-4">
              <Vacio
                titulo="Todavía no hay notas"
                descripcion="Aquí quedan los movimientos de almacén que no nacen de una compra o una venta."
              />
            </div>
          ) : (
            <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Almacén</th>
                  <th>Motivo</th>
                  <th>Operación</th>
                  <th className="text-right">Importe S/</th>
                  <th>Contabilizada</th>
                </tr>
              </thead>
              <tbody>
                {rodaja(datos.notas, pagina).map((n) => (
                  <tr key={n.id}>
                    <td className="cifra" style={{ textAlign: "left" }}>{n.numero}</td>
                    <td><Insignia>{TIPO[n.tipo] ?? n.tipo}</Insignia></td>
                    <td className="cifra">{n.fecha}</td>
                    <td className="max-w-[180px] truncate">{n.almacen ?? "—"}</td>
                    <td className="max-w-[240px] truncate">{n.glosa}</td>
                    <td style={{ color: "var(--texto-suave)" }}>
                      {OPERACION[n.tipoOperacion] ?? n.tipoOperacion}
                    </td>
                    <td><Importe valor={n.importe} /></td>
                    <td>
                      {n.asientoId ? (
                        <EstadoDoc estado="contabilizado" />
                      ) : (
                        <span style={{ color: "var(--texto-suave)" }}>sin asiento</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginacion
              total={datos.notas.length}
              pagina={pagina}
              params={params}
              etiqueta="notas"
            />
            </>
          )}
        </section>
      </Contenido>
    </>
  );
}
