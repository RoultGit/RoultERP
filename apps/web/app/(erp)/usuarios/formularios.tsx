"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  invitarAccion, enlaceClaveAccion, revocarAccion, restaurarAccion, cambiarRolAccion,
  guardarRolAccion,
  type EstadoForm,
} from "./acciones";

export type RolOpcion = {
  id: string;
  codigo: string;
  nombre: string;
  permisos: string[];
  esSistema: boolean;
};

function Enviar({ texto, tono = "secundario" }: { texto: string; tono?: "primario" | "secundario" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`boton boton-${tono}`} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}

function Resultado({ estado }: { estado: EstadoForm }) {
  if (!estado.error && !estado.exito) return null;
  return (
    <div className="mt-2 text-xs">
      {estado.error && <p style={{ color: "var(--peligro)" }} role="alert">{estado.error}</p>}
      {estado.exito && <p style={{ color: "var(--exito)" }}>{estado.exito}</p>}
      {estado.token && (
        <div className="mt-2">
          <p style={{ color: "var(--texto-suave)" }}>
            Se muestra una sola vez: cópielo ahora y entrégueselo a la persona por un canal
            seguro. Es una llave de acceso, no se guarda en ninguna parte.
          </p>
          <code
            className="mt-1 block break-all rounded p-2 text-xs"
            style={{ background: "var(--superficie-2)" }}
          >
            {estado.ruta ?? "/invitacion"}?token={estado.token}
          </code>
        </div>
      )}
    </div>
  );
}

export function InvitarUsuario({ roles }: { roles: RolOpcion[] }) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(invitarAccion, {});
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="etiqueta" htmlFor="nombre">Nombre *</label>
          <input id="nombre" name="nombre" required maxLength={120} className="campo" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="email">Correo *</label>
          <input id="email" name="email" type="email" required className="campo" autoComplete="off" />
        </div>
        <div>
          <label className="etiqueta" htmlFor="rolCodigo">Rol *</label>
          <select id="rolCodigo" name="rolCodigo" required className="campo" defaultValue="">
            <option value="" disabled>Elija un rol</option>
            {roles.map((r) => (
              <option key={r.id} value={r.codigo}>{r.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      <Enviar texto="Invitar" tono="primario" />
      <Resultado estado={estado} />
    </form>
  );
}

/** Cambio de rol, revocación y restauración de un usuario concreto. */
export function AccionesUsuario({
  usuarioId,
  email,
  rolId,
  activo,
  esAdministrador,
  esUnoMismo,
  roles,
}: {
  usuarioId: string;
  email: string;
  rolId: string;
  activo: boolean;
  esAdministrador: boolean;
  esUnoMismo: boolean;
  roles: RolOpcion[];
}) {
  const [rol, accionRol] = useActionState<EstadoForm, FormData>(cambiarRolAccion, {});
  const [acceso, accionAcceso] = useActionState<EstadoForm, FormData>(
    activo ? revocarAccion : restaurarAccion,
    {},
  );
  const [clave, accionClave] = useActionState<EstadoForm, FormData>(enlaceClaveAccion, {});

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={accionRol} className="flex items-center gap-1">
          <input type="hidden" name="usuarioId" value={usuarioId} />
          {/*
            `key` con el rol que manda el servidor.

            Sin ella el desplegable se quedaba mostrando el rol anterior después
            de cambiarlo: React reinicia el formulario al terminar la acción y
            lo devolvía a su `defaultValue` original, que ya no era el vigente.
            La pantalla mentía sobre el estado real.
          */}
          <select
            key={rolId}
            name="rolId"
            defaultValue={rolId}
            className="campo"
            style={{ width: "10rem" }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
            ))}
          </select>
          <Enviar texto="Cambiar" />
        </form>

        {/*
          Restablecer la clave.
          
          Es el único camino de recuperación que hay mientras no haya servidor
          de correo: el administrador emite el enlace y se lo pasa a la persona.
          Sin esto, quien olvidaba su clave quedaba fuera para siempre.
        */}
        <form action={accionClave}>
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            className="boton boton-secundario"
            title="Genera un enlace de un solo uso para volver a fijar la contraseña"
          >
            Restablecer clave
          </button>
        </form>

        <form action={accionAcceso}>
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <input type="hidden" name="esAdministrador" value={esAdministrador ? "1" : "0"} />
          <button
            type="submit"
            className="boton boton-secundario"
            style={activo ? { color: "var(--peligro)" } : undefined}
            title={esUnoMismo ? "Es su propia cuenta" : undefined}
          >
            {activo ? "Revocar" : "Restaurar"}
          </button>
        </form>
      </div>
      <Resultado estado={rol} />
      <Resultado estado={acceso} />
      <Resultado estado={clave} />
    </div>
  );
}

/**
 * Editor de roles.
 *
 * La rejilla es módulo por acción porque así es como está definido el permiso
 * (`modulo:accion`) y así es como se piensa: «logística ve compras pero no las
 * aprueba». Una lista plana de sesenta casillas sería ilegible.
 */
export function EditorRol({
  modulos,
  acciones,
  rol,
}: {
  modulos: { codigo: string; nombre: string }[];
  acciones: { codigo: string; nombre: string }[];
  rol?: RolOpcion;
}) {
  const [estado, accion] = useActionState<EstadoForm, FormData>(guardarRolAccion, {});
  const [marcados, setMarcados] = useState<Set<string>>(new Set(rol?.permisos ?? []));

  const alternar = (permiso: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(permiso)) n.delete(permiso);
      else n.add(permiso);
      return n;
    });

  const alternarModulo = (modulo: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      const todos = acciones.map((a) => `${modulo}:${a.codigo}`);
      const tieneTodos = todos.every((p) => n.has(p));
      for (const p of todos) {
        if (tieneTodos) n.delete(p);
        else n.add(p);
      }
      return n;
    });

  return (
    <form action={accion} className="space-y-4">
      {rol && <input type="hidden" name="rolId" value={rol.id} />}
      {[...marcados].map((p) => (
        <input key={p} type="hidden" name="permisos" value={p} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta" htmlFor="codigo">Código *</label>
          <input
            id="codigo" name="codigo" required maxLength={30} className="campo cifra"
            style={{ textAlign: "left" }} defaultValue={rol?.codigo ?? ""}
            placeholder="almacenero"
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="nombre">Nombre *</label>
          <input
            id="nombre" name="nombre" required maxLength={60} className="campo"
            defaultValue={rol?.nombre ?? ""} placeholder="Almacenero"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Módulo</th>
              {acciones.map((a) => (
                <th key={a.codigo} className="text-center">{a.nombre}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modulos.map((m) => (
              <tr key={m.codigo}>
                <td>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => alternarModulo(m.codigo)}
                    title="Marcar o desmarcar todo el módulo"
                  >
                    {m.nombre}
                  </button>
                </td>
                {acciones.map((a) => {
                  const permiso = `${m.codigo}:${a.codigo}`;
                  return (
                    <td key={a.codigo} className="text-center">
                      <input
                        type="checkbox"
                        checked={marcados.has(permiso)}
                        onChange={() => alternar(permiso)}
                        aria-label={`${m.nombre}: ${a.nombre}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Enviar texto={rol ? "Guardar cambios" : "Crear rol"} tono="primario" />
      <Resultado estado={estado} />
    </form>
  );
}
