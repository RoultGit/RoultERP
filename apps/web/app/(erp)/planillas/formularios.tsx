"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  calcularAccion, cerrarAccion, anularAccion, guardarParametroAccion, guardarConceptoAccion,
  type EstadoPlanilla,
} from "./acciones";
import type { EstadoForm } from "@/lib/formulario";

function Enviar({ texto, variante = "primario" }: { texto: string; variante?: "primario" | "secundario" | "peligro" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${variante}`} disabled={pending}>
      {pending ? "Procesando…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (estado.error) {
    return (
      <div className="aviso" role="alert">
        {estado.error}
        {estado.motivos && estado.motivos.length > 1 && (
          <ul className="mt-1 list-disc pl-5">
            {estado.motivos.slice(1).map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (estado.exito) {
    return (
      <p className="rounded border px-3 py-2 text-sm" role="status"
        style={{ color: "var(--exito)", borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)" }}>
        {estado.exito}
      </p>
    );
  }
  return null;
}

/**
 * Alta de una planilla.
 *
 * El tipo decide casi todo: la mensual admite quincena y la gratificación, la
 * CTS y la liquidación no. La quincena existe porque SERVIDIMAR paga cada
 * quince días, pero la ley y los aportes son mensuales: la primera es un
 * adelanto a cuenta y la segunda liquida el mes y resta lo ya entregado.
 */
export function NuevaPlanilla({ periodoSugerido }: { periodoSugerido: string }) {
  const [estado, accion] = useActionState<EstadoPlanilla, FormData>(calcularAccion, {});
  const [tipo, setTipo] = useState("mensual");

  return (
    <form action={accion} className="tarjeta space-y-4 p-4">
      <Resultado estado={estado} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="etiqueta" htmlFor="tipo">Tipo</label>
          <select id="tipo" name="tipo" className="campo" value={tipo}
            onChange={(e) => setTipo(e.target.value)}>
            <option value="mensual">Planilla de sueldos</option>
            <option value="gratificacion">Gratificación</option>
            <option value="cts">CTS</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="periodo">Periodo</label>
          <input id="periodo" name="periodo" type="month" className="campo" required
            defaultValue={periodoSugerido} />
        </div>
        {tipo === "mensual" && (
          <div>
            <label className="etiqueta" htmlFor="quincena">Quincena</label>
            <select id="quincena" name="quincena" className="campo" defaultValue="">
              <option value="">Mes completo</option>
              <option value="1">Primera (adelanto)</option>
              <option value="2">Segunda (cierre del mes)</option>
            </select>
          </div>
        )}
        <div>
          <label className="etiqueta" htmlFor="numero">Número</label>
          <input id="numero" name="numero" className="campo" required maxLength={30}
            placeholder="PL-2026-09" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="fecha">Fecha</label>
          <input id="fecha" name="fecha" type="date" className="campo" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="fechaPago">Fecha de pago</label>
          <input id="fechaPago" name="fechaPago" type="date" className="campo" />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
          <input id="observaciones" name="observaciones" className="campo" maxLength={300} />
        </div>
        <label className="flex items-start gap-2 self-end text-sm">
          <input type="checkbox" name="aportaSenati" className="mt-0.5" />
          <span>
            Aporta al SENATI
            <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
              Sólo empresas de actividad industrial.
            </span>
          </span>
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
          Se calcula para todos los trabajadores activos y queda en borrador. Recalcular la rehace;
          cerrarla la contabiliza.
        </p>
        <Enviar texto="Calcular" />
      </div>
    </form>
  );
}

export function CerrarPlanilla({ planillaId }: { planillaId: string }) {
  const [estado, accion] = useActionState<EstadoPlanilla, FormData>(cerrarAccion, {});
  return (
    <form action={accion} className="space-y-2">
      <Resultado estado={estado} />
      <input type="hidden" name="planillaId" value={planillaId} />
      <Enviar texto="Cerrar y contabilizar" />
    </form>
  );
}

export function AnularPlanilla({ planillaId }: { planillaId: string }) {
  const [estado, accion] = useActionState<EstadoPlanilla, FormData>(anularAccion, {});
  return (
    <details className="tarjeta">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none"
        style={{ color: "var(--peligro)" }}>
        Anular la planilla
      </summary>
      <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
        <Resultado estado={estado} />
        <input type="hidden" name="planillaId" value={planillaId} />
        <div>
          <label className="etiqueta" htmlFor="motivoAnular">Motivo</label>
          <input id="motivoAnular" name="motivo" className="campo" required maxLength={200} />
        </div>
        <Enviar texto="Anular" variante="peligro" />
      </form>
    </details>
  );
}

// ─── Configuración ──────────────────────────────────────────────────────────

export function FormularioParametro({ claves }: { claves: readonly { clave: string; nombre: string }[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarParametroAccion, {});
  return (
    <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ minWidth: "16rem" }}>
          <label className="etiqueta" htmlFor="clave">Parámetro</label>
          <select id="clave" name="clave" className="campo" required>
            {claves.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="vigenteDesde">Rige desde</label>
          <input id="vigenteDesde" name="vigenteDesde" type="date" className="campo" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="valor">Valor</label>
          <input id="valor" name="valor" className="campo cifra text-right" required
            inputMode="decimal" style={{ width: "8rem" }} />
        </div>
        <Enviar texto="Guardar" variante="secundario" />
      </div>
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Las tasas van en tanto por uno: 0.13 para el 13 %. La vigencia importa — reabrir un mes viejo
        tiene que dar las mismas cifras que dio entonces.
      </p>
    </form>
  );
}

export function FormularioConcepto() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarConceptoAccion, {});
  const [calculo, setCalculo] = useState("manual");
  return (
    <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label className="etiqueta" htmlFor="codigo">Código</label>
          <input id="codigo" name="codigo" className="campo cifra" required maxLength={20}
            placeholder="BONOPROD" style={{ textTransform: "uppercase" }} />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="nombre">Nombre en la boleta</label>
          <input id="nombre" name="nombre" className="campo" required maxLength={80} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="tipoConcepto">Tipo</label>
          <select id="tipoConcepto" name="tipo" className="campo" required>
            <option value="ingreso">Ingreso</option>
            <option value="descuento">Descuento</option>
            <option value="aporte">Aporte del empleador</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="calculo">Cálculo</label>
          <select id="calculo" name="calculo" className="campo" value={calculo}
            onChange={(e) => setCalculo(e.target.value)}>
            <option value="manual">Se teclea cada planilla</option>
            <option value="fijo">Fijo, prorrateado por días</option>
            <option value="porcentaje">Porcentaje de la base</option>
          </select>
        </div>
        {calculo === "porcentaje" && (
          <div>
            <label className="etiqueta" htmlFor="tasa">Tasa (tanto por uno)</label>
            <input id="tasa" name="tasa" className="campo cifra text-right" inputMode="decimal"
              placeholder="0.05" />
          </div>
        )}
        <div>
          <label className="etiqueta" htmlFor="cuenta">Cuenta contable</label>
          <input id="cuenta" name="cuenta" className="campo cifra" maxLength={10}
            placeholder="6215" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="orden">Orden</label>
          <input id="orden" name="orden" className="campo cifra text-right" inputMode="numeric"
            placeholder="500" />
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="remunerativo" className="mt-0.5" />
          <span>
            Remunerativo
            {/*
              Es la bandera que más caro sale equivocar: entra en la base de
              pensiones, EsSalud, CTS y gratificación, y el error viaja hasta la
              liquidación años después.
            */}
            <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
              Entra en pensiones, EsSalud, CTS y gratificación.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="afectaQuinta" className="mt-0.5" />
          <span>Afecto a quinta categoría</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="computableCts" className="mt-0.5" />
          <span>Computable para CTS</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="desactivar" className="mt-0.5" />
          <span>Desactivar (dejar de usarlo)</span>
        </label>
      </div>
      <div className="flex justify-end">
        <Enviar texto="Guardar concepto" variante="secundario" />
      </div>
    </form>
  );
}
