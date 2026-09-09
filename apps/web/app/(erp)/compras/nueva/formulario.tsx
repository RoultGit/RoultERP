"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registrarCompraAccion, type EstadoForm } from "../acciones";
import { formatearImporte } from "@/components/ui";

export type Opcion = { id: string; etiqueta: string };
export type ProductoOpcion = Opcion & { descripcion: string };
export type ReglaOpcion = { codigo: string; descripcion: string; tasa: string };

type Linea = {
  clave: number;
  productoId: string;
  descripcion: string;
  cantidad: string;
  valorUnitario: string;
  afectacionIgv: string;
  cuenta: string;
  centroCostoId: string;
};

const TIPOS_DOCUMENTO = [
  ["01", "Factura"],
  ["03", "Boleta de venta"],
  ["07", "Nota de crédito"],
  ["08", "Nota de débito"],
  ["14", "Recibo de servicios públicos"],
] as const;

const AFECTACIONES = [
  ["10", "Gravado"],
  ["20", "Exonerado"],
  ["30", "Inafecto"],
] as const;

let siguienteClave = 0;
const lineaVacia = (): Linea => ({
  clave: siguienteClave++,
  productoId: "",
  descripcion: "",
  cantidad: "1",
  valorUnitario: "",
  afectacionIgv: "10",
  cuenta: "",
  centroCostoId: "",
});

function Registrar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Registrando…" : "Registrar compra"}
    </button>
  );
}

/**
 * Captura de la factura del proveedor.
 *
 * Los totales se calculan en el navegador sólo para que el usuario vea a dónde
 * va la cifra mientras escribe. La cuenta que vale es la del servidor, que
 * recalcula todo con aritmética exacta: aquí se usa `Number` a propósito y
 * únicamente para pintar, nunca para guardar.
 */
