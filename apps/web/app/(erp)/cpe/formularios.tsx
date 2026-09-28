"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  subirCertificadoAccion, guardarCredencialesAccion, crearSerieAccion,
  type EstadoForm,
} from "./acciones";
import {
  guardarCredencialesGreAccion,
  type EstadoForm as EstadoFormGuia,
} from "../guias/acciones";

function Boton({ texto, cargando }: { texto: string; cargando: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? cargando : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (estado.error) {
    return (
      <p className="aviso mb-3" role="alert">
        {estado.error}
      </p>
    );
  }
  if (estado.exito) {
    return (
      <p
        className="mb-3 rounded border px-3 py-2 text-sm"
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

export function FormularioCertificado({ tieneUno }: { tieneUno: boolean }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(subirCertificadoAccion, {});

  return (
    <form action={accion} className="space-y-3 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />

      <div>
        <label className="etiqueta" htmlFor="pfx">
          {tieneUno ? "Reemplazar certificado" : "Archivo del certificado"} (.pfx o .p12)
        </label>
        <input
          id="pfx" name="pfx" type="file" accept=".pfx,.p12"
          required className="campo !py-1" />
      </div>

      <div>
        <label className="etiqueta" htmlFor="password">Contraseña del certificado</label>
        <input
          id="password" name="password" type="password" required
          autoComplete="off" className="campo" />
        <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
          Se comprueba al cargarlo: si la contraseña o el RUC no cuadran, se rechaza aquí y no el
          día que haya que facturar.
        </p>
      </div>

      <Boton texto={tieneUno ? "Reemplazar" : "Cargar certificado"} cargando="Verificando…" />

      {tieneUno && (
        <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
          El certificado anterior no se borra: con él se firmaron comprobantes que hay que poder
          explicar ante una fiscalización.
        </p>
      )}
    </form>
  );
}

export function FormularioCredenciales({
  usuarioActual,
  entornoActual,
}: {
  usuarioActual: string;
  entornoActual: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarCredencialesAccion, {});
  const [entorno, setEntorno] = useState(entornoActual);

  return (
    <form action={accion} className="space-y-3 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
      <Resultado estado={estado} />

      <div>
        <label className="etiqueta" htmlFor="usuarioSol">Usuario SOL</label>
        <input
          // Ver la nota del selector de rol en usuarios/formularios.tsx: sin
          // `key` el campo vuelve al valor que tenía al montarse, no al guardado.
          key={usuarioActual}
          id="usuarioSol" name="usuarioSol" required defaultValue={usuarioActual}
          className="campo uppercase" placeholder="MODDATOS" autoComplete="off" />
      </div>

      <div>
        <label className="etiqueta" htmlFor="claveSol">Clave SOL</label>
        <input
          id="claveSol" name="claveSol" type="password" required
          autoComplete="off" className="campo" />
      </div>

      <div>
        <label className="etiqueta" htmlFor="entorno">Entorno</label>
        <select
          id="entorno" name="entorno" className="campo"
          value={entorno} onChange={(e) => setEntorno(e.target.value)}
        >
          <option value="beta">Pruebas (beta) — no emite de verdad</option>
          <option value="produccion">Producción — emite comprobantes reales</option>
        </select>
        {entorno === "produccion" && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--alerta)" }}>
            En producción, cada comprobante enviado queda registrado ante SUNAT y sólo se corrige
            con una nota de crédito o una comunicación de baja.
          </p>
        )}
      </div>

      <Boton texto="Guardar credenciales" cargando="Guardando…" />
    </form>
  );
}

export function FormularioSerie() {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearSerieAccion, {});
  const [tipo, setTipo] = useState("01");

  return (
    <form action={accion} className="space-y-3">
      <Resultado estado={estado} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="etiqueta" htmlFor="tipoDocumento">Tipo</label>
          <select
            id="tipoDocumento" name="tipoDocumento" className="campo w-44"
            value={tipo} onChange={(e) => setTipo(e.target.value)}
          >
            <option value="01">Factura</option>
            <option value="03">Boleta de venta</option>
            <option value="07">Nota de crédito</option>
            <option value="08">Nota de débito</option>
            <option value="09">Guía de remisión</option>
            <option value="20">Comprobante de retención</option>
            <option value="40">Comprobante de percepción</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="serie">Serie</label>
          <input
            id="serie" name="serie" required maxLength={4}
            className="campo w-28 uppercase cifra" style={{ textAlign: "left" }}
            placeholder={tipo === "03" ? "B001" : "F001"}
          />
        </div>
        <Boton texto="Agregar serie" cargando="Agregando…" />
      </div>
    </form>
  );
}

/**
 * Credenciales de la API de guías de remisión.
 *
 * Van aparte de las SOL porque son otras: un `client_id` y un `client_secret`
 * que se generan en el menú SOL, en la opción de la GRE. Usar las SOL aquí
 * devuelve un 401 sin más explicación, que es donde se atasca casi todo el
 * mundo la primera vez.
 */
export function FormularioCredencialesGre({ clientIdActual }: { clientIdActual: string }) {
  const [estado, accion] = useActionState<EstadoFormGuia, FormData>(
    guardarCredencialesGreAccion,
    {},
  );

  return (
    <form action={accion} className="space-y-3">
      {estado.error && <p className="aviso" role="alert">{estado.error}</p>}
      {estado.exito && (
        <p className="text-sm" style={{ color: "var(--exito)" }}>{estado.exito}</p>
      )}
      <div>
        <label className="etiqueta" htmlFor="clientId">client_id *</label>
        <input
          id="clientId" name="clientId" required className="campo cifra"
          key={clientIdActual}
          style={{ textAlign: "left" }} defaultValue={clientIdActual}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="etiqueta" htmlFor="clientSecret">client_secret *</label>
        <input
          id="clientSecret" name="clientSecret" type="password" required className="campo"
          autoComplete="new-password" placeholder="Se guarda cifrado; no vuelve a mostrarse"
        />
      </div>
      <BotonGuardarGre />
    </form>
  );
}

function BotonGuardarGre() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-secundario" disabled={pending}>
      {pending ? "Guardando…" : "Guardar credenciales de la GRE"}
    </button>
  );
}
