"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { agregarItemAccion, agregarGastoAccion, type EstadoForm } from "../acciones";

export type ProductoOpcion = {
  id: string;
  codigo: string;
  descripcion: string;
  pesoUnitario: string | null;
  partidaArancelaria: string | null;
};

export type ItemOpcion = { id: string; linea: number; descripcion: string };

export type ConceptoOpcion = {
  concepto: string;
  base: string;
  afectaCosto: boolean;
  nota?: string;
};

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (estado.error) {
    return (
      <p className="aviso" role="alert">
        {estado.error}
      </p>
    );
  }
  if (estado.exito) {
    return (
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
    );
  }
  return null;
}

export function AgregarItem({
  importacionId,
  productos,
}: {
  importacionId: string;
  productos: ProductoOpcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(agregarItemAccion, {});
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");

  const producto = productos.find((p) => p.id === productoId);

  // El peso de la línea se propone desde el peso unitario del producto: sin
  // peso no hay forma de prorratear el flete, y es lo que más veces deja una
  // liquidación a medias.
  const pesoSugerido =
    producto?.pesoUnitario && cantidad && !Number.isNaN(Number(cantidad))
      ? String(Number(producto.pesoUnitario) * Number(cantidad))
      : "";

  return (
    <form action={accion} className="space-y-3 p-4">
      <input type="hidden" name="importacionId" value={importacionId} />
      <Resultado estado={estado} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="productoId">Producto *</label>
          <select
            id="productoId" name="productoId" required className="campo"
            value={productoId} onChange={(e) => setProductoId(e.target.value)}
          >
            <option value="" disabled>Elija un producto</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} — {p.descripcion}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="descripcion">Descripción en la factura *</label>
          <input
            id="descripcion" name="descripcion" required maxLength={500} className="campo"
            defaultValue={producto?.descripcion ?? ""} key={productoId}
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="cantidad">Cantidad *</label>
          <input
            id="cantidad" name="cantidad" inputMode="decimal" required className="campo"
            value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="fobUnitario">FOB unitario *</label>
          <input id="fobUnitario" name="fobUnitario" inputMode="decimal" required className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="peso">Peso total (kg)</label>
          <input
            id="peso" name="peso" inputMode="decimal" className="campo"
            defaultValue={pesoSugerido} key={`${productoId}-${cantidad}`}
            placeholder={pesoSugerido || "opcional"}
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="volumen">Volumen total (m³)</label>
          <input id="volumen" name="volumen" inputMode="decimal" className="campo" />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="partidaArancelaria">Partida arancelaria</label>
          <input
            id="partidaArancelaria" name="partidaArancelaria" maxLength={20} className="campo"
            defaultValue={producto?.partidaArancelaria ?? ""} key={`p-${productoId}`}
          />
        </div>
      </div>

      <Enviar texto="Agregar ítem" />
    </form>
  );
}

export function AgregarGasto({
  importacionId,
  items,
  conceptos,
}: {
  importacionId: string;
  items: ItemOpcion[];
  conceptos: ConceptoOpcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(agregarGastoAccion, {});
  const [concepto, setConcepto] = useState("");
  const [base, setBase] = useState("fob");
  const [afectaCosto, setAfectaCosto] = useState(true);
  const [moneda, setMoneda] = useState("PEN");

  const plantilla = conceptos.find((c) => c.concepto === concepto);

  /**
   * Al elegir un concepto del catálogo se traen su base de prorrateo y su
   * tratamiento. Marcar el IGV como costo es el error más caro de este módulo:
   * infla el inventario un 18 % y el margen aparece bien hasta que el contador
   * cierra el ejercicio.
   */
  function elegirConcepto(valor: string) {
    setConcepto(valor);
    const c = conceptos.find((x) => x.concepto === valor);
    if (c) {
      setBase(c.base);
      setAfectaCosto(c.afectaCosto);
    }
  }

  return (
    <form action={accion} className="space-y-3 p-4">
      <input type="hidden" name="importacionId" value={importacionId} />
      <Resultado estado={estado} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="concepto">Concepto *</label>
          <input
            id="concepto" name="concepto" required maxLength={120} className="campo"
            list="conceptos-importacion" value={concepto}
            onChange={(e) => elegirConcepto(e.target.value)}
            placeholder="Flete internacional"
          />
          <datalist id="conceptos-importacion">
            {conceptos.map((c) => (
              <option key={c.concepto} value={c.concepto}>
                {c.afectaCosto ? "costo" : "crédito fiscal"}
                {c.nota ? ` · ${c.nota}` : ""}
              </option>
            ))}
          </datalist>
          {plantilla?.nota && (
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              {plantilla.nota}
            </p>
          )}
        </div>

        <div>
          <label className="etiqueta" htmlFor="importe">Importe *</label>
          <input id="importe" name="importe" inputMode="decimal" required className="campo" />
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
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoCambio">T.C.</label>
            <input
              id="tipoCambio" name="tipoCambio" inputMode="decimal" className="campo"
              defaultValue="1" key={moneda}
              // Un gasto en soles no se convierte; uno en dólares necesita el
              // tipo del día en que se pagó, no el de la factura del exterior.
              placeholder={moneda === "PEN" ? "1" : "3.78"}
            />
          </div>
        </div>

        <div>
          <label className="etiqueta" htmlFor="baseProrrateo">Se reparte por *</label>
          <select
            id="baseProrrateo" name="baseProrrateo" className="campo"
            value={base} onChange={(e) => setBase(e.target.value)}
          >
            <option value="fob">Valor FOB</option>
            <option value="peso">Peso</option>
            <option value="volumen">Volumen</option>
            <option value="cantidad">Cantidad</option>
            <option value="directo">Directo a un ítem</option>
          </select>
        </div>

        {base === "directo" && (
          <div>
            <label className="etiqueta" htmlFor="itemId">Ítem *</label>
            <select id="itemId" name="itemId" required className="campo" defaultValue="">
              <option value="" disabled>Elija el ítem</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.linea}. {i.descripcion}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="etiqueta" htmlFor="documento">Documento</label>
          <input id="documento" name="documento" maxLength={60} className="campo" placeholder="F001-1234" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="fecha">Fecha</label>
          <input id="fecha" name="fecha" type="date" className="campo" />
        </div>

        <div className="sm:col-span-2">
          <label
            className="flex items-start gap-2 rounded border p-2.5 text-sm"
            style={{
              borderColor: afectaCosto ? "var(--borde)" : "color-mix(in srgb, var(--alerta) 45%, transparent)",
              background: afectaCosto ? undefined : "color-mix(in srgb, var(--alerta) 7%, transparent)",
            }}
          >
            <input
              type="checkbox" name="afectaCosto" className="mt-0.5"
              checked={afectaCosto} onChange={(e) => setAfectaCosto(e.target.checked)}
            />
            <span>
              <strong>Forma parte del costo de la mercadería</strong>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--texto-suave)" }}>
                {afectaCosto
                  ? "Se prorratea sobre los ítems y engorda el valor del inventario."
                  : "Va a crédito fiscal o pago a cuenta (cuentas 40111 y 40113), no al inventario. Es el tratamiento del IGV, el IPM y la percepción."}
              </span>
            </span>
          </label>
        </div>
      </div>

      <Enviar texto="Agregar gasto" />
    </form>
  );
}
