"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { guardarTerceroAccion, type EstadoForm } from "../acciones";

export type TerceroForm = {
  id?: string;
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  pais: string;
  email: string;
  telefono: string;
  esCliente: boolean;
  esProveedor: boolean;
  esDomiciliado: boolean;
  diasCredito: number;
  limiteCredito: string;
  monedaLimite: string;
};

/** Catálogo 06 de SUNAT: tipo de documento de identidad. */
const DOCUMENTOS = [
  ["6", "RUC", 11],
  ["1", "DNI", 8],
  ["4", "Carné de extranjería", 0],
  ["7", "Pasaporte", 0],
  ["0", "Sin documento (proveedor del exterior)", 0],
  ["A", "Cédula diplomática", 0],
] as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

export function FormularioTercero({ inicial }: { inicial: TerceroForm }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarTerceroAccion, {});
  const [tipoDoc, setTipoDoc] = useState(inicial.tipoDocumento);
  const [pais, setPais] = useState(inicial.pais);

  const malo = (campo: string) => (estado.campo === campo ? "true" : undefined);
  const largo = DOCUMENTOS.find(([c]) => c === tipoDoc)?.[2] ?? 0;
  const delExterior = pais !== "PE";

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
            <label className="etiqueta" htmlFor="tipoDocumento">Tipo de documento *</label>
            <select
              id="tipoDocumento" name="tipoDocumento" value={tipoDoc}
              onChange={(e) => setTipoDoc(e.target.value)} className="campo"
            >
              {DOCUMENTOS.map(([codigo, texto]) => (
                <option key={codigo} value={codigo}>
                  {texto}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="numeroDocumento">Número *</label>
            <input
              id="numeroDocumento" name="numeroDocumento" required
              defaultValue={inicial.numeroDocumento} className="campo cifra"
              style={{ textAlign: "left" }}
              {...(largo ? { maxLength: largo, inputMode: "numeric" as const } : {})}
              aria-invalid={malo("numeroDocumento")}
            />
            {tipoDoc === "6" && (
              <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
                Se valida el dígito verificador: un RUC mal escrito llega hasta el XML del
                comprobante y lo rechaza SUNAT.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="razonSocial">Razón social o nombre *</label>
            <input
              id="razonSocial" name="razonSocial" required maxLength={300}
              defaultValue={inicial.razonSocial} className="campo" aria-invalid={malo("razonSocial")}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="nombreComercial">Nombre comercial</label>
            <input
              id="nombreComercial" name="nombreComercial" maxLength={300}
              defaultValue={inicial.nombreComercial} className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="pais">País *</label>
            <input
              id="pais" name="pais" required maxLength={2} value={pais}
              onChange={(e) => setPais(e.target.value.toUpperCase())}
              className="campo uppercase" placeholder="PE"
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Código ISO de dos letras.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="direccion">Dirección</label>
            <input
              id="direccion" name="direccion" maxLength={300}
              defaultValue={inicial.direccion} className="campo"
            />
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Relación comercial</h2>
        <div className="mb-4 flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="esCliente" defaultChecked={inicial.esCliente} />
            Es cliente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="esProveedor" defaultChecked={inicial.esProveedor} />
            Es proveedor
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" name="esDomiciliado"
              defaultChecked={inicial.esDomiciliado} disabled={delExterior}
            />
            Domiciliado en el Perú
          </label>
        </div>

        {delExterior && (
          <p className="mb-4 text-xs" style={{ color: "var(--texto-suave)" }}>
            Un tercero del exterior no es domiciliado: su factura alimenta el módulo de
            importaciones y no genera crédito fiscal ni retención.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="diasCredito">Días de crédito</label>
            <input
              id="diasCredito" name="diasCredito" type="number" min={0} max={365}
              defaultValue={inicial.diasCredito} className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="limiteCredito">Límite de crédito</label>
            <input
              id="limiteCredito" name="limiteCredito" inputMode="decimal"
              defaultValue={inicial.limiteCredito} className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="monedaLimite">Moneda del límite</label>
            <select
              id="monedaLimite" name="monedaLimite"
              defaultValue={inicial.monedaLimite} className="campo"
            >
              <option value="PEN">PEN — soles</option>
              <option value="USD">USD — dólares</option>
            </select>
          </div>
        </div>
      </section>

      <section className="bloque p-4">
        <h2 className="mb-3 text-sm font-semibold">Contacto</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="email">Correo electrónico</label>
            <input
              id="email" name="email" type="email" defaultValue={inicial.email}
              className="campo" aria-invalid={malo("email")}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="telefono">Teléfono</label>
            <input
              id="telefono" name="telefono" maxLength={40}
              defaultValue={inicial.telefono} className="campo"
            />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Guardar />
        <Link href="/maestros/terceros" className="boton boton-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
