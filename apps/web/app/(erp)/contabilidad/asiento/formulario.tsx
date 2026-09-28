"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarAsientoAccion, eliminarBorradorAccion, type EstadoForm } from "../acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string };
export type CuentaOpcion = Opcion & {
  exigeAnexo: boolean;
  exigeCentroCosto: boolean;
};

export type LineaCargada = {
  cuenta: string;
  glosa: string;
  debe: string;
  haber: string;
  centroCostoId: string;
  anexoId: string;
};

export type AsientoCargado = {
  id: string;
  periodo: string;
  fecha: string;
  subdiario: string;
  glosa: string;
  moneda: string;
  tipoCambio: string;
  lineas: LineaCargada[];
};

/** Catálogo 8 de SUNAT, recortado a los libros que esta empresa lleva. */
const SUBDIARIOS = [
  ["08", "Diario"],
  ["01", "Caja y bancos"],
  ["14", "Ventas"],
  ["05", "Compras"],
  ["06", "Honorarios"],
] as const;

type Linea = LineaCargada & { clave: number };

const vacia = (): Omit<Linea, "clave"> => ({
  cuenta: "",
  glosa: "",
  debe: "",
  haber: "",
  centroCostoId: "",
  anexoId: "",
});

function Botones() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit" name="intencion" value="borrador"
        className="boton boton-secundario" disabled={pending}
      >
        {pending ? "Guardando…" : "Guardar borrador"}
      </button>
      <button
        type="submit" name="intencion" value="contabilizar"
        className="boton boton-primario" disabled={pending}
      >
        {pending ? "Procesando…" : "Contabilizar"}
      </button>
    </>
  );
}

/**
 * Captura manual de un asiento.
 *
 * El descuadre se muestra mientras se escribe porque es lo único que el
 * contador mira: mientras no diga 0.00, el asiento no entra. La suma del
 * navegador es orientativa —usa `Number` a propósito, sólo para pintar—; la
 * que decide es la del servidor, con aritmética exacta.
 */
