"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registrarNotaAccion, type EstadoForm } from "./acciones";
import { hoyEnPeru } from "@roulterp/core/fecha";
import { useLineas } from "@/lib/lineas";

export type Opcion = { id: string; etiqueta: string };

/**
 * Los cuatro tipos de nota, con lo que cada uno necesita.
 *
 * La contrapartida sugerida es la que usa un almacén el 90 % de las veces; se
 * puede cambiar, pero proponerla evita que quien captura tenga que decidir
 * contabilidad para dar de baja una bolsa rota.
 */
const TIPOS = {
  ingreso: {
    titulo: "Nota de ingreso",
    ayuda: "Mercadería que entra sin venir de una compra: saldo inicial, donación, devolución de obra.",
    pideCosto: true,
    pideContrapartida: true,
    sugerida: "5911",
  },
  salida: {
    titulo: "Nota de salida",
    ayuda: "Mercadería que sale sin venderse: consumo propio, merma, rotura. El costo lo pone el kardex.",
    pideCosto: false,
    pideContrapartida: true,
    sugerida: "6591",
  },
  transferencia: {
    titulo: "Transferencia entre almacenes",
    ayuda: "La mercadería cambia de sitio, no de dueño ni de valor. No genera asiento contable.",
    pideCosto: false,
    pideContrapartida: false,
    sugerida: "",
  },
  ajuste: {
    titulo: "Nota de ajuste",
    ayuda: "Cuadra el almacén con el inventario físico. El sobrante entra, el faltante sale.",
    pideCosto: true,
    pideContrapartida: true,
    sugerida: "6592",
  },
} as const;

type Tipo = keyof typeof TIPOS;
type Linea = { clave: number; productoId: string; cantidad: string; costoUnitario: string; lote: string };

const vacia = (): Omit<Linea, "clave"> => ({
  productoId: "",
  cantidad: "1",
  costoUnitario: "",
  lote: "",
});

function Registrar({ titulo }: { titulo: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton boton-primario" disabled={pending}>
      {pending ? "Registrando…" : `Registrar ${titulo.toLowerCase()}`}
    </button>
  );
}

