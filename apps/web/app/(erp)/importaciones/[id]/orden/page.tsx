import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { cargar, ImportacionInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Orden de importación · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * La orden de importación, en forma de documento.
 *
 * Es lo que se le manda al exportador, así que está escrita para salir en papel
 * y no para operarse: sin menú, sin botones y con las casillas de firma que
 * Starsoft imprime. Lo que se ve en pantalla es exactamente lo que sale por la
 * impresora, que es la única manera de que nadie descubra en la hoja que
 * faltaba un dato.
 */
export default async function OrdenImportacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const imp = await cargar(db, id).catch((e) => {
      if (e instanceof ImportacionInvalida) return null;
      throw e;
    });
    if (!imp) return null;

    const [empresa] = (await db.execute(sql`
      SELECT razon_social, ruc, direccion FROM empresas`)) as unknown as [
      { razon_social: string; ruc: string; direccion: string | null },
    ];
    const [proveedor] = (await db.execute(sql`
      SELECT razon_social, numero_documento, direccion, pais
      FROM terceros WHERE id = ${imp.cabecera.proveedorId}`)) as unknown as [
      { razon_social: string; numero_documento: string; direccion: string | null; pais: string | null },
    ];
    return { ...imp, empresa, proveedor };
  }, "importaciones:ver");

  if (!datos) notFound();
  const { cabecera, items, gastos, empresa, proveedor } = datos;

  const fob = items.reduce(
    (a, i) => money.add(a, money.round(money.mul(money.dec(i.cantidad), money.dec(i.fobUnitario)), 6)),
    money.ZERO,
  );

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-imprimir mb-5 flex justify-end gap-2">
        <Imprimir />
        <Link href={`/importaciones/${id}` as Route} className="boton boton-secundario">
          Volver a la importación
        </Link>
      </div>

      <header
        className="flex items-start justify-between gap-6 border-b pb-4"
        style={{ borderColor: "var(--borde-fuerte)" }}
      >
        <div>
          <h1 className="text-lg font-semibold">{empresa?.razon_social}</h1>
          <p className="cifra text-sm" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
            RUC {empresa?.ruc}
          </p>
          {empresa?.direccion && (
            <p className="text-sm" style={{ color: "var(--texto-suave)" }}>{empresa.direccion}</p>
          )}
        </div>
        <div className="text-right">
          <h2 className="text-base font-semibold uppercase tracking-wide">Orden de importación</h2>
          <p className="cifra text-lg font-medium">{cabecera.numero}</p>
          <p className="cifra text-sm" style={{ color: "var(--texto-suave)" }}>
            {cabecera.fechaOrden}
          </p>
        </div>
      </header>

      <section className="grid gap-4 border-b py-4 sm:grid-cols-2" style={{ borderColor: "var(--borde)" }}>
        <div>
          <p className="text-xs uppercase" style={{ color: "var(--texto-suave)" }}>Proveedor del exterior</p>
          <p className="font-medium">{proveedor?.razon_social}</p>
          <p className="cifra text-sm" style={{ textAlign: "left" }}>{proveedor?.numero_documento}</p>
          {proveedor?.direccion && <p className="text-sm">{proveedor.direccion}</p>}
          {proveedor?.pais && <p className="text-sm">{proveedor.pais}</p>}
        </div>
        <dl className="space-y-1 text-sm">
          {[
            ["Incoterm", cabecera.incoterm ?? "—"],
            ["Moneda", cabecera.moneda],
            ["Tipo de cambio", money.toString(money.dec(cabecera.tipoCambio), 3)],
            ["Factura del exterior", cabecera.facturaExterior ?? "—"],
            ["Puerto de origen", cabecera.puertoOrigen ?? "—"],
            ["Puerto de destino", cabecera.puertoDestino ?? "—"],
            ["Embarque previsto", cabecera.fechaEmbarque ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt style={{ color: "var(--texto-suave)" }}>{k}</dt>
              <dd className="cifra" style={{ textAlign: "right" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <table className="tabla mt-4">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Código</th>
            <th>Descripción</th>
            <th>Partida</th>
            <th className="text-right">Cantidad</th>
            <th className="text-right">FOB unit.</th>
            <th className="text-right">FOB total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="cifra" style={{ textAlign: "left" }}>{i.linea}</td>
              <td className="cifra" style={{ textAlign: "left" }}>{i.codigo}</td>
              <td>{i.descripcion}</td>
              <td className="cifra" style={{ textAlign: "left" }}>{i.partidaArancelaria ?? "—"}</td>
              <td><Importe valor={i.cantidad} /></td>
              <td><Importe valor={i.fobUnitario} decimales={4} /></td>
              <td>
                <Importe
                  valor={money.toString(
                    money.round(money.mul(money.dec(i.cantidad), money.dec(i.fobUnitario)), 2),
                    2,
                  )}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold uppercase">
              FOB total
            </td>
            <td className="px-3 py-2 font-semibold">
              <Importe valor={money.toString(fob, 2)} moneda={cabecera.moneda} />
            </td>
          </tr>
        </tfoot>
      </table>

      {gastos.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-1 text-sm font-semibold">Gastos previstos del embarque</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Prorrateo</th>
                <th className="text-right">Importe</th>
                <th>¿Al costo?</th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id}>
                  <td>{g.concepto}</td>
                  <td>{g.baseProrrateo}</td>
                  <td><Importe valor={g.importe} moneda={g.moneda} /></td>
                  <td>{g.afectaCosto ? "Sí" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            Son los previstos al ordenar. El costo definitivo sale de la liquidación, con los
            importes reales de la póliza.
          </p>
        </section>
      )}

      {cabecera.observaciones && (
        <section className="mt-5">
          <h3 className="mb-1 text-sm font-semibold">Observaciones</h3>
          <p className="text-sm">{cabecera.observaciones}</p>
        </section>
      )}

      {/* Las casillas de firma: la orden se firma antes de salir, y sin ellas la
          hoja impresa no sirve para lo que se imprime. */}
      <section className="mt-16 grid grid-cols-2 gap-16 text-center text-sm">
        {["Solicitado por", "Aprobado por"].map((t) => (
          <div key={t}>
            <div className="border-t" style={{ borderColor: "var(--borde-fuerte)" }} />
            <p className="mt-1" style={{ color: "var(--texto-suave)" }}>{t}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
