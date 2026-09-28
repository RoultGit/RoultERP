"use server";

import { revalidatePath } from "next/cache";
import {
  invitarUsuario, solicitarReseteo, revocarAcceso, restaurarAcceso, cambiarRol, guardarRol,
  administradoresActivos, rolesDeEmpresa,
} from "@roulterp/servicios";
import { exigirEmpresa, exigirPermiso } from "@/lib/sesion";
import { entornoAuth } from "@/lib/entorno";
import { type EstadoForm as Base, texto } from "@/lib/formulario";
import { traducirError } from "@/lib/errores";

/**
 * El enlace se devuelve para copiarlo en pantalla.
 *
 * `ruta` dice a qué pantalla lleva, porque no son la misma: una invitación
 * activa una cuenta nueva y un restablecimiento cambia la clave de una que ya
 * funciona. Mandar un token de reseteo a `/invitacion` lo rebotaría, porque
 * cada pantalla consume su propio tipo de token.
 */
export type EstadoForm = Base & { token?: string; ruta?: string };

const mensaje = (e: unknown) => traducirError(e, { contexto: "usuarios y roles" });

/**
 * Comprueba el permiso antes de tocar identidad.
 *
 * Las tablas de identidad viven fuera de RLS —un usuario pertenece a varias
 * empresas y su fila no es de ninguna—, así que aquí el RBAC no es la segunda
 * barrera sino la única. De ahí que se compruebe explícitamente en cada acción.
 */
async function exigirAdministrador() {
  const sesion = await exigirEmpresa();
  exigirPermiso(sesion.actor, sesion.empresaId, "usuarios:editar");
  return sesion;
}

export async function invitarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    const sesion = await exigirAdministrador();
    const { token } = await invitarUsuario(entornoAuth, {
      email: texto(form, "email"),
      nombre: texto(form, "nombre"),
      empresaId: sesion.empresaId,
      rolCodigo: texto(form, "rolCodigo"),
    });
    revalidatePath("/usuarios");
    return token
      ? {
          exito: "Invitación creada.",
          // El enlace se muestra una vez: no hay servidor de correo todavía y
          // guardarlo en algún sitio sería un token de acceso al descubierto.
          token,
          ruta: "/invitacion",
        }
      : { exito: "La persona ya tenía cuenta; se le dio acceso a esta empresa." };
  } catch (e) {
    return mensaje(e);
  }
}

/**
 * Genera un enlace para que alguien vuelva a fijar su contraseña.
 *
 * Es el único camino de recuperación mientras no haya servidor de correo: el
 * administrador emite el enlace y se lo entrega por donde se hablen. Se enseña
 * una sola vez y no se guarda en ninguna parte, porque es una llave de acceso
 * en texto plano.
 *
 * Usa `solicitarReseteo`, que ya existía en el servicio y no tenía pantalla
 * que lo llamara. El token es del tipo «reseteo», distinto del de invitación:
 * uno activa una cuenta que aún no servía y el otro cambia la clave de una que
 * ya funciona, y separarlos impide que una invitación vieja sirva para tomar
 * una cuenta activa.
 */
export async function enlaceClaveAccion(
  _previo: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await exigirAdministrador();
    const token = await solicitarReseteo(entornoAuth, texto(form, "email"));
    revalidatePath("/usuarios");
    return token
      ? {
          exito: "Enlace generado. Cópielo ahora: no se vuelve a mostrar.",
          token,
          ruta: "/restablecer",
        }
      : { error: "Esa cuenta no está activa; restáurela antes de restablecer su clave." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function revocarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    const sesion = await exigirAdministrador();
    const usuarioId = texto(form, "usuarioId");

    // Dejar la empresa sin administradores no se puede deshacer desde dentro
    // del producto: haría falta tocar la base a mano.
    if (texto(form, "esAdministrador") === "1") {
      const quedan = await administradoresActivos(entornoAuth, sesion.empresaId);
      if (quedan <= 1) {
        return { error: "Es el último administrador activo; primero designe a otro." };
      }
    }

    await revocarAcceso(entornoAuth, usuarioId, sesion.empresaId);
    revalidatePath("/usuarios");
    return { exito: "Acceso revocado. La cuenta sigue existiendo." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function restaurarAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    const sesion = await exigirAdministrador();
    await restaurarAcceso(entornoAuth, texto(form, "usuarioId"), sesion.empresaId);
    revalidatePath("/usuarios");
    return { exito: "Acceso restaurado." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function cambiarRolAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    const sesion = await exigirAdministrador();
    const usuarioId = texto(form, "usuarioId");
    const rolId = texto(form, "rolId");

    // Quitarse a uno mismo la administración deja la empresa sin quien la
    // gobierne si era el último.
    if (usuarioId === sesion.usuarioId) {
      const roles = await rolesDeEmpresa(entornoAuth, sesion.empresaId);
      const destino = roles.find((r) => r.id === rolId);
      if (destino && !destino.permisos.includes("usuarios:editar")) {
        const quedan = await administradoresActivos(entornoAuth, sesion.empresaId);
        if (quedan <= 1) {
          return { error: "Se quedaría sin administrador; designe a otro antes de cambiar el suyo." };
        }
      }
    }

    await cambiarRol(entornoAuth, usuarioId, sesion.empresaId, rolId);
    revalidatePath("/usuarios");
    return { exito: "Rol actualizado." };
  } catch (e) {
    return mensaje(e);
  }
}

export async function guardarRolAccion(_previo: EstadoForm, form: FormData): Promise<EstadoForm> {
  try {
    const sesion = await exigirAdministrador();
    const permisos = form.getAll("permisos").map(String);
    await guardarRol(entornoAuth, sesion.empresaId, {
      ...(texto(form, "rolId") ? { rolId: texto(form, "rolId") } : {}),
      codigo: texto(form, "codigo"),
      nombre: texto(form, "nombre"),
      permisos,
    });
    revalidatePath("/usuarios");
    return { exito: "Rol guardado." };
  } catch (e) {
    return mensaje(e);
  }
}
