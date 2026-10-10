/**
 * Composición de la aplicación HTTP.
 *
 * Los guards se montan aquí, en un solo sitio, sobre `/api/*` y `/stream/*`. El
 * test de tabla de rutas recorre lo que quede registrado y falla si alguna ruta
 * protegida no pasa por ellos, así que añadir una ruta nueva sin protección
 * rompe el build en lugar de pasar desapercibido.
 */

import type { Logger } from '@nn-anime/core'
import { Hono } from 'hono'
import { bootstrapHandler } from './bootstrap'
import { hostGuard } from './middleware/host-guard'
import { originGuard } from './middleware/origin-guard'
import { securityHeaders } from './middleware/security-headers'
import { sessionGuard } from './middleware/session-guard'
import type { Session } from './session'

/** Puerto conocido en el momento de montar la aplicación, o función que lo lee. */
export type PortSource = number | (() => number)

export interface ProviderSummary {
  readonly id: string
  readonly name: string
  readonly sub: boolean
  readonly dub: boolean
  readonly status: 'active' | 'rejected'
  /** Motivo del rechazo, cuando el plugin no cargó. */
  readonly reason?: string
}

export interface AppOptions {
  readonly port: PortSource
  readonly session: Session
  /** Token de un solo uso que el CLI pone en la URL de arranque. */
  readonly bootToken: string
  readonly version: string
  readonly providers?: readonly ProviderSummary[]
  readonly mpvAvailable?: boolean
  readonly logger?: Logger
}

/** Rutas que exigen sesión. Todo lo que cuelga de aquí pasa por los tres guards. */
export const PROTECTED_PREFIXES: readonly string[] = ['/api/', '/stream/']

function resolvePort(source: PortSource): number {
  return typeof source === 'number' ? source : source()
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono()
  const getPort = (): number => resolvePort(options.port)

  // Primero las cabeceras: se escriben después de `next()`, así que llegan
  // también a las respuestas que cortan los guards.
  app.use('*', securityHeaders())

  const guards = [hostGuard(getPort), originGuard(getPort), sessionGuard(options.session)]
  for (const prefix of PROTECTED_PREFIXES) {
    app.use(`${prefix}*`, ...guards)
  }

  app.use('/', bootstrapHandler({ bootToken: options.bootToken, session: options.session }))

  app.get('/api/health', (c) =>
    c.json({
      version: options.version,
      port: getPort(),
      mpv: options.mpvAvailable ?? false,
      providers: options.providers ?? [],
    }),
  )

  return app
}
