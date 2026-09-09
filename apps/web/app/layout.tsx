import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoultERP",
  description: "Sistema de gestión empresarial",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE">
      <body>{children}</body>
    </html>
  );
}
