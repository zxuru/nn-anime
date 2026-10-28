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

import { mkdir, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError, type ConfigPaths, healthResponseSchema, type Logger } from '@nn-anime/core'
import type { FetchLike, Resolver } from '@nn-anime/media-proxy'
import type { LoadReport } from '@nn-anime/provider-sdk'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AniListCatalog, createAniListCatalog } from './anilist/catalog'
import { anilistOfflineFromEnv, createAniListClient } from './anilist/client'
import { registerLogin } from './auth'
import { bootstrapHandler } from './bootstrap'
import type { ServerContainer } from './container'
import { createDownloadQueue } from './downloads/queue'
import { hostGuard } from './middleware/host-guard'
import { originGuard } from './middleware/origin-guard'
import { securityHeaders } from './middleware/security-headers'
import { sessionGuard } from './middleware/session-guard'
import { tokenGuard } from './middleware/token-guard'
import { PROTECTED_PREFIXES } from './paths'
import { createProviderHub } from './provider-hub'
import { acotarAProveedoresActivos } from './provider-scope'
import { enabledProviderFiles } from './repo-store'
import { registerAniListRoutes } from './routes/anilist'
import { findProvider, registerAnimeRoutes } from './routes/anime'
import { registerCoverRoute } from './routes/cover'
import { registerDetailRoutes } from './routes/detail'
import { registerFeedRoute, registerRecentRoute } from './routes/discovery'
import { registerDownloadsRoute } from './routes/downloads'
import { registerEpisodesRoute } from './routes/episodes'
import { registerFavoritesRoutes } from './routes/favorites'
import { registerPlanToWatchRoutes } from './routes/plan-to-watch'
import { registerPlayRoutes } from './routes/play'
import { registerProfileRoutes } from './routes/profile'
import { registerProviderReposRoutes } from './routes/provider-repos'
import { type PluginReport, registerProvidersRoute, summarizePlugins } from './routes/providers'
import { registerRecommendationsRoute, registerTrendingRoute } from './routes/recommendations'
import { registerProviderRoute } from './routes/register-provider'
import { registerSearchRoute } from './routes/search'
import { registerSettingsRoute } from './routes/settings'
import { registerStreamRoutes } from './routes/stream'
import { registerSubtitlesRoute } from './routes/subtitles'
import { registerTmdbRoute } from './routes/tmdb'
import { registerWatchRoutes } from './routes/watch'
import { registerWatchedTitlesRoutes } from './routes/watched-titles'
import { createTokenSession, type Session } from './session'
import type { TmdbFetch } from './tmdb/client'

/** Puerto conocido en el momento de montar la aplicación, o función que lo lee. */
export type PortSource = number | (() => number)

/**
 * Lo que el modo servidor añade al guard de `Host` y al de `Origin`.
 *
 * Lo calcula el arranque a partir de `NN_ANIME_HOST` y `NN_ANIME_PUBLIC_ORIGIN`;
 * el servidor no lee variables de entorno para decidir a quién acepta.
 */
export interface NetworkPolicy {
  readonly extraHosts: readonly string[]
  readonly allowAnyHost: boolean
  readonly extraOrigins: readonly string[]
  readonly sameOrigin: boolean
}

/** Reexportado para no obligar a nadie a saber de qué archivo sale. */
export type { ProviderSummary } from '@nn-anime/core'

