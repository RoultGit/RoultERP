"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  crearCuentaAccion, registrarMovimientoAccion, registrarArqueoAccion,
  importarExtractoAccion, conciliarAccion, type EstadoForm,
} from "./acciones";
import { formatearImporte, Insignia } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

type Opcion = { cuenta: string; etiqueta: string };

function Boton({ texto, cargando }: { texto: string; cargando: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? cargando : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (estado.error) return <p className="aviso mb-3" role="alert">{estado.error}</p>;
  if (estado.exito) {
    return (
      <p
        className="mb-3 rounded border px-3 py-2 text-sm"
        style={{ color: "var(--exito)", borderColor: "color-mix(in srgb, var(--exito) 40%, transparent)" }}
        role="status"
      >
        {estado.exito}
      </p>
    );
  }
  return null;
}

/** Cuenta del PCGE que corresponde a cada tipo de cuenta de efectivo. */
const CUENTA_SUGERIDA: Record<string, string> = {
  banco: "1041",
  caja: "1011",
  caja_chica: "1012",
};

export function FormularioCuenta({ cuentasContables }: { cuentasContables: Opcion[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(crearCuentaAccion, {});
  const [tipo, setTipo] = useState("banco");

  return (
    <form action={accion} className="space-y-3">
      <Resultado estado={estado} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="etiqueta" htmlFor="codigo">Código *</label>
          <input id="codigo" name="codigo" required maxLength={20}
                 className="campo uppercase" placeholder="BCP-SOL" />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="nombre">Nombre *</label>
          <input id="nombre" name="nombre" required maxLength={120}
                 className="campo" placeholder="BCP cuenta corriente soles" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="tipo">Tipo *</label>
          <select id="tipo" name="tipo" className="campo" value={tipo}
                  onChange={(e) => setTipo(e.target.value)}>
            <option value="banco">Banco</option>
            <option value="caja">Caja</option>
            <option value="caja_chica">Caja chica</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="moneda">Moneda *</label>
          <select id="moneda" name="moneda" className="campo" defaultValue="PEN">
            <option value="PEN">PEN</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="cuentaContable">Cuenta contable *</label>
          {/*
            Se propone la que corresponde al tipo: una cuenta de banco va a la
            1041 y una caja a la 1011 en el 99 % de los casos. Obligar a
            buscarla entre las noventa y seis del plan es hacer trabajar al
            usuario para que escriba lo único que podía escribir.
          */}
          <select
            key={tipo}
            id="cuentaContable"
            name="cuentaContable"
            required
            className="campo"
            defaultValue={
              cuentasContables.some((c) => c.cuenta === CUENTA_SUGERIDA[tipo])
                ? CUENTA_SUGERIDA[tipo]
                : ""
            }
          >
            <option value="" disabled>Elija la cuenta</option>
            {cuentasContables.map((c) => (
              <option key={c.cuenta} value={c.cuenta}>{c.etiqueta}</option>
            ))}
          </select>
        </div>

        {tipo === "banco" && (
          <>
            <div>
              <label className="etiqueta" htmlFor="banco">Banco</label>
              <input id="banco" name="banco" maxLength={60} className="campo" placeholder="BCP" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="numeroCuenta">Número de cuenta *</label>
              <input id="numeroCuenta" name="numeroCuenta" required maxLength={40}
                     className="campo cifra" style={{ textAlign: "left" }} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="cci">CCI</label>
              <input id="cci" name="cci" maxLength={40} className="campo cifra"
                     style={{ textAlign: "left" }} />
            </div>
          </>
        )}

        {tipo === "caja_chica" && (
          <div>
            <label className="etiqueta" htmlFor="fondoFijo">Fondo fijo</label>
            <input id="fondoFijo" name="fondoFijo" inputMode="decimal" className="campo" />
            <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
              El importe que se repone cada vez que se rinde.
            </p>
          </div>
        )}
      </div>

      <Boton texto="Crear cuenta" cargando="Creando…" />
    </form>
  );
}

export function FormularioMovimiento({
  cuentaId,
  contrapartidas,
}: {
  cuentaId: string;
  contrapartidas: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(registrarMovimientoAccion, {});
  const hoy = hoyEnPeru();

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <Resultado estado={estado} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta" htmlFor="fecha-mov">Fecha *</label>
          <input id="fecha-mov" name="fecha" type="date" required defaultValue={hoy} className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="sentido">Sentido *</label>
          <select id="sentido" name="sentido" className="campo" defaultValue="egreso">
            <option value="egreso">Egreso — sale dinero</option>
            <option value="ingreso">Ingreso — entra dinero</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="concepto">Concepto *</label>
          <input id="concepto" name="concepto" required maxLength={200}
                 className="campo" placeholder="Comisión de mantenimiento" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="importe-mov">Importe *</label>
          <input id="importe-mov" name="importe" inputMode="decimal" required className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="referencia-mov">Referencia</label>
          <input id="referencia-mov" name="referencia" maxLength={60} className="campo"
                 placeholder="N.º de operación" />
          <p className="mt-1 text-xs" style={{ color: "var(--texto-suave)" }}>
            Si la anota, la conciliación la usará para casar con el extracto.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="cuentaContrapartida">Contrapartida contable *</label>
          <select id="cuentaContrapartida" name="cuentaContrapartida" required
                  className="campo" defaultValue="">
            <option value="" disabled>Elija la cuenta</option>
            {contrapartidas.map((c) => (
              <option key={c.cuenta} value={c.cuenta}>{c.etiqueta}</option>
            ))}
          </select>
        </div>
      </div>

      <Boton texto="Registrar movimiento" cargando="Registrando…" />
    </form>
  );
}

export function FormularioArqueo({
  cuentaId,
  saldoActual,
}: {
  cuentaId: string;
  saldoActual: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(registrarArqueoAccion, {});
  const [contado, setContado] = useState("");
  const hoy = hoyEnPeru();

  const diferencia =
    contado === "" ? null : (Number(contado) || 0) - (Number(saldoActual) || 0);

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <Resultado estado={estado} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta" htmlFor="fecha-arq">Fecha *</label>
          <input id="fecha-arq" name="fecha" type="date" required defaultValue={hoy} className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="saldoContado">Efectivo contado *</label>
          <input
            id="saldoContado" name="saldoContado" inputMode="decimal" required
            className="campo cifra" value={contado}
            onChange={(e) => setContado(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="observaciones">Observaciones</label>
          <input id="observaciones" name="observaciones" maxLength={200} className="campo" />
        </div>
      </div>

      {diferencia !== null && (
        <p className="text-sm">
          Según el libro hay <strong className="cifra">{formatearImporte(saldoActual)}</strong>.{" "}
          {diferencia === 0 ? (
            <Insignia tono="exito">sin diferencia</Insignia>
          ) : (
            <Insignia tono={diferencia < 0 ? "peligro" : "alerta"}>
              {diferencia < 0 ? "faltante" : "sobrante"} de {formatearImporte(String(Math.abs(diferencia)))}
            </Insignia>
          )}
        </p>
      )}

      <Boton texto="Registrar arqueo" cargando="Registrando…" />
    </form>
  );
}

export function FormularioExtracto({ cuentaId }: { cuentaId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(importarExtractoAccion, {});

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <Resultado estado={estado} />

      <div>
        <label className="etiqueta" htmlFor="contenido">Líneas del extracto</label>
        <textarea
          id="contenido" name="contenido" rows={8} required
          className="campo font-mono text-xs"
          placeholder={"05/09/2026;CARGO COMISION;-15.00\n07/09/2026;ABONO TRANSFERENCIA;5000.00;OP-9001"}
        />
        <p className="mt-1.5 text-xs" style={{ color: "var(--texto-suave)" }}>
          Pegue lo que exporta su banca por internet: fecha, descripción, importe y, si lo trae,
          la referencia, separados por punto y coma o tabulador. La fecha se admite en DD/MM/AAAA
          o AAAA-MM-DD, y el importe negativo si es un cargo.
        </p>
      </div>

      <Boton texto="Importar extracto" cargando="Importando…" />
    </form>
  );
}

export type PropuestaVista = {
  clave: string;
  motivo: string;
  extracto: { fecha: string; descripcion: string; importe: string };
  movimiento: { fecha: string; concepto: string; importe: string; sentido: string };
};

const CONFIANZA: Record<string, { texto: string; tono: "exito" | "alerta" | "neutro" }> = {
  referencia: { texto: "referencia coincide", tono: "exito" },
  exacta: { texto: "fecha e importe exactos", tono: "exito" },
  aproximada: { texto: "importe igual, fecha cercana", tono: "alerta" },
};

export function FormularioConciliar({
  cuentaId,
  propuestas,
}: {
  cuentaId: string;
  propuestas: PropuestaVista[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(conciliarAccion, {});
  const hoy = hoyEnPeru();

  return (
    <form action={accion}>
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <input type="hidden" name="fecha" value={hoy} />

      <div className="p-4 pb-0">
        <Resultado estado={estado} />
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th className="w-10" />
            <th colSpan={3}>Extracto del banco</th>
            <th colSpan={3}>Movimiento propio</th>
            <th>Coincidencia</th>
          </tr>
        </thead>
        <tbody>
          {propuestas.map((p) => {
            const c = CONFIANZA[p.motivo] ?? { texto: p.motivo, tono: "neutro" as const };
            return (
              <tr key={p.clave}>
                <td>
                  <input
                    type="checkbox" name={`confirmar[${p.clave}]`}
                    // Lo seguro viene marcado; lo aproximado exige que alguien
                    // lo mire, que es de lo que trata la conciliación.
                    defaultChecked={p.motivo !== "aproximada"}
                    aria-label="Confirmar esta pareja"
                  />
                </td>
                <td className="cifra" style={{ textAlign: "left" }}>{p.extracto.fecha}</td>
                <td className="max-w-[200px] truncate">{p.extracto.descripcion}</td>
                <td className="cifra">{formatearImporte(p.extracto.importe)}</td>
                <td className="cifra" style={{ textAlign: "left" }}>{p.movimiento.fecha}</td>
                <td className="max-w-[200px] truncate">{p.movimiento.concepto}</td>
                <td className="cifra">
                  {p.movimiento.sentido === "egreso" ? "−" : ""}
                  {formatearImporte(p.movimiento.importe)}
                </td>
                <td><Insignia tono={c.tono}>{c.texto}</Insignia></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="border-t p-4" style={{ borderColor: "var(--borde)" }}>
        <Boton texto="Conciliar lo marcado" cargando="Conciliando…" />
      </div>
    </form>
  );
}