export function FormularioAsiento({
  cuentas,
  centrosCosto,
  terceros,
  periodoPorDefecto,
  asiento,
}: {
  cuentas: CuentaOpcion[];
  centrosCosto: Opcion[];
  terceros: Opcion[];
  periodoPorDefecto: string;
  asiento?: AsientoCargado;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarAsientoAccion, {});
  const [borrado, accionBorrar] = useActionState<EstadoForm, FormData>(eliminarBorradorAccion, {});
  /*
   * Arranca con dos líneas y no con una: un asiento necesita al menos un debe
   * y un haber, y empezar con una sola obliga a pulsar «añadir» siempre.
   */
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(
    vacia,
    asiento && asiento.lineas.length > 0 ? asiento.lineas : [vacia(), vacia()],
  );
  const [moneda, setMoneda] = useState(asiento?.moneda ?? "PEN");


  const num = (v: string) => Number(v) || 0;
  const totalDebe = lineas.reduce((a, l) => a + num(l.debe), 0);
  const totalHaber = lineas.reduce((a, l) => a + num(l.haber), 0);
  const descuadre = totalDebe - totalHaber;
  const cuadra = Math.abs(descuadre) < 0.005 && totalDebe > 0;

  const porCuenta = new Map(cuentas.map((c) => [c.id, c]));

  return (
    <form action={accion} className="space-y-5">
      {asiento && <input type="hidden" name="asientoId" value={asiento.id} />}

      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {borrado.error && (
        <p className="aviso" role="alert">{borrado.error}</p>
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Cabecera</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="etiqueta" htmlFor="periodo">Periodo *</label>
            <input
              id="periodo" name="periodo" required pattern="\d{6}" className="campo cifra"
              defaultValue={asiento?.periodo ?? periodoPorDefecto} placeholder="AAAAMM"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input
              id="fecha" name="fecha" type="date" required className="campo"
              defaultValue={asiento?.fecha ?? hoyEnPeru()}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="subdiario">Subdiario *</label>
            <select id="subdiario" name="subdiario" className="campo" defaultValue={asiento?.subdiario ?? "08"}>
              {SUBDIARIOS.map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>{codigo} — {nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="moneda">Moneda *</label>
            <select
              id="moneda" name="moneda" className="campo" value={moneda}
              onChange={(e) => setMoneda(e.target.value)}
            >
              <option value="PEN">PEN — Soles</option>
              <option value="USD">USD — Dólares</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="tipoCambio">Tipo de cambio *</label>
            <input
              id="tipoCambio" name="tipoCambio" required className="campo cifra"
              inputMode="decimal" defaultValue={asiento?.tipoCambio ?? "1"}
            />
          </div>
          <div className="sm:col-span-3 lg:col-span-6">
            <label className="etiqueta" htmlFor="glosa">Glosa *</label>
            <input
              id="glosa" name="glosa" required maxLength={200} className="campo"
              defaultValue={asiento?.glosa ?? ""}
              placeholder="Provisión de planilla de setiembre"
            />
          </div>
        </div>
      </section>

      <section className="tarjeta overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Líneas</h2>
          <button
            type="button" className="boton boton-secundario"
            onClick={agregar}
          >
            Añadir línea
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ width: "20%" }}>Cuenta</th>
              <th>Glosa</th>
              <th style={{ width: "15%" }}>Tercero</th>
              <th style={{ width: "15%" }}>C. costo</th>
              <th className="text-right" style={{ width: "11%" }}>Debe</th>
              <th className="text-right" style={{ width: "11%" }}>Haber</th>
              <th style={{ width: "1%" }} />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const c = porCuenta.get(l.cuenta);
              return (
                <tr key={l.clave}>
                  <td>
                    <select
                      name={`linea[${i}][cuenta]`} className="campo cifra" value={l.cuenta}
                      onChange={(e) => actualizar(l.clave, { cuenta: e.target.value })}
                    >
                      <option value="">—</option>
                      {cuentas.map((o) => (
                        <option key={o.id} value={o.id}>{o.etiqueta}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      name={`linea[${i}][glosa]`} className="campo" maxLength={200} value={l.glosa}
                      onChange={(e) => actualizar(l.clave, { glosa: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      name={`linea[${i}][anexoId]`} className="campo" value={l.anexoId}
                      required={c?.exigeAnexo ?? false}
                      onChange={(e) => actualizar(l.clave, { anexoId: e.target.value })}
                    >
                      <option value="">{c?.exigeAnexo ? "Obligatorio" : "—"}</option>
                      {terceros.map((o) => (
                        <option key={o.id} value={o.id}>{o.etiqueta}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      name={`linea[${i}][centroCostoId]`} className="campo" value={l.centroCostoId}
                      required={c?.exigeCentroCosto ?? false}
                      onChange={(e) => actualizar(l.clave, { centroCostoId: e.target.value })}
                    >
                      <option value="">{c?.exigeCentroCosto ? "Obligatorio" : "—"}</option>
                      {centrosCosto.map((o) => (
                        <option key={o.id} value={o.id}>{o.etiqueta}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {/* Debe y haber se excluyen: escribir en uno vacía el otro,
                        que es más rápido que corregir el error después. */}
                    <input
                      name={`linea[${i}][debe]`} className="campo cifra text-right"
                      inputMode="decimal" value={l.debe}
                      onChange={(e) => actualizar(l.clave, { debe: e.target.value, haber: "" })}
                    />
                  </td>
                  <td>
                    <input
                      name={`linea[${i}][haber]`} className="campo cifra text-right"
                      inputMode="decimal" value={l.haber}
                      onChange={(e) => actualizar(l.clave, { haber: e.target.value, debe: "" })}
                    />
                  </td>
                  <td>
                    <button
                      type="button" className="boton boton-secundario"
                      aria-label={`Quitar la línea ${i + 1}`}
                      onClick={() => quitar(l.clave)}
                      disabled={lineas.length <= 2}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--superficie-2)" }}>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                Totales {moneda}
              </td>
              <td className="px-3 py-2 text-right font-semibold cifra">{formatearImporte(String(totalDebe))}</td>
              <td className="px-3 py-2 text-right font-semibold cifra">{formatearImporte(String(totalHaber))}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase">
                Descuadre
              </td>
              <td
                colSpan={2} className="px-3 py-2 text-right font-semibold cifra"
                style={{ color: cuadra ? "var(--exito)" : "var(--peligro)" }}
              >
                {formatearImporte(String(descuadre))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Botones />
        <Link href={"/contabilidad" as Route} className="boton boton-secundario">Volver</Link>
        {asiento && (
          <button
            type="submit" formAction={accionBorrar} formNoValidate
            className="boton boton-secundario ml-auto" style={{ color: "var(--peligro)" }}
          >
            Eliminar borrador
          </button>
        )}
      </div>
    </form>
  );
}