export interface AppOptions {
  readonly port: PortSource
  /**
   * La sesión local. En modo token se ignora: la construye `auth` a partir del
   * token fijo, para que no pueda haber dos valores distintos.
   */
  readonly session?: Session
  /**
   * Modo servidor: token fijo en lugar del canje de un solo uso.
   *
   * Sin `auth`, el comportamiento es el de siempre.
   */
  readonly auth?: { readonly token: string; readonly secureCookie: boolean }
  /** Hosts y orígenes extra del modo servidor. */
  readonly network?: NetworkPolicy
  /** Modo restringido: no se pueden añadir ni activar plugins desde la API. */
  readonly locked?: boolean
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
  /**
   * Dónde se guardan las descargas. Por defecto, `<dataDir>/downloads`.
   *
   * Sin este dato y sin `paths` no se montan las rutas de descargas: una app que
   * no sabe dónde escribir no debe ofrecer un botón que va a fallar.
   */
  readonly downloadsDir?: string
  /** `fetch` del motor de descargas; en pruebas, sin red. */
  readonly downloadFetchImpl?: FetchLike
  /** Cuántas descargas a la vez. Dos por defecto. */
  readonly downloadConcurrency?: number
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
   * El cliente de TMDB.
   *
   * Sólo `fetch` y reloj: la dirección se compone con una base constante y no hay
   * ninguna URL del usuario que resolver, así que no hay resolutor que inyectar.
   */
  readonly tmdbFetchImpl?: TmdbFetch
  readonly tmdbClock?: () => number
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

  // En modo token la sesión sale del token fijo, no de una cookie efímera: que
  // haya un solo valor posible evita que el guard y el formulario de login
  // miren cosas distintas.
  const session =
    options.auth === undefined ? options.session : createTokenSession(options.auth.token)

  if (session === undefined) {
    throw new AppError({
      code: 'internal',
      message: 'createApp necesita una sesión o un token',
      scope: 'server',
      op: 'createApp',
    })
  }

  // Primero las cabeceras: se escriben después de `next()`, así que llegan
  // también a las respuestas que cortan los guards.
  app.use('*', securityHeaders())

  // El `Host` se comprueba en **todas** las rutas, incluido `/`: el canje de
  // arranque no es una excepción, y un guard que se salta una ruta deja de ser
  // un guard. No lee cookies ni estado, así que montarlo sobre `'*'` no cuesta
  // nada: sólo la comprobación.
  app.use(
    '*',
    hostGuard(getPort, {
      ...(options.network === undefined ? {} : { extraHosts: options.network.extraHosts }),
      ...(options.network === undefined ? {} : { allowAny: options.network.allowAnyHost }),
    }),
  )

  // La salud no lleva credencial y no lleva datos: es lo que un contenedor
  // necesita para saber si el proceso responde. Va fuera de `/api/` para no
  // heredar el guard de sesión, y el guard de token la salta por nombre.
  app.get('/healthz', (c) => {
    c.header('cache-control', 'no-store')

    return c.json({ status: 'ok' })
  })

  // El modo servidor protege **todo**, estáticos incluidos; el modo local sigue
  // protegiendo sólo la API y el stream. Ver `token-guard.ts`.
  if (options.auth !== undefined) {
    app.use(
      '*',
      tokenGuard(session, {
        ...(options.container === undefined ? {} : { tickets: options.container.tickets }),
      }),
    )
    registerLogin(app, { session, secureCookie: options.auth.secureCookie })
  }

  // El guard de sesión recibe el almacén de tickets: la URL del proxy es la
  // credencial que mpv sí puede presentar, porque no tiene cookie. Ver
  // `session-guard.ts`.
  const guards = [
    originGuard(getPort, {
      ...(options.network === undefined ? {} : { extraOrigins: options.network.extraOrigins }),
      ...(options.network === undefined ? {} : { sameOrigin: options.network.sameOrigin }),
    }),
    sessionGuard(session, { tickets: options.container?.tickets }),
  ]
  for (const prefix of PROTECTED_PREFIXES) {
    app.use(`${prefix}*`, ...guards)
  }

