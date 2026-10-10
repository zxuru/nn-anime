/**
 * Composición de la aplicación HTTP.
 *
 * Los guards se montan aquí, en un solo sitio, sobre `/api/*` y `/stream/*`. El
 * test de tabla de rutas recorre lo que quede registrado y falla si alguna ruta
 * protegida no pasa por ellos, así que añadir una ruta nueva sin protección
 * rompe el build en lugar de pasar desapercibido.
 *
 * **Aquí no se monta el servido de estáticos.** Es a propósito: ese middleware
 * devuelve el `index.html` a cualquier ruta que no encuentre archivo, así que
 * montarlo dentro deja inalcanzable toda ruta registrada después. Se monta en
 * `withStaticAssets`, en la composición final, cuando ya están todas las rutas.
 * La versión anterior lo montaba al final de esta función y sólo movía la
 * frontera del problema: una ruta añadida después de `createApp` seguía siendo
 * inalcanzable.
 */

import { healthResponseSchema, type Logger } from '@nn-anime/core'
import { Hono } from 'hono'
import { bootstrapHandler } from './bootstrap'
import type { ServerContainer } from './container'
import { hostGuard } from './middleware/host-guard'
import { originGuard } from './middleware/origin-guard'
import { securityHeaders } from './middleware/security-headers'
import { sessionGuard } from './middleware/session-guard'
import { PROTECTED_PREFIXES } from './paths'
import { registerAnimeRoutes } from './routes/anime'
import { registerEpisodesRoute } from './routes/episodes'
import { type PluginReport, registerProvidersRoute, summarizePlugins } from './routes/providers'
import { registerSearchRoute } from './routes/search'
import type { Session } from './session'

/** Puerto conocido en el momento de montar la aplicación, o función que lo lee. */
export type PortSource = number | (() => number)

/** Reexportado para no obligar a nadie a saber de qué archivo sale. */
export type { ProviderSummary } from '@nn-anime/core'

export interface AppOptions {
  readonly port: PortSource
  readonly session: Session
  /** Token de un solo uso que el CLI pone en la URL de arranque. */
  readonly bootToken: string
  /** Ruta local a la que ir tras canjear el token. Por defecto, `/`. */
  readonly redirectTo?: string
  readonly version: string
  /**
   * Lo que el loader encontró: los plugins activos y los rechazados con motivo.
   *
   * Es una sola cosa porque es una sola pregunta. Con dos campos —uno de activos
   * para buscar y otro de resúmenes para mostrar— la interfaz podría enseñar un
   * proveedor que la búsqueda no consulta.
   */
  readonly plugins?: PluginReport
  /** Tiempo límite por proveedor en la búsqueda. Se acorta en los tests. */
  readonly searchTimeoutMs?: number
  /**
   * Contenedor con la caché. Sin él, cada búsqueda consulta a los proveedores:
   * es lo que usan las pruebas que no quieren montar una base.
   */
  readonly container?: ServerContainer
  readonly mpvAvailable?: boolean
  readonly logger?: Logger
  /** Reloj del canje de arranque, inyectable para testear la caducidad. */
  readonly bootstrapClock?: () => number
}

/** Rutas que exigen sesión. Todo lo que cuelga de aquí pasa por los tres guards. */

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

  app.use(
    '/',
    bootstrapHandler({
      bootToken: options.bootToken,
      session: options.session,
      ...(options.redirectTo === undefined ? {} : { redirectTo: options.redirectTo }),
      ...(options.bootstrapClock === undefined ? {} : { now: options.bootstrapClock }),
    }),
  )

  const plugins: PluginReport = options.plugins ?? { active: [], rejected: [] }

  app.get('/api/health', (c) =>
    c.json(
      healthResponseSchema.parse({
        version: options.version,
        port: getPort(),
        mpv: options.mpvAvailable ?? false,
        providers: summarizePlugins(plugins),
      }),
    ),
  )

  registerProvidersRoute(app, { plugins })
  // Las rutas de metadatos necesitan el store: sin contenedor no se registran,
  // y una petición a ellas es un 404 explicable en vez de un 500 por dentro.
  if (options.container !== undefined) {
    const routeOptions = {
      providers: plugins.active.map((entry) => entry.provider),
      container: options.container,
      ...(options.searchTimeoutMs === undefined ? {} : { timeoutMs: options.searchTimeoutMs }),
    }

    registerAnimeRoutes(app, routeOptions)
    registerEpisodesRoute(app, routeOptions)
  }

  registerSearchRoute(app, {
    providers: plugins.active.map((entry) => entry.provider),
    ...(options.searchTimeoutMs === undefined ? {} : { timeoutMs: options.searchTimeoutMs }),
    ...(options.container === undefined ? {} : { container: options.container }),
  })

  return app
}
