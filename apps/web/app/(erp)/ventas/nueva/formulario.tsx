"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { emitirVentaAccion, type EstadoForm } from "../acciones";
import { formatearImporte } from "@/components/ui";

export type ClienteOpcion = { id: string; etiqueta: string; tieneRuc: boolean };
export type ProductoOpcion = {
  id: string;
  etiqueta: string;
  descripcion: string;
  esBien: boolean;
  afectacion: string;
};
export type SerieOpcion = { serie: string; tipoDocumento: string; siguiente: string };

type Linea = {
  clave: number;
  productoId: string;
  descripcion: string;
  cantidad: string;
  valorUnitario: string;
  afectacionIgv: string;
};

const AFECTACIONES = [
  ["10", "Gravado"],
  ["20", "Exonerado"],
  ["30", "Inafecto"],
  ["40", "Exportación"],
  ["15", "Gratuito (bonificación)"],
] as const;

let siguienteClave = 0;
const lineaVacia = (): Linea => ({
  clave: siguienteClave++,
  productoId: "",
  descripcion: "",
  cantidad: "1",
  valorUnitario: "",
  afectacionIgv: "10",
});

function Emitir() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Emitiendo…" : "Emitir comprobante"}
    </button>
  );
}

export function FormularioVenta({
  clientes,
  productos,
  almacenes,
  series,
}: {
  clientes: ClienteOpcion[];
  productos: ProductoOpcion[];
  almacenes: { id: string; etiqueta: string }[];
  series: SerieOpcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(emitirVentaAccion, {});
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia()]);
  const [clienteId, setClienteId] = useState("");
  const [serie, setSerie] = useState(series[0]?.serie ?? "");
  const [moneda, setMoneda] = useState("PEN");
  const hoy = new Date().toISOString().slice(0, 10);

  const serieElegida = series.find((s) => s.serie === serie);
  const cliente = clientes.find((c) => c.id === clienteId);
  const esFactura = serieElegida?.tipoDocumento === "01";

  // Facturar exige RUC. Se avisa aquí, mientras el usuario elige, en vez de
  // dejar que el servidor lo rechace después de teclear todo el detalle.
  const clienteIncompatible = esFactura && cliente !== undefined && !cliente.tieneRuc;

  const actualizar = (clave: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  const elegirProducto = (clave: number, productoId: string) => {
    const p = productos.find((x) => x.id === productoId);
    actualizar(clave, {
      productoId,
      ...(p ? { descripcion: p.descripcion, afectacionIgv: p.afectacion } : {}),
    });
  };

  // Vista previa: `Number` sólo para pintar mientras se escribe. El servidor
  // recalcula con aritmética exacta y son esas cifras las que se emiten.
  const base = lineas
    .filter((l) => l.afectacionIgv !== "15")
    .reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0), 0);
  const gravado = lineas
    .filter((l) => l.afectacionIgv === "10")
    .reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0), 0);
  const igv = gravado * 0.18;

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Comprobante</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="clienteId">Cliente *</label>
            <select
              id="clienteId" name="clienteId" required className="campo"
              value={clienteId} onChange={(e) => setClienteId(e.target.value)}
              aria-invalid={clienteIncompatible ? "true" : undefined}
            >
              <option value="" disabled>Elija un cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
            </select>
            {clienteIncompatible && (
              <p className="mt-1 text-xs" style={{ color: "var(--peligro)" }}>
                Este cliente no tiene RUC. Emita una boleta, o registre su RUC para facturarle.
              </p>
            )}
          </div>

          <div>
            <label className="etiqueta" htmlFor="serie">Serie *</label>
            <select
              id="serie" name="serie" required className="campo"
              value={serie} onChange={(e) => setSerie(e.target.value)}
            >
              {series.map((s) => (
                <option key={s.serie} value={s.serie}>
                  {s.serie} · {s.tipoDocumento === "03" ? "boleta" : "factura"}
                </option>
              ))}
            </select>
            {serieElegida && (
              <p className="cifra mt-1 text-xs" style={{ color: "var(--texto-suave)", textAlign: "left" }}>
                Siguiente: {serieElegida.serie}-{serieElegida.siguiente}
              </p>
            )}
          </div>

          <input type="hidden" name="tipoDocumento" value={serieElegida?.tipoDocumento ?? "01"} />

          <div>
            <label className="etiqueta" htmlFor="fechaEmision">Fecha de emisión *</label>
            <input
              id="fechaEmision" name="fechaEmision" type="date" required
              defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaVencimiento">Vencimiento</label>
            <input id="fechaVencimiento" name="fechaVencimiento" type="date" className="campo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="moneda">Moneda</label>
              <select
                id="moneda" name="moneda" className="campo"
                value={moneda} onChange={(e) => setMoneda(e.target.value)}
              >
                <option value="PEN">PEN</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="tipoCambio">T.C.</label>
              <input
                id="tipoCambio" name="tipoCambio" inputMode="decimal" className="campo"
                defaultValue="1" key={moneda} placeholder={moneda === "PEN" ? "1" : "3.75"} />
            </div>
          </div>
        </div>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Detalle</h2>
          <button
            type="button" className="boton boton-secundario !py-1 !text-xs"
            onClick={() => setLineas((ls) => [...ls, lineaVacia()])}
          >
            Agregar línea
          </button>
        </div>

        <table className="tabla">
          <thead>
            <tr>
              <th className="min-w-[200px]">Producto o servicio</th>
              <th className="min-w-[200px]">Descripción</th>
              <th className="w-24 text-right">Cantidad</th>
              <th className="w-28 text-right">V. unitario</th>
              <th className="w-36">IGV</th>
              <th className="w-28 text-right">Importe</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].productoId`} value={l.productoId}
                    onChange={(e) => elegirProducto(l.clave, e.target.value)}
                    className="campo !py-1 !text-xs"
                  >
                    <option value="">— servicio libre —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} value={l.descripcion}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                    className="campo !py-1 !text-xs"
                    required={!l.productoId && i === 0}
                  />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo cifra !py-1 !text-xs" />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].valorUnitario`} value={l.valorUnitario} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { valorUnitario: e.target.value })}
                    className="campo cifra !py-1 !text-xs" />
                </td>
                <td>
                  <select
                    name={`lineas[${i}].afectacionIgv`} value={l.afectacionIgv}
                    onChange={(e) => actualizar(l.clave, { afectacionIgv: e.target.value })}
                    className="campo !py-1 !text-xs"
                  >
                    {AFECTACIONES.map(([c, t]) => (
                      <option key={c} value={c}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="cifra text-xs">
                  {l.afectacionIgv === "15"
                    ? "gratuito"
                    : formatearImporte(
                        String((Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0)),
                      )}
                </td>
                <td>
                  {lineas.length > 1 && (
                    <button
                      type="button" aria-label={`Quitar línea ${i + 1}`}
                      className="text-xs" style={{ color: "var(--peligro)" }}
                      onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-1.5 text-right text-xs uppercase">Valor de venta</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(base))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-1.5 text-right text-xs uppercase">IGV 18 %</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(igv))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(base + igv))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Salida de mercadería</h2>
        <div className="max-w-md">
          <label className="etiqueta" htmlFor="almacenId">Almacén</label>
          <select id="almacenId" name="almacenId" className="campo" defaultValue={almacenes[0]?.id ?? ""}>
            <option value="">No descargar inventario</option>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>{a.etiqueta}</option>
            ))}
          </select>
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            Las líneas con producto salen del kardex al costo que tengan, y ese costo va al asiento
            como costo de ventas. Sin esa segunda mitad, el margen aparecería disparado.
          </p>
        </div>
      </section>

      <div className="flex gap-2">
        <Emitir />
        <Link href="/ventas" className="boton boton-secundario">Cancelar</Link>
      </div>

      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Emitir no envía nada a SUNAT todavía: el comprobante queda registrado y se informa después,
        desde su propia pantalla. Así una caída del servicio no impide facturar.
      </p>
    </form>
  );
}
