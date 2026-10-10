/**
 * Superficie pública de `@nn-anime/server`.
 */

import { AppError } from '@nn-anime/core'
import type { Hono } from 'hono'
import { type AppOptions, createApp, type ProviderSummary } from './app'
import { staticAssets } from './static-assets'

/** Dirección de escucha. Nunca `0.0.0.0`: el server es local por diseño. */
export const LOOPBACK = '127.0.0.1'

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
   * Build de la interfaz. Cuando se indica, el server sirve la interfaz y la API
   * en el mismo origen. Sin él —en desarrollo, donde la sirve Vite— sólo la API.
   */
  readonly webRoot?: string
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
 * Arranca la aplicación en `127.0.0.1`.
 *
 * El puerto se lee de forma diferida: con `port: 0` no se sabe cuál es hasta
 * que el sistema lo asigna, y los guards lo necesitan para validar `Host`. Una
 * función que lo consulta elimina la carrera que tendría resolverlo antes.
 */
export function startServer(options: StartOptions): RunningServer {
  const holder = { port: options.port }
  const app = createApp({ ...options, port: () => holder.port })

  // Los estáticos, los últimos y sólo aquí.
  const served = options.webRoot === undefined ? app : withStaticAssets(app, options.webRoot)

  const server = Bun.serve({
    port: options.port,
    hostname: LOOPBACK,
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
    url: `http://${LOOPBACK}:${bound}`,
    stop: async () => {
      await server.stop()
    },
  }
}

export { BOOT_PARAM } from './bootstrap'
export { isProtectedPath, PROTECTED_PREFIXES } from './paths'
export {
  createBootToken,
  createSession,
  SESSION_COOKIE,
  type Session,
  type SessionStore,
  safeEqual,
} from './session'
export { type AppOptions, createApp, type ProviderSummary }
