"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * Menú lateral.
 *
 * Los grupos son **los módulos que la empresa contrató**, con los mismos
 * nombres con los que ella los llama. Antes eran cinco bloques temáticos
 * —«Abastecimiento», «Ingresos», «Finanzas»— y las cincuenta y seis entradas
 * salían todas a la vez: un muro en el que no se encuentra nada y que, encima,
 * no se parece a la lista por la que el cliente pagó.
 *
 * Y van plegados. Sólo se abre el módulo en el que uno está, que es el único
 * que interesa mientras se trabaja: quien está facturando no necesita ver las
 * diez pantallas de contabilidad. Se usa `<details>` del navegador en vez de
 * abrir y cerrar con JavaScript, así que funciona con el teclado, recuerda su
 * estado al navegar y no hay nada que pueda quedarse a medio hidratar.
 *
 * Cada entrada declara el permiso que la habilita, y la lista se filtra con los
 * permisos del usuario en la empresa activa. Ocultar lo que no puede usarse es
 * cortesía, no control de acceso: la comprobación de verdad está en el servidor
 * y en las políticas de la base.
 */
const SECCIONES = [
  {
    titulo: null,
    items: [
      { href: "/tablero", texto: "Tablero", permiso: "sig:ver" },
    ],
  },
  {
    titulo: "Compras",
    items: [
      { href: "/compras/requisiciones", texto: "Requisiciones", permiso: "compras:ver" },
      { href: "/compras/cotizaciones", texto: "Cotizaciones a proveedor", permiso: "compras:ver" },
      { href: "/compras", texto: "Compras", permiso: "compras:ver" },
      { href: "/compras/lote", texto: "Carga en serie", permiso: "compras:crear" },
      { href: "/compras/precios", texto: "Precios históricos", permiso: "compras:ver" },
    ],
  },
  {
    titulo: "Importaciones",
    items: [
      { href: "/importaciones", texto: "Importaciones", permiso: "importaciones:ver" },
      { href: "/importaciones/pendientes", texto: "En camino", permiso: "importaciones:ver" },
      { href: "/importaciones/polizas", texto: "Pólizas (DUA)", permiso: "importaciones:ver" },
      { href: "/importaciones/reportes", texto: "Reportes", permiso: "importaciones:ver" },
    ],
  },
  {
    titulo: "Inventario",
    items: [
      { href: "/inventario", texto: "Inventario", permiso: "inventario:ver" },
      { href: "/inventario/notas", texto: "Notas de almacén", permiso: "inventario:ver" },
      { href: "/inventario/kits", texto: "Kits y conversiones", permiso: "inventario:ver" },
      { href: "/inventario/lotes", texto: "Lotes y series", permiso: "inventario:ver" },
      { href: "/inventario/rotacion", texto: "Rotación y stock", permiso: "inventario:ver" },
    ],
  },
  {
    titulo: "Ventas",
    items: [
      { href: "/ventas/cotizaciones", texto: "Cotizaciones a cliente", permiso: "ventas:ver" },
      { href: "/ventas/pedidos", texto: "Pedidos de venta", permiso: "ventas:ver" },
      { href: "/ventas", texto: "Ventas", permiso: "ventas:ver" },
      { href: "/ventas/ranking", texto: "Ranking y margen", permiso: "ventas:ver" },
      { href: "/guias", texto: "Guías de remisión", permiso: "ventas:ver" },
    ],
  },
  {
    titulo: "Facturación electrónica",
    items: [
      { href: "/cpe", texto: "Facturación electrónica", permiso: "cpe:ver" },
      { href: "/cpe/resumenes", texto: "Resúmenes y bajas", permiso: "cpe:ver" },
      { href: "/cpe/retenciones", texto: "Retenciones y percepciones", permiso: "cpe:ver" },
    ],
  },
  {
    titulo: "Cuentas por cobrar",
    items: [
      { href: "/cxc", texto: "Cuentas por cobrar", permiso: "cxc:ver" },
      { href: "/cxc/estado-cuenta", texto: "Estado de cuenta de cliente", permiso: "cxc:ver" },
      { href: "/cxc/proyeccion", texto: "Proyección de cobranzas", permiso: "cxc:ver" },
      { href: "/cxc/morosidad", texto: "Antigüedad y morosidad", permiso: "cxc:ver" },
      { href: "/cxc/planillas", texto: "Planillas de cobranza", permiso: "cxc:ver" },
      { href: "/cxc/cheques", texto: "Cheques de clientes", permiso: "cxc:ver" },
    ],
  },
  {
    titulo: "Cuentas por pagar",
    items: [
      { href: "/cxp", texto: "Cuentas por pagar", permiso: "cxp:ver" },
      { href: "/cxp/ordenes-pago", texto: "Órdenes de pago", permiso: "cxp:ver" },
      { href: "/cxp/egresos", texto: "Programación de egresos", permiso: "cxp:ver" },
      { href: "/cxp/estado-cuenta", texto: "Estado de cuenta", permiso: "cxp:ver" },
    ],
  },
  {
    titulo: "Caja y bancos",
    items: [
      { href: "/caja-bancos", texto: "Caja y bancos", permiso: "caja_bancos:ver" },
      { href: "/caja-bancos/libro", texto: "Libro de bancos", permiso: "caja_bancos:ver" },
      { href: "/caja-bancos/recibos", texto: "Recibos de caja", permiso: "caja_bancos:ver" },
      { href: "/caja-bancos/cheques", texto: "Cheques", permiso: "caja_bancos:ver" },
      { href: "/caja-bancos/rendiciones", texto: "Entregas a rendir", permiso: "caja_bancos:ver" },
    ],
  },
  {
    titulo: "Contabilidad",
    items: [
      { href: "/contabilidad", texto: "Contabilidad", permiso: "contabilidad:ver" },
      { href: "/contabilidad/registros", texto: "Registros de compras y ventas", permiso: "contabilidad:ver" },
      { href: "/contabilidad/impuestos", texto: "Liquidación de impuestos", permiso: "contabilidad:ver" },
      { href: "/contabilidad/centros", texto: "Resultados por centro", permiso: "contabilidad:ver" },
      { href: "/contabilidad/formatos", texto: "Formatos de EEFF", permiso: "contabilidad:ver" },
      { href: "/contabilidad/presupuesto", texto: "Presupuesto", permiso: "contabilidad:ver" },
      { href: "/contabilidad/ratios", texto: "Ratios financieros", permiso: "contabilidad:ver" },
      { href: "/contabilidad/destino", texto: "Asiento de destino", permiso: "contabilidad:ver" },
      { href: "/contabilidad/parametros", texto: "Cuentas de integración", permiso: "contabilidad:ver" },
      { href: "/contabilidad/anexos", texto: "Cuenta corriente por anexo", permiso: "contabilidad:ver" },
    ],
  },
  {
    titulo: "Planillas y RR. HH.",
    items: [
      { href: "/planillas", texto: "Planillas", permiso: "planillas:ver" },
      { href: "/rrhh", texto: "Trabajadores", permiso: "planillas:ver" },
      { href: "/rrhh/contratos", texto: "Vencimiento de contratos", permiso: "planillas:ver" },
      { href: "/planillas/configuracion", texto: "Conceptos y parámetros", permiso: "planillas:ver" },
    ],
  },
  {
    titulo: "Configuración",
    items: [
      { href: "/maestros", texto: "Maestros", permiso: "maestros:ver" },
      { href: "/maestros/empresa", texto: "Datos de la empresa", permiso: "maestros:ver" },
      { href: "/maestros/apertura", texto: "Saldos de apertura", permiso: "maestros:ver" },
      { href: "/usuarios", texto: "Usuarios y roles", permiso: "usuarios:ver" },
    ],
  },
] as const;

