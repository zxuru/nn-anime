# syntax=docker/dockerfile:1
#
# nn-anime como contenedor.
#
# Tres etapas y no dos: las dependencias de producción se instalan en una
# aparte para que la imagen final no lleve Vite, Playwright, Biome ni TypeScript.
# El servidor se ejecuta desde el código fuente con Bun —igual que `bun run
# start`—, así que la etapa de runtime necesita las fuentes de los paquetes y el
# `node_modules` de producción, nada más.
#
# La imagen **no incluye ningún proveedor**: el fixture del repositorio es una
# dependencia de desarrollo y no se copia. Los plugins se instalan desde Ajustes
# o se montan en `/data/config/nn-anime/providers/`.

ARG BUN_VERSION=1.4.3

# --- 1. La interfaz y las dependencias de desarrollo -------------------------
FROM oven/bun:${BUN_VERSION} AS build

WORKDIR /app

# Primero los manifiestos: mientras no cambien, la capa de `bun install` se
# reutiliza aunque cambie el código.
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
# `vite.config.ts` lee el aviso de seguridad del repositorio y lo emite como
# recurso de `dist`; sin él, `/SECURITY.md` no llega a la imagen.
COPY SECURITY.md ./

RUN bun install --frozen-lockfile
RUN bun run build

# --- 2. Sólo las dependencias de producción ---------------------------------
FROM oven/bun:${BUN_VERSION} AS runtime-deps

WORKDIR /app

COPY package.json bun.lock ./
COPY packages ./packages
RUN bun install --frozen-lockfile --production

# --- 3. Runtime mínimo -------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime

WORKDIR /app

LABEL org.opencontainers.image.title="nn-anime" \
      org.opencontainers.image.description="Interfaz y servidor de nn-anime para LAN/NAS" \
      org.opencontainers.image.source="https://github.com/zxuru/nn-anime" \
      org.opencontainers.image.licenses="MIT"

# El contenedor es un servidor: escucha en todas las interfaces, no abre
# navegador y guarda todo bajo `/data` con la convención XDG que ya usa la
# aplicación. Sin `HOME`, que en el contenedor puede no existir.
ENV NODE_ENV=production \
    NN_ANIME_HOST=0.0.0.0 \
    NN_ANIME_PORT=8080 \
    NN_ANIME_NO_OPEN=1 \
    XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json ./
# Cada paquete se copia **desde la etapa de dependencias**, no desde el
# contexto: Bun deja las dependencias de cada workspace en su propio
# `node_modules` (hono y zod viven en `packages/server/node_modules`), y copiar
# sólo el `node_modules` de la raíz dejaba al servidor sin ellas. El contexto no
# las tiene porque `.dockerignore` las excluye.
COPY --from=runtime-deps /app/packages/core ./packages/core
COPY --from=runtime-deps /app/packages/catalog-store ./packages/catalog-store
COPY --from=runtime-deps /app/packages/media-proxy ./packages/media-proxy
COPY --from=runtime-deps /app/packages/provider-sdk ./packages/provider-sdk
COPY --from=runtime-deps /app/packages/recsys ./packages/recsys
COPY --from=runtime-deps /app/packages/server ./packages/server
COPY --from=runtime-deps /app/packages/cli ./packages/cli
COPY packages/web/package.json ./packages/web/package.json
COPY --from=build /app/packages/web/dist ./packages/web/dist

# El usuario `bun` de la imagen oficial (uid 1000) es el dueño de `/data`. Se
# crea antes de `VOLUME` para que un volumen nombrado herede el dueño; un
# bind-mount tiene que traer los permisos puestos desde fuera.
RUN mkdir -p /data && chown -R bun:bun /data

VOLUME ["/data"]
EXPOSE 8080
STOPSIGNAL SIGTERM
USER bun

# La salud no pide credencial y no cuenta nada: sólo dice que el proceso
# responde. El puerto y el host salen del entorno para que cambiar
# `NN_ANIME_PORT` no deje el healthcheck mirando a otro sitio.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.NN_ANIME_PORT ?? '8080'; const raw = process.env.NN_ANIME_HOST; const host = !raw || raw === '0.0.0.0' || raw === '::' ? '127.0.0.1' : raw.includes(':') ? `[${raw}]` : raw; fetch(`http://${host}:${port}/healthz`).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["bun", "run", "packages/cli/src/index.ts"]