export function FormularioNota({
  almacenes,
  productos,
  cuentas,
  centrosCosto,
  terceros,
}: {
  almacenes: Opcion[];
  productos: Opcion[];
  cuentas: Opcion[];
  centrosCosto: Opcion[];
  terceros: Opcion[];
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(registrarNotaAccion, {});
  const [tipo, setTipo] = useState<Tipo>("salida");
  const [sentido, setSentido] = useState<"ingreso" | "salida">("salida");
  const { lineas, actualizar, agregar, quitar } = useLineas<Linea>(vacia);
  const hoy = hoyEnPeru();

  const cfg = TIPOS[tipo];
  // En un ajuste el costo sólo hace falta si la mercadería entra.
  const pideCosto = tipo === "ajuste" ? sentido === "ingreso" : cfg.pideCosto;


  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="tipo" value={tipo} />
      {tipo === "ajuste" && <input type="hidden" name="sentidoAjuste" value={sentido} />}

      {estado.error && (
        <div className="aviso" role="alert">
          {(estado.motivos ?? [estado.error]).map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TIPOS) as Tipo[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className="rounded border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: tipo === t ? "var(--acento)" : "var(--borde)",
              background: tipo === t ? "var(--acento-suave)" : "var(--superficie)",
              color: tipo === t ? "var(--acento)" : "var(--texto-suave)",
              fontWeight: tipo === t ? 500 : 400,
            }}
          >
            {TIPOS[t].titulo}
          </button>
        ))}
      </div>

      <section className="bloque p-4">
        <p className="mb-3 text-sm" style={{ color: "var(--texto-suave)" }}>{cfg.ayuda}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="etiqueta" htmlFor="fecha">Fecha *</label>
            <input id="fecha" name="fecha" type="date" required defaultValue={hoy} className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="almacenId">
              {tipo === "transferencia" ? "Almacén de origen *" : "Almacén *"}
            </label>
            <select id="almacenId" name="almacenId" required className="campo" defaultValue="">
              <option value="" disabled>Elija el almacén</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.etiqueta}</option>
              ))}
            </select>
          </div>

          {tipo === "transferencia" && (
            <div>
              <label className="etiqueta" htmlFor="almacenDestinoId">Almacén de destino *</label>
              <select id="almacenDestinoId" name="almacenDestinoId" required className="campo" defaultValue="">
                <option value="" disabled>Elija el destino</option>
                {almacenes.map((a) => (
                  <option key={a.id} value={a.id}>{a.etiqueta}</option>
                ))}
              </select>
            </div>
          )}

          {tipo === "ajuste" && (
            <div>
              <label className="etiqueta" htmlFor="sentido">Diferencia *</label>
              <select
                id="sentido" className="campo" value={sentido}
                onChange={(e) => setSentido(e.target.value as "ingreso" | "salida")}
              >
                <option value="salida">Faltante — sale del almacén</option>
                <option value="ingreso">Sobrante — entra al almacén</option>
              </select>
            </div>
          )}

          {cfg.pideContrapartida && (
            <div>
              <label className="etiqueta" htmlFor="cuentaContrapartida">Contra la cuenta *</label>
              <select
                id="cuentaContrapartida" name="cuentaContrapartida" required
                className="campo cifra" key={tipo} defaultValue={cfg.sugerida}
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>{c.etiqueta}</option>
                ))}
              </select>
            </div>
          )}

          {cfg.pideContrapartida && (
            <div>
              <label className="etiqueta" htmlFor="centroCostoId">Centro de costo</label>
              <select id="centroCostoId" name="centroCostoId" className="campo" defaultValue="">
                <option value="">—</option>
                {centrosCosto.map((c) => (
                  <option key={c.id} value={c.id}>{c.etiqueta}</option>
                ))}
              </select>
            </div>
          )}

          {tipo === "ingreso" && (
            <div>
              <label className="etiqueta" htmlFor="terceroId">Tercero</label>
              <select id="terceroId" name="terceroId" className="campo" defaultValue="">
                <option value="">—</option>
                {terceros.map((t) => (
                  <option key={t.id} value={t.id}>{t.etiqueta}</option>
                ))}
              </select>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="etiqueta" htmlFor="glosa">Motivo *</label>
            <input
              id="glosa" name="glosa" required maxLength={200} className="campo"
              placeholder="Envío a la obra de San Miguel"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="referencia">Referencia</label>
            <input id="referencia" name="referencia" maxLength={60} className="campo" placeholder="Vale 0012" />
          </div>
        </div>
      </section>

      <section className="bloque overflow-x-auto">
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--borde)" }}>
          <h2 className="text-sm font-semibold">Artículos</h2>
          <button
            type="button" className="boton boton-secundario"
            onClick={() => agregar()}
          >
            Añadir artículo
          </button>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="text-right" style={{ width: "14%" }}>Cantidad</th>
              {pideCosto && <th className="text-right" style={{ width: "16%" }}>Costo unitario</th>}
              <th style={{ width: "14%" }}>Lote</th>
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
                    <option value="">— elija —</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name={`lineas[${i}].cantidad`} className="campo cifra text-right"
                    inputMode="decimal" value={l.cantidad}
                    onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
                  />
                </td>
                {pideCosto && (
                  <td>
                    <input
                      name={`lineas[${i}].costoUnitario`} className="campo cifra text-right"
                      inputMode="decimal" value={l.costoUnitario} placeholder="0.00"
                      onChange={(e) => actualizar(l.clave, { costoUnitario: e.target.value })}
                    />
                  </td>
                )}
                <td>
                  <input
                    name={`lineas[${i}].lote`} className="campo" maxLength={30} value={l.lote}
                    onChange={(e) => actualizar(l.clave, { lote: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button" className="boton boton-secundario"
                    aria-label={`Quitar el artículo ${i + 1}`}
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
        {!pideCosto && tipo !== "transferencia" && (
          <p className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--borde)", color: "var(--texto-suave)" }}>
            El costo de la salida lo determina el kardex, no quien captura.
          </p>
        )}
      </section>

      <div className="flex gap-2">
        <Registrar titulo={cfg.titulo} />
        <Link href={"/inventario" as Route} className="boton boton-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
