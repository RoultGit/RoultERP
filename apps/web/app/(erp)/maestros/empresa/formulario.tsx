"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarEmpresaAccion, type EstadoForm } from "./acciones";

export type Empresa = {
  ruc: string;
  razonSocial: string;
  nombreComercial: string | null;
  direccion: string | null;
  ubigeo: string | null;
  monedaFuncional: string;
  metodoValorizacion: string;
  redondeoDetraccion: string;
  cuentaDetracciones: string | null;
  esAgenteRetencion: boolean;
  esAgentePercepcion: boolean;
};

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

export function FormularioEmpresa({
  empresa,
  puedeEditar,
  conKardex,
}: {
  empresa: Empresa;
  puedeEditar: boolean;
  conKardex: boolean;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarEmpresaAccion, {});

  return (
    <form action={accion} className="space-y-5">
      {estado.error && (
        <div className="aviso" role="alert">
          {estado.error}
          {estado.motivos && estado.motivos.length > 1 && (
            <ul className="mt-1 list-disc pl-5">
              {estado.motivos.slice(1).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {estado.exito && (
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
      )}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Identificación</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta">RUC</label>
            <input className="campo" value={empresa.ruc} disabled />
          </div>
          <div>
            <label className="etiqueta">Razón social</label>
            <input className="campo" value={empresa.razonSocial} disabled />
          </div>
        </div>
        {/*
          El RUC y la razón social viajan dentro de cada XML ya firmado y
          enviado a SUNAT. Cambiarlos desde aquí dejaría los comprobantes viejos
          diciendo una cosa y la pantalla otra, así que es un trámite y no un
          campo: se hace desde fuera, revisando lo que ya se emitió.
        */}
        <p className="mt-2 text-xs" style={{ color: "var(--texto-suave)" }}>
          El RUC y la razón social no se editan aquí: viajan dentro de los comprobantes que ya se
          enviaron a SUNAT. Un cambio de razón social se tramita revisando también lo emitido.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="nombreComercial">Nombre comercial</label>
            <input
              id="nombreComercial" name="nombreComercial" className="campo" maxLength={150}
              defaultValue={empresa.nombreComercial ?? ""} disabled={!puedeEditar}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ubigeo">Ubigeo</label>
            <input
              id="ubigeo" name="ubigeo" className="campo cifra" maxLength={6} inputMode="numeric"
              placeholder="180101" defaultValue={empresa.ubigeo ?? ""} disabled={!puedeEditar}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Seis dígitos. Va en cada guía de remisión como punto de partida.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="direccion">Dirección fiscal</label>
            <input
              id="direccion" name="direccion" className="campo" maxLength={200}
              defaultValue={empresa.direccion ?? ""} disabled={!puedeEditar}
            />
          </div>
        </div>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Tributario</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="cuentaDetracciones">
              Cuenta de detracciones (Banco de la Nación)
            </label>
            <input
              id="cuentaDetracciones" name="cuentaDetracciones" className="campo cifra"
              maxLength={25} placeholder="00-000-000000"
              defaultValue={empresa.cuentaDetracciones ?? ""} disabled={!puedeEditar}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              Sale impresa en la factura sujeta a detracción. Sin ella el cliente no puede
              depositar.
            </p>
          </div>
          <div>
            <label className="etiqueta" htmlFor="redondeoDetraccion">Redondeo del depósito</label>
            <select
              id="redondeoDetraccion" name="redondeoDetraccion" className="campo"
              defaultValue={empresa.redondeoDetraccion} disabled={!puedeEditar}
            >
              <option value="cercano">Al entero más cercano</option>
              <option value="arriba">Siempre hacia arriba</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox" name="esAgenteRetencion" className="mt-0.5"
              defaultChecked={empresa.esAgenteRetencion} disabled={!puedeEditar}
            />
            <span>
              Agente de retención del IGV
              <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
                Designado por SUNAT. Activa la retención del 3 % al pagar a proveedores.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox" name="esAgentePercepcion" className="mt-0.5"
              defaultChecked={empresa.esAgentePercepcion} disabled={!puedeEditar}
            />
            <span>
              Agente de percepción del IGV
              <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
                Designado por SUNAT. Activa la percepción al facturar a clientes.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Inventario y contabilidad</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="metodoValorizacion">Método de valorización</label>
            <select
              id="metodoValorizacion" name="metodoValorizacion" className="campo"
              defaultValue={empresa.metodoValorizacion}
              disabled={!puedeEditar || conKardex}
            >
              <option value="promedio">Costo promedio</option>
              <option value="peps">PEPS (primeras entradas, primeras salidas)</option>
            </select>
            <p className="mt-1 text-xs" style={{ color: conKardex ? "var(--alerta)" : "var(--texto-suave)" }}>
              {conKardex
                ? "Bloqueado: ya hay movimientos en el kardex. Cambiarlo reescribiría el costo de ventas de periodos ya declarados."
                : "Se elige antes del primer movimiento de almacén."}
            </p>
          </div>
          <div>
            <label className="etiqueta">Moneda funcional</label>
            <input className="campo" value={empresa.monedaFuncional} disabled />
          </div>
        </div>
      </section>

      {puedeEditar && (
        <div className="flex justify-end">
          <Guardar />
        </div>
      )}
    </form>
  );
}