export function FormularioCompra({
  proveedores,
  productos,
  almacenes,
  cuentas,
  centrosCosto,
  reglas,
}: {
  proveedores: Opcion[];
  productos: ProductoOpcion[];
  almacenes: Opcion[];
  cuentas: Opcion[];
  centrosCosto: Opcion[];
  reglas: ReglaOpcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(registrarCompraAccion, {});
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia()]);
  const [moneda, setMoneda] = useState("PEN");
  const hoy = new Date().toISOString().slice(0, 10);

  const actualizar = (clave: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  const elegirProducto = (clave: number, productoId: string) => {
    const p = productos.find((x) => x.id === productoId);
    actualizar(clave, { productoId, ...(p ? { descripcion: p.descripcion } : {}) });
  };

  const base = lineas.reduce(
    (a, l) => a + (Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0),
    0,
  );
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
        <h2 className="mb-3 text-sm font-semibold">Documento del proveedor</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="etiqueta" htmlFor="proveedorId">Proveedor *</label>
            <select id="proveedorId" name="proveedorId" required className="campo" defaultValue="">
              <option value="" disabled>Elija un proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoDocumento">Tipo *</label>
            <select id="tipoDocumento" name="tipoDocumento" defaultValue="01" className="campo">
              {TIPOS_DOCUMENTO.map(([c, t]) => (
                <option key={c} value={c}>{c} — {t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="serie">Serie *</label>
            <input id="serie" name="serie" required maxLength={10} className="campo" placeholder="F001" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="numero">Número *</label>
            <input id="numero" name="numero" required maxLength={20} className="campo" placeholder="0001234" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaEmision">Fecha de emisión *</label>
            <input id="fechaEmision" name="fechaEmision" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaVencimiento">Vencimiento</label>
            <input id="fechaVencimiento" name="fechaVencimiento" type="date" className="campo" />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Si se deja vacío, se calcula con los días de crédito del proveedor.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="moneda">Moneda</label>
              <select
                id="moneda" name="moneda" className="campo" value={moneda}
                onChange={(e) => setMoneda(e.target.value)}
              >
                <option value="PEN">PEN</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="tipoCambio">T.C.</label>
              <input
                id="tipoCambio" name="tipoCambio" inputMode="decimal" className="campo"
                defaultValue="1" key={moneda} placeholder={moneda === "PEN" ? "1" : "3.75"}
              />
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
              <th className="min-w-[180px]">Producto</th>
              <th className="min-w-[200px]">Descripción *</th>
              <th className="w-24 text-right">Cantidad</th>
              <th className="w-28 text-right">V. unitario</th>
              <th className="w-28">IGV</th>
              <th className="min-w-[150px]">Cuenta</th>
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
                    <option value="">— servicio o gasto —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} value={l.descripcion}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                    className="campo !py-1 !text-xs" required={i === 0}
                  />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} value={l.cantidad} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                    className="campo cifra !py-1 !text-xs"
                  />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].valorUnitario`} value={l.valorUnitario} inputMode="decimal"
                    onChange={(e) => actualizar(l.clave, { valorUnitario: e.target.value })}
                    className="campo cifra !py-1 !text-xs"
                  />
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
                <td>
                  {l.productoId ? (
                    <span className="text-xs" style={{ color: "var(--texto-suave)" }}>
                      20111 — mercadería
                    </span>
                  ) : (
                    <>
                      <select
                        name={`lineas[${i}].cuenta`} value={l.cuenta}
                        onChange={(e) => actualizar(l.clave, { cuenta: e.target.value })}
                        className="campo !py-1 !text-xs" required
                      >
                        <option value="">Elija la cuenta</option>
                        {cuentas.map((c) => (
                          <option key={c.id} value={c.id}>{c.etiqueta}</option>
                        ))}
                      </select>
                      <select
                        name={`lineas[${i}].centroCostoId`} value={l.centroCostoId}
                        onChange={(e) => actualizar(l.clave, { centroCostoId: e.target.value })}
                        className="campo mt-1 !py-1 !text-xs"
                      >
                        <option value="">Sin centro de costo</option>
                        {centrosCosto.map((c) => (
                          <option key={c.id} value={c.id}>{c.etiqueta}</option>
                        ))}
                      </select>
                    </>
                  )}
                </td>
                <td className="cifra text-xs">
                  {formatearImporte(
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
              <td colSpan={6} className="px-3 py-1.5 text-right text-xs uppercase">Valor de venta</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(base))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={6} className="px-3 py-1.5 text-right text-xs uppercase">IGV 18 %</td>
              <td className="cifra px-3 py-1.5 text-xs">{formatearImporte(String(igv))}</td>
              <td />
            </tr>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={6} className="px-3 py-2 text-right text-xs font-semibold uppercase">Total</td>
              <td className="cifra px-3 py-2 font-semibold">{formatearImporte(String(base + igv))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
          Estos totales son una vista previa. El servidor los recalcula con aritmética exacta al
          guardar, y son esas cifras las que se contabilizan.
        </p>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Inventario y régimen tributario</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="almacenId">Almacén de ingreso</label>
            <select id="almacenId" name="almacenId" className="campo" defaultValue="">
              <option value="">No ingresa a almacén</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.etiqueta}</option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Sólo las líneas con producto que sea un bien entran al kardex, al costo sin IGV.
            </p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="detraccionCodigo">Detracción (SPOT)</label>
            <select id="detraccionCodigo" name="detraccionCodigo" className="campo" defaultValue="">
              <option value="">No sujeta a detracción</option>
              {reglas.map((r) => (
                <option key={r.codigo} value={r.codigo}>
                  {r.codigo} — {r.descripcion} ({(Number(r.tasa) * 100).toFixed(1)} %)
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Se calcula sobre el total con IGV y se deposita en soles enteros. Por debajo de
              S/ 700 no aplica.
            </p>
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Registrar />
        <Link href="/compras" className="boton boton-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
