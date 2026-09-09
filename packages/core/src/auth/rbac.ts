/**
 * Control de acceso por rol, con alcance de empresa.
 *
 * Un permiso es `modulo:accion`. La comprobación es siempre contra una empresa
 * concreta: pertenecer a una empresa no dice nada sobre las demás, y un usuario
 * puede ser contador en una y sólo lector en otra.
 *
 * Esto es la segunda barrera, no la primera. La primera es RLS en Postgres, que
 * corta el acceso a filas de otra empresa aunque este módulo se equivoque.
 */

export const MODULOS = [
  "empresas",
  "usuarios",
  "maestros",
  "compras",
  "importaciones",
  "inventario",
  "ventas",
  "cxc",
  "cxp",
  "caja_bancos",
  "contabilidad",
  "cpe",
  "sig",
] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACCIONES = ["ver", "crear", "editar", "anular", "aprobar"] as const;
export type Accion = (typeof ACCIONES)[number];

export type Permiso = `${Modulo}:${Accion}`;

export const permiso = (m: Modulo, a: Accion): Permiso => `${m}:${a}`;

/** Todos los permisos de un módulo, para armar roles sin enumerar a mano. */
export const todosDe = (m: Modulo): Permiso[] => ACCIONES.map((a) => permiso(m, a));

/**
 * Roles predefinidos con los que arranca cada empresa nueva. Son un punto de
 * partida editable, no una jaula: el administrador puede crear roles propios.
 */
export const ROLES_BASE: Record<string, { nombre: string; permisos: Permiso[] }> = {
  admin: {
    nombre: "Administrador",
    permisos: MODULOS.flatMap(todosDe),
  },
  contador: {
    nombre: "Contador",
    permisos: [
      ...todosDe("contabilidad"),
      ...todosDe("cxc"),
      ...todosDe("cxp"),
      ...todosDe("caja_bancos"),
      ...todosDe("cpe"),
      permiso("maestros", "ver"),
      permiso("compras", "ver"),
      permiso("ventas", "ver"),
      permiso("inventario", "ver"),
      permiso("importaciones", "ver"),
      permiso("sig", "ver"),
    ],
  },
  logistica: {
    nombre: "Logística",
    permisos: [
      ...todosDe("compras"),
      ...todosDe("importaciones"),
      ...todosDe("inventario"),
      permiso("maestros", "ver"),
      permiso("maestros", "crear"),
      permiso("cxp", "ver"),
      permiso("sig", "ver"),
    ],
  },
  ventas: {
    nombre: "Ventas",
    permisos: [
      ...todosDe("ventas"),
      permiso("cpe", "ver"),
      permiso("cpe", "crear"),
      permiso("cxc", "ver"),
      permiso("inventario", "ver"),
      permiso("maestros", "ver"),
      permiso("maestros", "crear"),
      permiso("sig", "ver"),
    ],
  },
  consulta: {
    nombre: "Solo consulta",
    permisos: MODULOS.map((m) => permiso(m, "ver")),
  },
};

export type Membresia = {
  empresaId: string;
  permisos: ReadonlySet<Permiso>;
  activo: boolean;
};

export type Actor = {
  usuarioId: string;
  /** Membresías indexadas por empresa. Un usuario sin membresías no ve nada. */
  membresias: ReadonlyMap<string, Membresia>;
};

export function puede(actor: Actor, empresaId: string, p: Permiso): boolean {
  const m = actor.membresias.get(empresaId);
  if (!m || !m.activo) return false;
  return m.permisos.has(p);
}

export class SinPermiso extends Error {
  constructor(
    readonly empresaId: string,
    readonly permisoRequerido: Permiso,
  ) {
    // El mensaje no revela si la empresa existe: para quien no tiene acceso,
    // «no autorizado» y «no existe» deben ser indistinguibles.
    super(`no autorizado: ${permisoRequerido}`);
    this.name = "SinPermiso";
  }
}

export function exigir(actor: Actor, empresaId: string, p: Permiso): void {
  if (!puede(actor, empresaId, p)) throw new SinPermiso(empresaId, p);
}

/** Empresas a las que el actor puede entrar, para el selector de empresa. */
export const empresasVisibles = (actor: Actor): string[] =>
  [...actor.membresias.values()].filter((m) => m.activo).map((m) => m.empresaId);

export function construirActor(
  usuarioId: string,
  filas: readonly { empresaId: string; permisos: readonly string[]; activo: boolean }[],
): Actor {
  const membresias = new Map<string, Membresia>();
  for (const f of filas) {
    membresias.set(f.empresaId, {
      empresaId: f.empresaId,
      permisos: new Set(f.permisos as Permiso[]),
      activo: f.activo,
    });
  }
  return { usuarioId, membresias };
}