/**
 * Entrada del menú que corresponde a la ruta actual.
 *
 * Gana la más específica. Con la coincidencia por prefijo a secas se encendían
 * dos a la vez —en `/cxp/egresos` se marcaban «Cuentas por pagar» y
 * «Programación de egresos»—, y el menú parecía no haber cambiado de módulo.
 *
 * El prefijo sigue haciendo falta para que el detalle de un documento marque su
 * módulo: estando en `/ventas/<id>` lo que toca encender es «Ventas».
 */
function entradaActiva(ruta: string, candidatos: readonly string[]): string | null {
  let mejor: string | null = null;
  for (const href of candidatos) {
    if (ruta !== href && !ruta.startsWith(`${href}/`)) continue;
    if (mejor === null || href.length > mejor.length) mejor = href;
  }
  return mejor;
}

/** Todas las rutas del menú, para poder elegir la más específica entre ellas. */
const RUTAS = SECCIONES.flatMap((s) => s.items.map((i) => i.href));

export function Navegacion({ permisos }: { permisos: string[] }) {
  const ruta = usePathname();
  const tiene = new Set(permisos);
  const activa = entradaActiva(ruta, RUTAS);

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      {SECCIONES.map((seccion) => {
        const visibles = seccion.items.filter((i) => tiene.has(i.permiso));
        if (visibles.length === 0) return null;

        const enlaces = visibles.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className="enlace-nav"
            aria-current={item.href === activa ? "page" : undefined}
          >
            {item.texto}
          </Link>
        ));

        // El tablero no es un módulo: va suelto arriba, sin nada que plegar.
        if (!seccion.titulo) return <div key="inicio" className="mb-2">{enlaces}</div>;

        // Abierto el módulo en el que se está. `key` incluye si está activo
        // para que React rehaga el `details` al cambiar de módulo: sin eso, el
        // navegador conserva el abierto/cerrado que tenía y el usuario aterriza
        // en una pantalla cuyo módulo sigue plegado.
        const aqui = visibles.some((i) => i.href === activa);
        return (
          <details
            key={`${seccion.titulo}:${aqui}`}
            open={aqui}
            className="mb-0.5"
          >
            <summary
              className="grupo-nav"
              aria-current={aqui ? "true" : undefined}
            >
              {seccion.titulo}
            </summary>
            <div className="pb-1">{enlaces}</div>
          </details>
        );
      })}
    </nav>
  );
}
