"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { emitirGuiaAccion, type EstadoForm } from "../acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string };
export type PuntoPartida = Opcion & {
  ubigeo: string;
  direccion: string;
  establecimiento: string;
};

/** Catálogo 20 de SUNAT, con los motivos que este cliente usa. */
const MOTIVOS = [
  ["01", "Venta"],
  ["02", "Compra"],
  ["04", "Traslado entre establecimientos de la misma empresa"],
  ["05", "Consignación"],
  ["06", "Devolución"],
  ["08", "Importación"],
  ["09", "Exportación"],
  ["13", "Otros"],
] as const;

type Linea = { clave: number; productoId: string; descripcion: string; cantidad: string };

const lineaVacia = (): Omit<Linea, "clave"> => ({
  productoId: "",
  descripcion: "",
  cantidad: "1",
});

function Emitir() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Emitiendo…" : "Emitir guía"}
    </button>
  );
}

/**
 * Captura de la guía de remisión.
 *
 * El formulario cambia según la modalidad de transporte porque SUNAT exige
 * datos distintos en cada una: en público, el transportista; en privado, la
 * placa y el conductor. Mostrar ambos a la vez llevaría a llenar lo que sobra
 * y a que rebote lo que falta.
 */
export function FormularioGuia({
  series,
  destinatarios,
  transportistas,
  productos,
  puntos,
  comprobantes,
}: {
  series: string[];
  destinatarios: Opcion[];
  transportistas: Opcion[];
  productos: Opcion[];
  puntos: PuntoPartida[];
  comprobantes: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(emitirGuiaAccion, {});
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(lineaVacia);
  const [modo, setModo] = useState("02");
  const [motivo, setMotivo] = useState("04");
  const [punto, setPunto] = useState(puntos[0]?.id ?? "");
  const hoy = hoyEnPeru();

  const publico = modo === "01";
  const elegido = puntos.find((p) => p.id === punto);

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Documento</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="serie">Serie *</label>
            <select id="serie" name="serie" required className="campo cifra">
              {series.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaEmision">Fecha de emisión *</label>
            <input id="fechaEmision" name="fechaEmision" type="date" required className="campo" defaultValue={hoy} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaTraslado">Inicio del traslado *</label>
            <input id="fechaTraslado" name="fechaTraslado" type="date" required className="campo" defaultValue={hoy} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="destinatarioId">Destinatario *</label>
            <select id="destinatarioId" name="destinatarioId" required className="campo" defaultValue="">
              <option value="" disabled>Elija un destinatario</option>
              {destinatarios.map((d) => (
                <option key={d.id} value={d.id}>{d.etiqueta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="motivo">Motivo del traslado *</label>
            <select
              id="motivo" name="motivo" className="campo" value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            >
              {MOTIVOS.map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>{codigo} — {nombre}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="descripcionMotivo">Descripción del motivo *</label>
            <input
              id="descripcionMotivo" name="descripcionMotivo" required maxLength={200} className="campo"
              defaultValue="Traslado entre establecimientos"
            />
          </div>
          {motivo === "01" && (
            <div>
              <label className="etiqueta" htmlFor="comprobanteId">Comprobante que lo sustenta *</label>
              <select id="comprobanteId" name="comprobanteId" required className="campo" defaultValue="">
                <option value="" disabled>Elija la factura o boleta</option>
                {comprobantes.map((c) => (
                  <option key={c.id} value={c.id}>{c.etiqueta}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Puntos de partida y llegada</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className="etiqueta" htmlFor="almacenId">Almacén de salida</label>
              <select
                id="almacenId" name="almacenId" className="campo" value={punto}
                onChange={(e) => setPunto(e.target.value)}
              >
                {puntos.map((p) => (
                  <option key={p.id} value={p.id}>{p.etiqueta}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="partidaUbigeo">Ubigeo de partida *</label>
              <input
                id="partidaUbigeo" name="partidaUbigeo" required pattern="\d{6}"
                className="campo cifra" style={{ textAlign: "left" }}
                key={`u-${punto}`} defaultValue={elegido?.ubigeo ?? ""}
              />
            </div>
            <div>
              <label className="etiqueta" htmlFor="partidaDireccion">Dirección de partida *</label>
              <input
                id="partidaDireccion" name="partidaDireccion" required maxLength={200} className="campo"
                key={`d-${punto}`} defaultValue={elegido?.direccion ?? ""}
              />
            </div>
            <input type="hidden" name="partidaEstablecimiento" value={elegido?.establecimiento ?? ""} />
          </div>

          <div className="space-y-3">
            <div>
              <label className="etiqueta" htmlFor="llegadaUbigeo">Ubigeo de llegada *</label>
              <input
                id="llegadaUbigeo" name="llegadaUbigeo" required pattern="\d{6}"
                className="campo cifra" style={{ textAlign: "left" }} placeholder="150132"
              />
            </div>
            <div>
              <label className="etiqueta" htmlFor="llegadaDireccion">Dirección de llegada *</label>
              <input id="llegadaDireccion" name="llegadaDireccion" required maxLength={200} className="campo" />
            </div>
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Transporte</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="modoTransporte">Modalidad *</label>
            <select
              id="modoTransporte" name="modoTransporte" className="campo" value={modo}
              onChange={(e) => setModo(e.target.value)}
            >
              <option value="02">02 — Privado (vehículo propio)</option>
              <option value="01">01 — Público (transportista)</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="pesoBruto">Peso bruto (kg) *</label>
            <input id="pesoBruto" name="pesoBruto" required inputMode="decimal" className="campo cifra" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="bultos">Bultos</label>
            <input id="bultos" name="bultos" inputMode="numeric" className="campo cifra" />
          </div>
        </div>

        {publico ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="transportistaId">Transportista *</label>
              <select id="transportistaId" name="transportistaId" required className="campo" defaultValue="">
                <option value="" disabled>Elija el transportista</option>
                {transportistas.map((t) => (
                  <option key={t.id} value={t.id}>{t.etiqueta}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="registroMtc">Registro MTC</label>
              <input id="registroMtc" name="registroMtc" className="campo" maxLength={20} />
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="etiqueta" htmlFor="placa">Placa del vehículo *</label>
              <input id="placa" name="placa" required maxLength={10} className="campo cifra" style={{ textAlign: "left" }} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="conductorNumDoc">DNI del conductor *</label>
              <input id="conductorNumDoc" name="conductorNumDoc" required maxLength={15} className="campo cifra" style={{ textAlign: "left" }} />
              <input type="hidden" name="conductorTipoDoc" value="1" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="conductorLicencia">Licencia *</label>
              <input id="conductorLicencia" name="conductorLicencia" required maxLength={20} className="campo" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="conductorNombres">Nombres *</label>
              <input id="conductorNombres" name="conductorNombres" required maxLength={80} className="campo" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="conductorApellidos">Apellidos *</label>
              <input id="conductorApellidos" name="conductorApellidos" required maxLength={80} className="campo" />
            </div>
          </div>
        )}
      </section>

      <section className="bloque overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Bienes trasladados</h2>
          <button
            type="button" className="boton boton-secundario"
            onClick={() => agregar()}
          >
            Añadir bien
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Descripción</th>
              <th className="text-right" style={{ width: "14%" }}>Cantidad</th>
              <th style={{ width: "1%" }} />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave}>
                <td>
                  <select
                    name={`lineas[${i}].productoId`} className="campo" value={l.productoId}
                    onChange={(e) => actualizar(l.clave, { productoId: e.target.value })}
                  >
                    <option value="">— sin catálogo —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].descripcion`} className="campo" maxLength={200}
                    value={l.descripcion} placeholder={l.productoId ? "(del producto)" : "Descripción del bien"}
                    onChange={(e) => actualizar(l.clave, { descripcion: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} className="campo cifra text-right"
                    inputMode="decimal" value={l.cantidad}
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button" className="boton boton-secundario"
                    aria-label={`Quitar el bien ${i + 1}`}
                    onClick={() => quitar(l.clave)}
                    disabled={lineas.length <= 1}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div>
        <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
        <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
      </div>

      <div className="flex gap-2">
        <Emitir />
        <Link href={"/guias" as Route} className="boton boton-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
