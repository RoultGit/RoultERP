# Imagen del ERP.
#
# Tres etapas y una sola razón: que la imagen final no lleve nada que no se
# ejecute. El compilador de TypeScript, las cabeceras de compilación y las
# dependencias de desarrollo pesan cientos de megabytes y son, además,
# superficie de ataque en una máquina que mira a internet.
#
# `node:22-alpine` porque el proyecto exige Node 22 y Alpine pesa la décima
# parte que la imagen completa de Debian.

# ── 1. Dependencias ───────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# Sólo los manifiestos: así esta capa se reaprovecha entre compilaciones
# mientras no cambien las dependencias, que es casi siempre.
COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/db/package.json        packages/db/
COPY packages/servicios/package.json packages/servicios/
COPY apps/web/package.json           apps/web/
RUN npm ci

# ── 2. Compilación ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Compila los tres paquetes y después la aplicación, en ese orden: la web
# importa los tipos que emiten los paquetes.
RUN npm run build

# El alta de empresas, empaquetada en un solo archivo.
#
# La salida autónoma de Next no deja los paquetes del monorepo resolubles desde
# fuera de ella, así que un script que haga `require("@roulterp/servicios")`
# dentro del contenedor no encuentra nada. Se empaqueta aparte —1.6 MB, con
# todo dentro salvo el driver de Postgres, que ya viaja en la imagen.
RUN npx esbuild scripts/alta-empresa.ts --bundle --platform=node --format=cjs \
      --target=node22 --external:postgres --outfile=alta-empresa.cjs

# ── 3. Ejecución ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# La zona horaria del contenedor. El código ya no depende de ella —pregunta
# siempre por América/Lima— pero deja los registros en hora local, que es la
# que va a leer quien investigue un problema.
ENV TZ=America/Lima
RUN apk add --no-cache tzdata

# No corre como root. Si alguien logra ejecutar algo dentro, que no sea dueño
# del sistema de archivos.
RUN addgroup -g 1001 erp && adduser -u 1001 -G erp -S erp

# La salida autónoma trae su propio servidor y sólo los módulos que usa.
COPY --from=build --chown=erp:erp /app/apps/web/.next/standalone ./
COPY --from=build --chown=erp:erp /app/apps/web/.next/static ./apps/web/.next/static
# El proyecto no tiene carpeta `public`: todo lo estático lo emite Next.

# Las migraciones y su ejecutor: el contenedor pone la base al día al arrancar.
COPY --from=build --chown=erp:erp /app/packages/db/dist        ./migraciones/dist
COPY --from=build --chown=erp:erp /app/packages/db/migrations  ./migraciones/migrations
COPY --from=build --chown=erp:erp /app/node_modules/postgres   ./node_modules/postgres
COPY --from=build --chown=erp:erp /app/alta-empresa.cjs ./alta-empresa.cjs
COPY --chown=erp:erp scripts/arrancar.mjs ./arrancar.mjs

USER erp
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "arrancar.mjs"]
