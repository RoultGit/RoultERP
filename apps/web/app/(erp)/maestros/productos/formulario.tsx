"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarProductoAccion, type EstadoForm } from "../acciones";

export type ProductoForm = {
  id?: string;
  codigo: string;
  descripcion: string;
  unidadId: string;
  tipo: string;
  afectacionIgv: string;
  codigoSunat: string;
  partidaArancelaria: string;
  pesoUnitario: string;
  volumenUnitario: string;
  stockMinimo: string;
  controlLote: boolean;
  controlSerie: boolean;
};

/** Catálogo 07 de SUNAT, con los supuestos que usa una importadora. */
const AFECTACIONES = [
  ["10", "Gravado — operación onerosa"],
  ["20", "Exonerado — operación onerosa"],
  ["30", "Inafecto — operación onerosa"],
  ["40", "Exportación de bienes o servicios"],
  ["15", "Gravado — bonificación"],
  ["31", "Inafecto — retiro por bonificación"],
] as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

export function FormularioProducto({
  inicial,
  unidades,
}: {
  inicial: ProductoForm;
  unidades: { id: string; codigo: string; nombre: string }[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarProductoAccion, {});
  const malo = (campo: string) => (estado.campo === campo ? "true" : undefined);

  return (
    <form action={accion} className="max-w-3xl space-y-5">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}

      {estado.error && (
        <p className="aviso" role="alert">
          {estado.error}
        </p>
      )}

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Identificación</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="codigo">Código *</label>
            <input
              id="codigo" name="codigo" required maxLength={40}
              defaultValue={inicial.codigo} className="campo" aria-invalid={malo("codigo")}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Aparece en guías, comprobantes y en el PLE. No se repite.
            </p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipo">Tipo *</label>
            <select id="tipo" name="tipo" defaultValue={inicial.tipo} className="campo">
              <option value="bien">Bien — lleva kardex</option>
              <option value="servicio">Servicio — sin existencias</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="descripcion">Descripción *</label>
            <input
              id="descripcion" name="descripcion" required maxLength={500}
              defaultValue={inicial.descripcion} className="campo" aria-invalid={malo("descripcion")}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="unidadId">Unidad de medida *</label>
            <select
              id="unidadId" name="unidadId" defaultValue={inicial.unidadId}
              className="campo" required aria-invalid={malo("unidadId")}
            >
              <option value="">Elija una unidad</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.codigo} — {u.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="afectacionIgv">Afectación del IGV *</label>
            <select
              id="afectacionIgv" name="afectacionIgv"
              defaultValue={inicial.afectacionIgv} className="campo"
            >
              {AFECTACIONES.map(([codigo, texto]) => (
                <option key={codigo} value={codigo}>
                  {codigo} — {texto}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-1 text-sm font-semibold">Datos para importación</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--texto-suave)" }}>
          El peso y el volumen son la base para prorratear el flete de un embarque. Sin ellos, esos
          gastos no se pueden repartir y la liquidación se traba a mitad de camino.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="pesoUnitario">Peso unitario (kg)</label>
            <input
              id="pesoUnitario" name="pesoUnitario" inputMode="decimal"
              defaultValue={inicial.pesoUnitario} className="campo" placeholder="12.5"
              aria-invalid={malo("pesoUnitario")}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="volumenUnitario">Volumen unitario (m³)</label>
            <input
              id="volumenUnitario" name="volumenUnitario" inputMode="decimal"
              defaultValue={inicial.volumenUnitario} className="campo" placeholder="0.08"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="partidaArancelaria">Partida arancelaria</label>
            <input
              id="partidaArancelaria" name="partidaArancelaria" maxLength={20}
              defaultValue={inicial.partidaArancelaria} className="campo" placeholder="8413.70.19.00"
            />
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Control de existencias</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="stockMinimo">Stock mínimo</label>
            <input
              id="stockMinimo" name="stockMinimo" inputMode="decimal"
              defaultValue={inicial.stockMinimo} className="campo"
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Con cero no se avisa. Por encima, aparece en el tablero cuando el saldo baja.
            </p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="codigoSunat">Código SUNAT del producto</label>
            <input
              id="codigoSunat" name="codigoSunat" maxLength={40}
              defaultValue={inicial.codigoSunat} className="campo"
            />
          </div>
          <div className="sm:col-span-2 flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="controlLote" defaultChecked={inicial.controlLote} />
              Controlar por lote
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="controlSerie" defaultChecked={inicial.controlSerie} />
              Controlar por número de serie
            </label>
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Guardar />
        <Link href="/maestros/productos" className="boton boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
