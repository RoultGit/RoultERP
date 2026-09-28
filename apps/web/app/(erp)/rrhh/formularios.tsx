"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  guardarTrabajadorAccion, guardarRemuneracionAccion, guardarContratoAccion,
  renovarContratoAccion, cesarAccion, type EstadoForm,
} from "./acciones";

export type Opcion = { id: string; nombre: string };
export type AfpOpcion = { codigo: string; nombre: string };

function Enviar({ texto, variante = "primario" }: { texto: string; variante?: "primario" | "secundario" | "peligro" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${variante}`} disabled={pending}>
      {pending ? "Guardando…" : texto}
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
            {estado.motivos.slice(1).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
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

// ─── Alta y edición del trabajador ──────────────────────────────────────────

export type DatosFormulario = {
  id?: string;
  tipoDocumento: string;
  numeroDocumento: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombres: string;
  fechaNacimiento: string;
  sexo: string;
  email: string;
  telefono: string;
  direccion: string;
  fechaIngreso: string;
  cargo: string;
  area: string;
  centroCostoId: string;
  regimenPension: string;
  afpCodigo: string;
  afpComision: string;
  cuspp: string;
  tieneHijos: boolean;
  afiliadoEps: boolean;
  cci: string;
  banco: string;
  ctsBanco: string;
  ctsCuenta: string;
  observaciones: string;
};

export function FormularioTrabajador({
  inicial,
  centros,
  afps,
}: {
  inicial?: Partial<DatosFormulario>;
  centros: Opcion[];
  afps: AfpOpcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarTrabajadorAccion, {});
  const [regimen, setRegimen] = useState(inicial?.regimenPension ?? "onp");
  const enAfp = regimen === "afp";

  return (
    <form action={accion} className="space-y-5">
      <Resultado estado={estado} />
      {inicial?.id && <input type="hidden" name="trabajadorId" value={inicial.id} />}

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Identificación</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="tipoDocumento">Documento</label>
            <select id="tipoDocumento" name="tipoDocumento" className="campo"
              defaultValue={inicial?.tipoDocumento ?? "1"}>
              <option value="1">DNI</option>
              <option value="4">Carné de extranjería</option>
              <option value="7">Pasaporte</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="numeroDocumento">Número</label>
            <input id="numeroDocumento" name="numeroDocumento" className="campo cifra" required
              maxLength={15} defaultValue={inicial?.numeroDocumento ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="apellidoPaterno">Apellido paterno</label>
            <input id="apellidoPaterno" name="apellidoPaterno" className="campo" required
              maxLength={60} defaultValue={inicial?.apellidoPaterno ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="apellidoMaterno">Apellido materno</label>
            <input id="apellidoMaterno" name="apellidoMaterno" className="campo" maxLength={60}
              defaultValue={inicial?.apellidoMaterno ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="nombres">Nombres</label>
            <input id="nombres" name="nombres" className="campo" required maxLength={80}
              defaultValue={inicial?.nombres ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="fechaNacimiento">Nacimiento</label>
            <input id="fechaNacimiento" name="fechaNacimiento" type="date" className="campo"
              defaultValue={inicial?.fechaNacimiento ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="sexo">Sexo</label>
            <select id="sexo" name="sexo" className="campo" defaultValue={inicial?.sexo ?? ""}>
              <option value="">—</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="telefono">Teléfono</label>
            <input id="telefono" name="telefono" className="campo" maxLength={30}
              defaultValue={inicial?.telefono ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="email">Correo</label>
            <input id="email" name="email" type="email" className="campo" maxLength={120}
              defaultValue={inicial?.email ?? ""} />
          </div>
          <div className="sm:col-span-3">
            <label className="etiqueta" htmlFor="direccion">Dirección</label>
            <input id="direccion" name="direccion" className="campo" maxLength={200}
              defaultValue={inicial?.direccion ?? ""} />
          </div>
        </div>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Puesto</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="fechaIngreso">Fecha de ingreso</label>
            <input id="fechaIngreso" name="fechaIngreso" type="date" className="campo" required
              defaultValue={inicial?.fechaIngreso ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cargo">Cargo</label>
            <input id="cargo" name="cargo" className="campo" maxLength={80}
              defaultValue={inicial?.cargo ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="area">Área</label>
            <input id="area" name="area" className="campo" maxLength={80}
              defaultValue={inicial?.area ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="centroCostoId">Centro de costo</label>
            <select id="centroCostoId" name="centroCostoId" className="campo"
              defaultValue={inicial?.centroCostoId ?? ""}>
              <option value="">—</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {/*
              El sueldo es la mayor parte del costo en una empresa de servicios.
              Sin centro de costo, el resultado por centro lo deja fuera y cada
              obra parece más rentable de lo que es.
            */}
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              A este centro se carga su sueldo en el asiento de la planilla.
            </p>
          </div>
          {!inicial?.id && (
            <div>
              <label className="etiqueta" htmlFor="basico">Remuneración básica (S/)</label>
              <input id="basico" name="basico" className="campo cifra text-right" required
                inputMode="decimal" placeholder="2500.00" />
              <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
                Abre el historial con la fecha de ingreso.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Pensiones y salud</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiqueta" htmlFor="regimenPension">Sistema de pensiones</label>
            <select id="regimenPension" name="regimenPension" className="campo" value={regimen}
              onChange={(e) => setRegimen(e.target.value)}>
              <option value="onp">ONP</option>
              <option value="afp">AFP</option>
              <option value="ninguno">Ninguno</option>
            </select>
          </div>
          {enAfp && (
            <>
              <div>
                <label className="etiqueta" htmlFor="afpCodigo">AFP</label>
                <select id="afpCodigo" name="afpCodigo" className="campo" required
                  defaultValue={inicial?.afpCodigo ?? ""}>
                  <option value="">Elija una</option>
                  {afps.map((a) => (
                    <option key={a.codigo} value={a.codigo}>{a.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="afpComision">Comisión</label>
                <select id="afpComision" name="afpComision" className="campo"
                  defaultValue={inicial?.afpComision ?? "flujo"}>
                  <option value="flujo">Por flujo (sobre la remuneración)</option>
                  <option value="mixta">Mixta (sobre el saldo)</option>
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="cuspp">CUSPP</label>
                <input id="cuspp" name="cuspp" className="campo cifra" maxLength={20}
                  defaultValue={inicial?.cuspp ?? ""} />
              </div>
            </>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="tieneHijos" className="mt-0.5"
              defaultChecked={inicial?.tieneHijos ?? false} />
            <span>
              Tiene hijos a cargo
              <span className="block text-xs" style={{ color: "var(--texto-suave)" }}>
                Menores de 18, o hasta 24 estudiando. Da derecho a asignación familiar.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="afiliadoEps" className="mt-0.5"
              defaultChecked={inicial?.afiliadoEps ?? false} />
            <span>Afiliado a EPS</span>
          </label>
        </div>
      </section>

      <section className="tarjeta p-4">
        <h2 className="mb-3 text-sm font-semibold">Cuentas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="banco">Banco del sueldo</label>
            <input id="banco" name="banco" className="campo" maxLength={60}
              defaultValue={inicial?.banco ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="cci">CCI</label>
            <input id="cci" name="cci" className="campo cifra" maxLength={25}
              defaultValue={inicial?.cci ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ctsBanco">Banco de la CTS</label>
            <input id="ctsBanco" name="ctsBanco" className="campo" maxLength={60}
              defaultValue={inicial?.ctsBanco ?? ""} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ctsCuenta">Cuenta de la CTS</label>
            <input id="ctsCuenta" name="ctsCuenta" className="campo cifra" maxLength={30}
              defaultValue={inicial?.ctsCuenta ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
            <input id="observaciones" name="observaciones" className="campo" maxLength={300}
              defaultValue={inicial?.observaciones ?? ""} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Enviar texto={inicial?.id ? "Guardar cambios" : "Dar de alta"} />
      </div>
    </form>
  );
}

// ─── Remuneración, contrato y cese ──────────────────────────────────────────

export function NuevaRemuneracion({ trabajadorId }: { trabajadorId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarRemuneracionAccion, {});
  return (
    <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />
      <input type="hidden" name="trabajadorId" value={trabajadorId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="etiqueta" htmlFor="vigenteDesde">Rige desde</label>
          <input id="vigenteDesde" name="vigenteDesde" type="date" className="campo" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="basicoNuevo">Nuevo básico (S/)</label>
          <input id="basicoNuevo" name="basico" className="campo cifra text-right" required
            inputMode="decimal" />
        </div>
        <div style={{ flex: 1, minWidth: "12rem" }}>
          <label className="etiqueta" htmlFor="motivo">Motivo</label>
          <input id="motivo" name="motivo" className="campo" maxLength={120}
            placeholder="Aumento anual, promoción, ajuste por ley…" />
        </div>
        <Enviar texto="Registrar" variante="secundario" />
      </div>
    </form>
  );
}

export function NuevoContrato({ trabajadorId }: { trabajadorId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarContratoAccion, {});
  const [tipo, setTipo] = useState("plazo_fijo");
  return (
    <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />
      <input type="hidden" name="trabajadorId" value={trabajadorId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="etiqueta" htmlFor="tipo">Tipo</label>
          <select id="tipo" name="tipo" className="campo" value={tipo}
            onChange={(e) => setTipo(e.target.value)}>
            <option value="plazo_fijo">Plazo fijo</option>
            <option value="indeterminado">Indeterminado</option>
            <option value="parcial">Tiempo parcial</option>
            <option value="practicas">Prácticas</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="fechaInicio">Inicio</label>
          <input id="fechaInicio" name="fechaInicio" type="date" className="campo" required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="fechaFin">Fin</label>
          <input id="fechaFin" name="fechaFin" type="date" className="campo"
            required={tipo !== "indeterminado"} disabled={tipo === "indeterminado"} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="modalidad">Modalidad</label>
          <input id="modalidad" name="modalidad" className="campo" maxLength={80}
            placeholder="Necesidad de mercado…" disabled={tipo === "indeterminado"} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="jornadaHoras">Horas/semana</label>
          <input id="jornadaHoras" name="jornadaHoras" className="campo cifra text-right"
            inputMode="decimal" placeholder="48" style={{ width: "6rem" }} />
        </div>
        <Enviar texto="Registrar" variante="secundario" />
      </div>
      {tipo !== "indeterminado" && (
        <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
          Un contrato que no es indeterminado necesita fecha de fin: sin ella es un indeterminado
          disfrazado, y esa es la confusión que acaba en juicio.
        </p>
      )}
    </form>
  );
}

export function Renovar({ contratoId, trabajadorId, desde }: { contratoId: string; trabajadorId: string; desde: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(renovarContratoAccion, {});
  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <Resultado estado={estado} />
      <input type="hidden" name="contratoId" value={contratoId} />
      <input type="hidden" name="trabajadorId" value={trabajadorId} />
      <input name="fechaInicio" type="date" className="campo" required defaultValue={desde}
        aria-label="Inicio de la renovación" style={{ width: "9.5rem" }} />
      <input name="fechaFin" type="date" className="campo" required
        aria-label="Fin de la renovación" style={{ width: "9.5rem" }} />
      <Enviar texto="Renovar" variante="secundario" />
    </form>
  );
}

/**
 * Cese y liquidación.
 *
 * Va detrás de un `details` cerrado y pide confirmar: cesar a alguien no se
 * deshace desde la pantalla y su liquidación es dinero.
 */
export function Cesar({ trabajadorId, nombre }: { trabajadorId: string; nombre: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(cesarAccion, {});
  return (
    <details className="tarjeta">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none"
        style={{ color: "var(--peligro)" }}>
        Cesar a {nombre} y liquidar
      </summary>
      <form action={accion} className="space-y-3 border-t p-4" style={{ borderColor: "var(--borde)" }}>
        <Resultado estado={estado} />
        <input type="hidden" name="trabajadorId" value={trabajadorId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="fechaCese">Fecha de cese</label>
            <input id="fechaCese" name="fechaCese" type="date" className="campo" required />
          </div>
          <div>
            <label className="etiqueta" htmlFor="motivoCese">Motivo</label>
            <select id="motivoCese" name="motivo" className="campo" required>
              <option value="renuncia">Renuncia</option>
              <option value="vencimiento_contrato">Vencimiento de contrato</option>
              <option value="mutuo_acuerdo">Mutuo acuerdo</option>
              <option value="falta_grave">Falta grave</option>
              <option value="despido_arbitrario">Despido arbitrario</option>
              <option value="jubilacion">Jubilación</option>
              <option value="fallecimiento">Fallecimiento</option>
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="diasDelMes">Días trabajados del mes</label>
            <input id="diasDelMes" name="diasDelMes" className="campo cifra text-right"
              inputMode="numeric" placeholder="del día del cese" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="diasVacacionesPendientes">
              Vacaciones ganadas no gozadas (días)
            </label>
            <input id="diasVacacionesPendientes" name="diasVacacionesPendientes"
              className="campo cifra text-right" inputMode="numeric" placeholder="0" />
          </div>
          <div className="sm:col-span-2">
            <label className="etiqueta" htmlFor="obsCese">Observaciones</label>
            <input id="obsCese" name="observaciones" className="campo" maxLength={300} />
          </div>
        </div>
        <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
          Se calcula la liquidación —días del mes, CTS trunca, gratificación trunca y vacaciones— y
          queda como borrador para revisarla antes de contabilizarla. La falta grave no quita la CTS
          ni las vacaciones: sólo la indemnización.
        </p>
        <div className="flex justify-end">
          <Enviar texto="Cesar y liquidar" variante="peligro" />
        </div>
      </form>
    </details>
  );
}
