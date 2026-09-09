import { join } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Hay un package-lock.json en el directorio personal del usuario y Next lo
  // toma por la raíz del proyecto. Se le indica cuál es de verdad.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // Los paquetes del monorepo se compilan desde su código fuente TypeScript.
  transpilePackages: ["@roulterp/core", "@roulterp/db", "@roulterp/servicios"],
  reactStrictMode: true,
  // El encabezado que anuncia el framework sólo le sirve a quien busca
  // vulnerabilidades conocidas de esa versión.
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  typedRoutes: true,
};

export default config;
