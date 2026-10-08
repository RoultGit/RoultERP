"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { rendirAccion, anularAccion, type EstadoForm } from "../acciones";
import { formatearImporte } from "@/components/ui";
import { hoyEnPeru } from "@roulterp/core/fecha";

export type Opcion = { id: string; etiqueta: string };

type Linea = {
  clave: number;
  fecha: string;
  tipoDocumento: string;
  serie: string;
  numero: string;
  concepto: string;
  cuenta: string;
  importe: string;
};

/** Catálogo 01, en lo que se rinde de verdad. */
const DOCUMENTOS = [
  ["01", "Factura"],
  ["03", "Boleta"],
  ["02", "Recibo por honorarios"],
  ["12", "Ticket"],
  ["", "Sin documento"],
] as const;

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Rindiendo…" : "Registrar rendición"}
    </button>
  );
}

export function FormularioRendicion({
  entregaId,
  cuentas,
  centrosCosto,
  saldo,
}: {
  entregaId: string;
  cuentas: Opcion[];
  centrosCosto: Opcion[];
  saldo: string;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(rendirAccion, {});
  const hoy = hoyEnPeru();
  let siguiente = 0;
  const vacia = (): Linea => ({
    clave: siguiente++,
    fecha: hoy,
    tipoDocumento: "01",
    serie: "",
    numero: "",
    concepto: "",
    cuenta: cuentas[0]?.id ?? "",
    importe: "",
  });
  const [lineas, setLineas] = useState<Linea[]>([vacia()]);
  const [devuelve, setDevuelve] = useState("");

  const actualizar = (clave: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  const gastado = lineas.reduce((a, l) => a + (Number(l.importe) || 0), 0);
  const justificado = gastado + (Number(devuelve) || 0);
  const excede = justificado > Number(saldo) + 0.005;

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="entregaId" value={entregaId} />

      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="bloque overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--borde)" }}>
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha de la rendición *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo w-44" />
          </div>
          <button
            type="button" className="boton boton-secundario boton-chico"
            onClick={() => setLineas((ls) => [...ls, vacia()])}
          >
            Añadir documento
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-32">Fecha</th>
                <th className="w-28">Documento</th>
                <th className="w-20">Serie</th>
                <th className="w-24">Número</th>
                <th className="min-w-[180px]">Concepto</th>
                <th className="min-w-[180px]">Cuenta de gasto</th>
                <th className="w-28 text-right">Importe</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.clave}>
                  <td>
                    <input
                      name={`lineas[${i}].fecha`} type="date" value={l.fecha}
                      onChange={(e) => actualizar(l.clave, { fecha: e.target.value })}
                      className="campo campo-chico" />
                  </td>
                  <td>
                    <select
                      name={`lineas[${i}].tipoDocumento`} value={l.tipoDocumento}
                      onChange={(e) => actualizar(l.clave, { tipoDocumento: e.target.value })}
                      className="campo campo-chico"
                    >
                      {DOCUMENTOS.map(([v, t]) => (
                        <option key={v} value={v}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      name={`lineas[${i}].serie`} value={l.serie} maxLength={6}
                      onChange={(e) => actualizar(l.clave, { serie: e.target.value })}
                      className="campo campo-chico cifra" style={{ textAlign: "left" }} />
                  </td>
                  <td>
                    <input
                      name={`lineas[${i}].numero`} value={l.numero} maxLength={12}
                      onChange={(e) => actualizar(l.clave, { numero: e.target.value })}
                      className="campo campo-chico cifra" style={{ textAlign: "left" }} />
                  </td>
                  <td>
                    <input
                      name={`lineas[${i}].concepto`} value={l.concepto} maxLength={200}
                      onChange={(e) => actualizar(l.clave, { concepto: e.target.value })}
                      className="campo campo-chico" placeholder="Pasajes Lima–Trujillo" />
                  </td>
                  <td>
                    <select
                      name={`lineas[${i}].cuenta`} value={l.cuenta}
                      onChange={(e) => actualizar(l.clave, { cuenta: e.target.value })}
                      className="campo campo-chico"
                    >
                      {cuentas.map((c) => (
                        <option key={c.id} value={c.id}>{c.etiqueta}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      name={`lineas[${i}].importe`} value={l.importe} inputMode="decimal"
                      onChange={(e) => actualizar(l.clave, { importe: e.target.value })}
                      className="campo campo-chico cifra" placeholder="0.00" />
                  </td>
                  <td>
                    {lineas.length > 1 && (
                      <button
                        type="button" aria-label={`Quitar el documento ${i + 1}`}
                        className="text-xs" style={{ color: "var(--peligro)" }}
                        onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t px-4 py-3" style={{ borderColor: "var(--borde)" }}>
          <div>
            <label className="etiqueta" htmlFor="devuelve">Devuelve a caja</label>
            <input
              id="devuelve" name="devuelve" inputMode="decimal" value={devuelve}
              onChange={(e) => setDevuelve(e.target.value)}
              className="campo cifra w-40" placeholder="0.00" />
          </div>
          <dl className="text-sm">
            <div className="flex justify-between gap-6">
              <dt style={{ color: "var(--texto-suave)" }}>Documentos</dt>
              <dd className="cifra">{formatearImporte(String(gastado))}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt style={{ color: "var(--texto-suave)" }}>Justificado</dt>
              <dd className="cifra">{formatearImporte(String(justificado))}</dd>
            </div>
            <div className="flex justify-between gap-6 font-medium">
              <dt>Queda por rendir</dt>
              <dd className="cifra">{formatearImporte(String(Number(saldo) - justificado))}</dd>
            </div>
          </dl>
        </div>
      </section>

      {excede && (
        <p className="aviso" role="alert">
          Se está justificando más de lo entregado. Sólo quedan {formatearImporte(saldo)} por rendir.
        </p>
      )}

      <Guardar />
      <p className="text-xs" style={{ color: "var(--texto-suave)" }}>
        Cada documento va a su cuenta de gasto con su propia fecha, que puede ser de otro mes, y
        descarga la cuenta 14. El vuelto regresa a la caja en el mismo asiento.
      </p>
    </form>
  );
}

export function Anular({ entregaId }: { entregaId: string }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(anularAccion, {});
  return (
    <form action={accion} className="inline">
      <input type="hidden" name="entregaId" value={entregaId} />
      <button type="submit" className="boton boton-secundario">Anular</button>
      {estado.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--peligro)" }} role="alert">
          {estado.error}
        </span>
      )}
    </form>
  );
}
