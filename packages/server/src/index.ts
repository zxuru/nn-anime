/**
 * Superficie pública de `@nn-anime/server`.
 */

import { AppError } from '@nn-anime/core'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { staticAssets } from './static-assets'

/** Dirección de escucha por defecto. El modo servidor puede pedir otra. */
export const LOOPBACK = '127.0.0.1'

/**
 * Tope de cuerpo de una petición: 256 KiB.
 *
 * El cuerpo válido más grande del proyecto es una descripción de proveedor, que
 * ronda los dos kilobytes. Todo lo que pase de aquí no es una petición que este
 * servidor sepa atender, así que se corta antes de leerlo.
 */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024

export interface RunningServer {
  /** Puerto real. Con `port: 0` es el que asignó el sistema. */
  readonly port: number
  readonly url: string
  stop(): Promise<void>
}

export interface StartOptions extends Omit<AppOptions, 'port'> {
  /** `0` deja que el sistema elija un puerto libre. */
  readonly port: number
  /**
   * Interfaz de escucha. Por defecto `127.0.0.1`, que es el modo local; el
   * contenedor usa `0.0.0.0` a propósito.
   */
  readonly host?: string
  /**
   * Build de la interfaz. Cuando se indica, el server sirve la interfaz y la API
   * en el mismo origen. Sin él —en desarrollo, donde la sirve Vite— sólo la API.
   */
  readonly webRoot?: string
}

/**
 * El host que se puede escribir en una URL.
 *
 * `0.0.0.0` y `::` no son direcciones a las que se pueda ir; la línea que lee
 * una persona enseña el loopback, que es el que funciona dentro del contenedor
 * y con el que se comprueba la salud. Un IPv6 se escribe entre corchetes.
 */
function hostInUrl(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return LOOPBACK

  const value = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  return value.includes(':') ? `[${value}]` : value
}

/**
 * Añade el servido de la interfaz a una aplicación ya compuesta.
 *
 * Va aparte y se llama **después** de registrar todas las rutas: el middleware
 * devuelve el `index.html` a lo que no encuentre, así que cualquier ruta
 * registrada después sería inalcanzable. Éste es el único punto donde se monta,
 * y por eso T22 puede montar su contenedor de rutas antes sin sorpresas.
 */
export function withStaticAssets(app: Hono, root: string): Hono {
  app.use('*', staticAssets({ root }))

  return app
}

/**
 * Arranca la aplicación en la interfaz indicada (`127.0.0.1` por defecto).
 *
 * El puerto se lee de forma diferida: con `port: 0` no se sabe cuál es hasta
 * que el sistema lo asigna, y los guards lo necesitan para validar `Host`. Una
 * función que lo consulta elimina la carrera que tendría resolverlo antes.
 */
export function startServer(options: StartOptions): RunningServer {
  const holder = { port: options.port }
  const host = options.host ?? LOOPBACK
  const app = createApp({ ...options, port: () => holder.port })

  // Los estáticos, los últimos y sólo aquí.
  const served = options.webRoot === undefined ? app : withStaticAssets(app, options.webRoot)

  const server = Bun.serve({
    port: options.port,
    hostname: host,
    // El cuerpo más grande que este servidor acepta es la descripción de un
    // proveedor, y eso son dos kilobytes. Sin este tope, Bun admite 128 MiB y
    // `c.req.json()` los acumula en memoria antes de validar nada: cada ruta que
    // lee cuerpo es una vía para pedir cientos de megabytes.
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: served.fetch,
  })

  const bound = server.port
  if (bound === undefined) {
    throw new AppError({
      code: 'internal',
      message: 'el servidor arrancó pero no informó el puerto',
      scope: 'server',
      op: 'startServer',
    })
  }
  holder.port = bound

  return {
    port: bound,
    url: `http://${hostInUrl(host)}:${bound}`,
    stop: async () => {
      await server.stop()
    },
  }
}

export {
  type AppOptions,
  createApp,
  type NetworkPolicy,
  type ProviderSummary,
} from './app'
export { BOOT_PARAM, safeRedirect } from './bootstrap'
export { type CacheOutcome, type CacheSource, readThrough, summarizeSources } from './cache-read'
export {
  type ContainerOptions,
  createContainer,
  type ServerContainer,
  searchKey,
} from './container'
export { isProtectedPath, PROTECTED_PREFIXES } from './paths'
export {
  candidatesOf,
  enabledProviderFiles,
  listRepoRecords,
  MAX_PROVIDER_REPOS,
  PROVIDER_REPOS_KEY,
  repoDirOf,
  reposRoot,
  saveRepoRecords,
  stampOf,
} from './repo-store'
export { registerAnimeRoutes, statusFor } from './routes/anime'
export { registerEpisodesRoute, statusForEpisodes } from './routes/episodes'
export { registerFavoritesRoutes } from './routes/favorites'
export { type PluginReport, summarizePlugins } from './routes/providers'
export {
  createBootToken,
  createSession,
  createTokenSession,
  SESSION_COOKIE,
  type Session,
  type SessionStore,
  safeEqual,
} from './session'
