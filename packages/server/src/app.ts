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

import type { ConfigPaths } from '@nn-anime/core'
import { healthResponseSchema, type Logger } from '@nn-anime/core'
import type { FetchLike, Resolver } from '@nn-anime/media-proxy'
import type { LoadReport } from '@nn-anime/provider-sdk'
import { Hono } from 'hono'
import { type AniListCatalog, createAniListCatalog } from './anilist/catalog'
import { anilistOfflineFromEnv, createAniListClient } from './anilist/client'
import { bootstrapHandler } from './bootstrap'
import type { ServerContainer } from './container'
import { hostGuard } from './middleware/host-guard'
import { originGuard } from './middleware/origin-guard'
import { securityHeaders } from './middleware/security-headers'
import { sessionGuard } from './middleware/session-guard'
import { PROTECTED_PREFIXES } from './paths'
import { createProviderHub } from './provider-hub'
import { acotarAProveedoresActivos } from './provider-scope'
import { enabledProviderFiles } from './repo-store'
import { registerAniListRoutes } from './routes/anilist'
import { registerAnimeRoutes } from './routes/anime'
import { registerCoverRoute } from './routes/cover'
import { registerDetailRoutes } from './routes/detail'
import { registerFeedRoute, registerRecentRoute } from './routes/discovery'
import { registerEpisodesRoute } from './routes/episodes'
import { registerFavoritesRoutes } from './routes/favorites'
import { registerPlayRoutes } from './routes/play'
import { registerProviderReposRoutes } from './routes/provider-repos'
import { type PluginReport, registerProvidersRoute, summarizePlugins } from './routes/providers'
import { registerRecommendationsRoute, registerTrendingRoute } from './routes/recommendations'
import { registerProviderRoute } from './routes/register-provider'
import { registerSearchRoute } from './routes/search'
import { registerSettingsRoute } from './routes/settings'
import { registerStreamRoutes } from './routes/stream'
import { registerSubtitlesRoute } from './routes/subtitles'
import { registerWatchRoutes } from './routes/watch'
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
  /**
   * Directorio de plugins del usuario.
   *
   * Es lo que habilita `POST /api/providers`: sin directorio no hay dónde
   * escribir y la ruta no se registra. Las pruebas que no escriben plugins no lo
   * pasan, y eso hace que el alta no exista para ellas en lugar de existir a
   * medias.
   */
  readonly providersDir?: string
  /** Cargador de plugins. Inyectable: las pruebas no escriben en el disco real. */
  readonly loadPlugins?: (directory: string, files: readonly string[]) => Promise<LoadReport>
  /** Tiempo límite por proveedor en la búsqueda. Se acorta en los tests. */
  readonly searchTimeoutMs?: number
  /**
   * Contenedor con la caché. Sin él, cada búsqueda consulta a los proveedores:
   * es lo que usan las pruebas que no quieren montar una base.
   */
  readonly container?: ServerContainer
  /**
   * `fetch` del proxy de bytes. Se inyecta en los tests para no salir a la red;
   * en producción se usa el global.
   */
  readonly streamFetchImpl?: FetchLike
  /**
   * Resolutor del DNS para la lista blanca de destinos. Se inyecta en los tests
   * para no resolver nombres de verdad; en producción se usa el del sistema.
   */
  readonly streamResolver?: Resolver
  /** Rutas en uso, para la página de ajustes. Las calcula el arranque. */
  readonly paths?: ConfigPaths
  /** Versión de mpv detectada al arrancar, si la hay. */
  readonly mpvVersion?: string
  /**
   * La descarga de repositorios de GitHub.
   *
   * Tres inyecciones por el mismo motivo: las pruebas no salen a la red, no
   * resuelven nombres de verdad y no dependen del reloj real.
   */
  readonly githubFetchImpl?: FetchLike
  readonly githubResolver?: Resolver
  readonly githubClock?: () => number
  /**
   * El cliente de AniList.
   *
   * Misma tríada que GitHub —`fetch`, resolutor y reloj— porque es el mismo
   * problema: un tercero al que se sale con lista blanca, en pruebas sin red.
   */
  readonly anilistFetchImpl?: FetchLike
  readonly anilistResolver?: Resolver
  readonly anilistClock?: () => number
  /**
   * Sin salida a AniList, para el arnés de pruebas.
   *
   * Por defecto lo dice el entorno (`NN_ANIME_ANILIST_OFFLINE`), que es como lo
   * pone el e2e: la home siempre pide el descubrimiento, y una prueba que sale a
   * internet es una prueba que se rompe sola.
   */
  readonly anilistOffline?: boolean
  /**
   * Excepción de loopback para el proxy. La pone el arranque leyendo el entorno,
   * y **sólo** el e2e la pone. Ver `ALLOW_LOOPBACK_ENV`.
   */
  readonly allowLoopback?: boolean
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

  // El `Host` se comprueba en **todas** las rutas, incluido `/`: el canje de
  // arranque no es una excepción, y un guard que se salta una ruta deja de ser
  // un guard. No lee cookies ni estado, así que montarlo sobre `'*'` no cuesta
  // nada: sólo la comprobación.
  app.use('*', hostGuard(getPort))

  // El guard de sesión recibe el almacén de tickets: la URL del proxy es la
  // credencial que mpv sí puede presentar, porque no tiene cookie. Ver
  // `session-guard.ts`.
  const guards = [
    originGuard(getPort),
    sessionGuard(options.session, { tickets: options.container?.tickets }),
  ]
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

  // El registro es vivo: las rutas que vienen debajo reciben estas referencias y
  // las leen al atender, así que un alta desde Ajustes se ve sin reiniciar. Ver
  // `provider-hub.ts`.
  //
  // Los archivos de los repositorios instalados se piden en cada recarga, y de
  // ahí que el hub reciba una función: quién está habilitado lo sabe el store, y
  // el hub no tiene por qué saber de ajustes.
  const store = options.container?.store
  const dataDir = options.paths?.dataDir
  const hub = createProviderHub({
    ...(options.providersDir === undefined ? {} : { directory: options.providersDir }),
    ...(options.plugins === undefined ? {} : { initial: options.plugins }),
    ...(options.loadPlugins === undefined ? {} : { load: options.loadPlugins }),
    ...(store === undefined || dataDir === undefined
      ? {}
      : { extraFiles: () => enabledProviderFiles(store, dataDir) }),
  })
  const plugins: PluginReport = hub.report

  /**
   * El contenedor que ven las rutas: el mismo, con las lecturas locales acotadas
   * a los proveedores cargados.
   *
   * Sin esto, la base sigue teniendo las filas de un proveedor desmarcado en
   * Ajustes —desmarcar no borra— y la home ofrece una tarjeta que su ficha
   * contesta con 404. La regla y su motivo están en `provider-scope.ts`.
   */
  const container =
    options.container === undefined
      ? undefined
      : acotarAProveedoresActivos(options.container, hub.providers)

  app.get('/api/health', (c) =>
    c.json(
      healthResponseSchema.parse({
        version: options.version,
        port: getPort(),
        // Una sola fuente de verdad: el reproductor del contenedor. La opción
        // queda para una aplicación montada sin contenedor, y tener las dos sin
        // orden fue justo el fallo: el contenedor decía que había mpv y la salud
        // decía que no.
        mpv: options.container?.mpv.available ?? options.mpvAvailable ?? false,
        providers: summarizePlugins(plugins),
      }),
    ),
  )

  registerProvidersRoute(app, { plugins })
  if (options.providersDir !== undefined) {
    registerProviderRoute(app, { hub, directory: options.providersDir })
  }
  // Las rutas de metadatos necesitan el store: sin contenedor no se registran,
  // y una petición a ellas es un 404 explicable en vez de un 500 por dentro.
  //
  // El catálogo de AniList se declara aquí fuera porque la búsqueda —que sí se
  // registra sin contenedor— lo recibe cuando existe: es el mismo de la vitrina y
  // de la ficha, y la búsqueda cruzada es su tercera superficie.
  let catalogoAniList: AniListCatalog | undefined

  if (container !== undefined) {
    const routeOptions = {
      providers: hub.providers,
      container,
      ...(options.searchTimeoutMs === undefined ? {} : { timeoutMs: options.searchTimeoutMs }),
    }

    registerAnimeRoutes(app, routeOptions)
    registerDetailRoutes(app, routeOptions)
    registerEpisodesRoute(app, routeOptions)
    registerFavoritesRoutes(app, { container })
    const proxyOptions = {
      ...(options.streamFetchImpl === undefined ? {} : { fetchImpl: options.streamFetchImpl }),
      ...(options.streamResolver === undefined ? {} : { resolver: options.streamResolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    }

    registerCoverRoute(app, { container, ...proxyOptions })
    // Un solo catálogo para todas las rutas que hablan con AniList: dos instancias serían
    // dos cachés en memoria y dos mapas de «en vuelo» que no se ven entre sí. El feed y
    // las tendencias lo necesitan para saber qué pieza es para adultos.
    const catalog = createAniListCatalog({
      store: container.store,
      client: createAniListClient({
        offline: options.anilistOffline ?? anilistOfflineFromEnv(),
        ...(options.anilistFetchImpl === undefined ? {} : { fetchImpl: options.anilistFetchImpl }),
        ...(options.anilistResolver === undefined ? {} : { resolver: options.anilistResolver }),
        ...(options.anilistClock === undefined ? {} : { now: options.anilistClock }),
      }),
      ...(options.anilistClock === undefined ? {} : { now: options.anilistClock }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })

    // La búsqueda se registra más abajo, fuera de este bloque: recibe el catálogo
    // por aquí y sigue funcionando sin él cuando no hay contenedor.
    catalogoAniList = catalog

    registerAniListRoutes(app, {
      providers: hub.providers,
      container,
      catalog,
      // Las imágenes van con el `fetch` de AniList y no con el del proxy de
      // streams: son dos superficies distintas y una prueba que inyecta una no
      // tiene por qué estar sirviendo la otra.
      ...(options.anilistFetchImpl === undefined ? {} : { fetchImpl: options.anilistFetchImpl }),
      ...(options.anilistResolver === undefined ? {} : { resolver: options.anilistResolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })
    registerStreamRoutes(app, { ...routeOptions, ...proxyOptions })
    registerSubtitlesRoute(app, { container, ...proxyOptions })
    registerWatchRoutes(app, { container })
    registerRecommendationsRoute(app, { ...routeOptions, catalog })
    registerTrendingRoute(app, { ...routeOptions, catalog })
    registerFeedRoute(app, { ...routeOptions, catalog })
    // `recent` no necesita el catálogo —es una lectura de la base—, pero comparte el tipo
    // de opciones con el feed, que sí lo necesita para saber qué entrada es para adultos.
    registerRecentRoute(app, { ...routeOptions, catalog })
    registerSettingsRoute(app, {
      container,
      plugins,
      ...(options.paths === undefined ? {} : { paths: options.paths }),
      ...(options.mpvVersion === undefined ? {} : { mpvVersion: options.mpvVersion }),
    })
    registerPlayRoutes(app, routeOptions)
  }

  // Los repositorios necesitan las tres cosas: el store donde vive la ficha —
  // «qué está habilitado»—, la carpeta de datos donde vive el contenido y el hub
  // que recarga. Sin las tres, las rutas no se registran y una petición a ellas
  // es un 404 explicable en vez de un 500 por dentro.
  if (container !== undefined && options.paths !== undefined) {
    registerProviderReposRoutes(app, {
      container,
      hub,
      dataDir: options.paths.dataDir,
      ...(options.githubFetchImpl === undefined ? {} : { fetchImpl: options.githubFetchImpl }),
      ...(options.githubResolver === undefined ? {} : { resolver: options.githubResolver }),
      ...(options.githubClock === undefined ? {} : { now: options.githubClock }),
    })
  }

  registerSearchRoute(app, {
    providers: hub.providers,
    ...(options.searchTimeoutMs === undefined ? {} : { timeoutMs: options.searchTimeoutMs }),
    ...(container === undefined ? {} : { container }),
    ...(catalogoAniList === undefined ? {} : { catalog: catalogoAniList }),
  })

  return app
}