  // El canje de un solo uso es del modo local. En modo token el token no viaja
  // en la URL: `/` lo sirve la interfaz y el guard de token ya pidió la cookie.
  if (options.auth === undefined) {
    app.use(
      '/',
      bootstrapHandler({
        bootToken: options.bootToken,
        session,
        ...(options.redirectTo === undefined ? {} : { redirectTo: options.redirectTo }),
        ...(options.bootstrapClock === undefined ? {} : { now: options.bootstrapClock }),
      }),
    )
  }

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
  // En modo restringido el alta de un plugin declarativo no existe: escribir un
  // archivo en el directorio de configuración es una superficie de ejecución de
  // código, y el servidor no la ofrece.
  if (!options.locked && options.providersDir !== undefined) {
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
    registerTmdbRoute(app, {
      providers: hub.providers,
      container,
      ...(options.tmdbFetchImpl === undefined ? {} : { fetchImpl: options.tmdbFetchImpl }),
      ...(options.tmdbClock === undefined ? {} : { now: options.tmdbClock }),
    })

    const downloadsRoot =
      options.downloadsDir ??
      (options.paths === undefined ? undefined : join(options.paths.dataDir, 'downloads'))

    if (downloadsRoot !== undefined) {
      const queue = createDownloadQueue({
        store: {
          get: (id) => container.store.getDownload(id),
          list: (limit) => container.store.listDownloads(limit),
          update: (id, patch) => container.store.updateDownload(id, patch),
          remove: (id) => container.store.removeDownload(id),
          requeueInterrupted: () => container.store.requeueInterruptedDownloads(),
        },
        root: downloadsRoot,
        resolve: async (providerId, episodeRef, signal) => {
          const provider = findProvider(hub.providers, providerId)
          if (provider === undefined) return undefined

          const resultado = await container.resolveStream(
            provider,
            { episodeRef: { providerId, value: episodeRef }, mode: 'sub' },
            { signal, timeoutMs: 15_000 },
          )
          if (!resultado.ok) return undefined

          const primera = resultado.value.value[0]
          if (primera === undefined) return undefined

          return {
            url: primera.url,
            kind: primera.kind,
            ...(primera.headers === undefined ? {} : { headers: primera.headers }),
          }
        },
        ...(options.downloadFetchImpl === undefined
          ? {}
          : { fetchImpl: options.downloadFetchImpl }),
        ...(options.downloadConcurrency === undefined
          ? {}
          : { concurrency: options.downloadConcurrency }),
        freeBytes: async () => {
          // La carpeta puede no existir todavía: el espacio se mide en el disco
          // que la va a contener, no en una ruta que aún no está.
          const raiz = queue.root()
          await mkdir(raiz, { recursive: true })
          const espacio = await statfs(raiz)
          return espacio.bavail * espacio.bsize
        },
      })

      // La carpeta guardada se aplica antes de arrancar. Si no hay ninguna, se
      // queda la del arranque; el escritorio la cambia con `PATCH /dir`.
      void (async () => {
        try {
          const guardada = await container.store.getSetting(
            'downloadsDir',
            z.string(),
            downloadsRoot,
          )
          if (guardada !== downloadsRoot) queue.setRoot(guardada)
        } catch {
          // Una carpeta guardada ilegible no impide arrancar: se usa la de siempre.
        }
        await queue.start()
      })().catch(() => undefined)

      registerDownloadsRoute(app, {
        queue,
        store: container.store,
        providers: hub.providers,
        root: downloadsRoot,
      })
    }
    registerDetailRoutes(app, routeOptions)
    registerEpisodesRoute(app, routeOptions)
    registerFavoritesRoutes(app, { container })
    registerWatchedTitlesRoutes(app, { container })
    registerPlanToWatchRoutes(app, { container })
    // El Perfil y el Historial van con las rutas del usuario: son sus listas y su
    // visionado, leídos de la base. No piden nada a un proveedor.
    registerProfileRoutes(app, { container })
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
      locked: options.locked ?? false,
      ...(options.paths === undefined ? {} : { paths: options.paths }),
      ...(options.mpvVersion === undefined ? {} : { mpvVersion: options.mpvVersion }),
    })
    // Lanzar un reproductor en el servidor no es una operación de un modo
    // restringido: cualquier cliente con el token podría hacerlo, y no hay
    // pantalla ni altavoz que lo justifique.
    if (!options.locked) registerPlayRoutes(app, routeOptions)
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
      locked: options.locked ?? false,
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
