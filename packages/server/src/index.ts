/**
 * Superficie pública de `@nn-anime/server`.
 */

import { AppError } from '@nn-anime/core'
import { type AppOptions, createApp, PROTECTED_PREFIXES, type ProviderSummary } from './app'

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

  const server = Bun.serve({
    port: options.port,
    hostname: LOOPBACK,
    fetch: app.fetch,
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

export {
  createBootToken,
  createSession,
  SESSION_COOKIE,
  type Session,
  type SessionStore,
  safeEqual,
} from './session'
export { type AppOptions, createApp, PROTECTED_PREFIXES, type ProviderSummary }
