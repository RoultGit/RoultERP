"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * Menú lateral.
 *
 * Cada entrada declara el permiso que la habilita, y la lista se filtra con los
 * permisos del usuario en la empresa activa. Ocultar lo que no puede usarse es
 * cortesía, no control de acceso: la comprobación de verdad está en el servidor
 * y en las políticas de la base.
 */
const SECCIONES = [
  {
    titulo: null,
    items: [{ href: "/tablero", texto: "Tablero", permiso: "sig:ver" }],
  },
  {
    titulo: "Abastecimiento",
    items: [
      { href: "/compras", texto: "Compras", permiso: "compras:ver" },
      { href: "/importaciones", texto: "Importaciones", permiso: "importaciones:ver" },
      { href: "/inventario", texto: "Inventario", permiso: "inventario:ver" },
      { href: "/cxp", texto: "Cuentas por pagar", permiso: "cxp:ver" },
    ],
  },
  {
    titulo: "Ingresos",
    items: [
      { href: "/ventas", texto: "Ventas", permiso: "ventas:ver" },
      { href: "/cpe", texto: "Facturación electrónica", permiso: "cpe:ver" },
      { href: "/cxc", texto: "Cuentas por cobrar", permiso: "cxc:ver" },
    ],
  },
  {
    titulo: "Finanzas",
    items: [
      { href: "/caja-bancos", texto: "Caja y bancos", permiso: "caja_bancos:ver" },
      { href: "/contabilidad", texto: "Contabilidad", permiso: "contabilidad:ver" },
    ],
  },
  {
    titulo: "Configuración",
    items: [
      { href: "/maestros", texto: "Maestros", permiso: "maestros:ver" },
      { href: "/usuarios", texto: "Usuarios y roles", permiso: "usuarios:ver" },
    ],
  },
] as const;

export function Navegacion({ permisos }: { permisos: string[] }) {
  const ruta = usePathname();
  const tiene = new Set(permisos);

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      {SECCIONES.map((seccion) => {
        const visibles = seccion.items.filter((i) => tiene.has(i.permiso));
        if (visibles.length === 0) return null;

        return (
          <div key={seccion.titulo ?? "inicio"} className="mb-3">
            {seccion.titulo && (
              <div
                className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--texto-suave)" }}
              >
                {seccion.titulo}
              </div>
            )}
            {visibles.map((item) => (
              <Link
                key={item.href}
                href={item.href as Route}
                className="enlace-nav"
                // Coincidencia por prefijo para que una subruta —el detalle de
                // una importación, por ejemplo— siga marcando su módulo.
                aria-current={
                  ruta === item.href || ruta.startsWith(`${item.href}/`) ? "page" : undefined
                }
              >
                {item.texto}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
