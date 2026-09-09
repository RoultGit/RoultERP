import type { NextConfig } from "next";

const config: NextConfig = {
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
