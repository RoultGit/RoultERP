import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/*
 * Geist para todo, Geist Mono para las cifras.
 *
 * Se cargan con `next/font`, que las descarga en tiempo de compilación y las
 * sirve desde el propio dominio. No es una preferencia: una hoja de estilos
 * traída de Google en cada visita añade una petición a un tercero y provoca el
 * salto de maquetación al cambiar la fuente de reserva por la real, que en una
 * tabla de cien filas se ve como un temblor.
 */
const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--fuente-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--fuente-mono",
  display: "swap",
});

/* Las dos del logotipo, y sólo del logotipo. No se usan en ningún otro sitio. */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--fuente-marca",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["900"],
  style: ["italic"],
  variable: "--fuente-marca-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RoultERP",
  description: "Sistema de gestión empresarial",
};

/*
 * El tema se fija antes de pintar.
 *
 * El claro es el modo principal y **no se hereda del sistema operativo**: quien
 * tiene el portátil en oscuro no quiere necesariamente su ERP en oscuro, y
 * heredarlo sin preguntar es lo que hacía que la aplicación se viera azul
 * marino sin que nadie lo hubiera pedido. El oscuro existe entero, pero sólo si
 * se elige.
 *
 * El script va en el `head` y es síncrono a propósito: si la preferencia se
 * aplicara desde React, la primera pintura saldría en claro y al hidratar
 * cambiaría de golpe. Eso es el parpadeo blanco que se ve al recargar.
 *
 * Todo dentro de `try`: en una ventana privada `localStorage` lanza al leerlo, y
 * un error ahí dejaría la página en blanco antes de renderizar nada.
 *
 * **Lleva el nonce de la CSP.** La política de `middleware.ts` no admite
 * `unsafe-inline`, así que sin el nonce el navegador se niega a ejecutarlo —en
 * silencio, salvo un aviso en la consola— y el tema se queda siempre en claro
 * aunque la preferencia esté guardada. Fue exactamente lo que pasó.
 */
const FIJAR_TEMA = `try{document.documentElement.dataset.tema=localStorage.getItem("roulterp-tema")==="oscuro"?"oscuro":"claro"}catch(e){document.documentElement.dataset.tema="claro"}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="es-PE"
      data-tema="claro"
      className={`${geist.variable} ${geistMono.variable} ${bricolage.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: FIJAR_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
