/**
 * Contenedor del server: composición de las dependencias que antes se pasaban
 * sueltas.
 *
 * Aquí se juntan la base, la fachada del store, la cola de escritura y la cola
 * de revalidación, y se expone lo que las rutas necesitan de verdad: consultar
 * un proveedor **con caché**. La ruta no sabe de tablas ni de TTL; sabe pedir
 * resultados.
 *
 * La política de caché vive en un solo sitio a propósito. Repetida en cada ruta
 * —búsqueda ahora, detalle y episodios en T23— acabaría con tres versiones del
 * mismo cálculo y una de ellas mal.
 */

import {
  type CatalogStore,
  clearRevalidateError,
  createCatalogStore,
  createRevalidator,
  createWriteQueue,
  markRevalidateError,
  type RevalidateResource,
  type Revalidator,
  type StoreConnection,
  type StoredEpisodePage,
  type WriteQueue,
} from '@nn-anime/catalog-store'
import type { FeedEntry, StreamRequest, StreamSource } from '@nn-anime/core'
import {
  type AnimeDetail,
  type Episode,
  type EpisodeSeason,
  episodeSeasons,
  err,
  normalizeQuery,
  ok,
  ProviderError,
  type ProviderRef,
  type Result,
  type SearchResult,
  seasonOf,
} from '@nn-anime/core'
import {
  createMpvPlayer,
  createPlaylistCache,
  createTicketStore,
  DEFAULT_TTL_S,
  type MpvPlayer,
  type PlaylistCache,
  pluginFetchFactory,
  type SpawnMpv,
  spawnMpvProcess,
  type TicketStore,
} from '@nn-anime/media-proxy'
import {
  type CallOptions,
  getAnime as fetchAnime,
  getEpisode as fetchEpisode,
  getEpisodes as fetchEpisodes,
  getEpisodesPage as fetchEpisodesPage,
  getFeed as fetchFeed,
  getLatestEpisode as fetchLatestEpisode,
  resolveStream as fetchStream,
  getTrending as fetchTrending,
  type Provider,
  search as searchProvider,
  setPluginFetchFactory,
} from '@nn-anime/provider-sdk'
import { type CacheOutcome, readThrough } from './cache-read'

/**
 * Cuántas entradas de un feed se guardan y se sirven, como mucho.
 *
 * El tope lo pone quien lee, no el plugin, y se aplica **antes** de escribir: una
 * fuente no puede llenar el disco ni hacer que la home pinte mil tarjetas. Vive
 * aquí desde T54 porque quien lee y cachea es el contenedor; la ruta sólo agrega
 * lo que recibe.
 */
export const MAX_FEED_ENTRIES = 200

/**
 * Cuántos episodios trae cada página cuando el proveedor **no** sabe paginar.
 *
 * El troceado es del servidor y no de la interfaz, para que el selector tenga un
 * solo camino: con página del proveedor o sin ella, la respuesta es una página.
 * Son los mismos 100 que recorta la ventana de pintado de la web
 * (`EPISODE_WINDOW`), pero no se importan de allí: el servidor no depende de la
 * web, y el día que el número cambie en un sitio el otro tiene que decidirlo.
 */
export const EPISODES_PER_PAGE = 100

/** Qué página del selector se pide. */
export interface EpisodesPageRequest {
  readonly page: number
  /**
   * La temporada pedida, si se pidió una.
   *
   * Sin ella, la página es la del título entero. Un proveedor que pagina por su
   * cuenta —`capabilities.episodePages`— no la admite: su lista no se lee entera,
   * así que no hay de dónde sacar las temporadas, y la ruta lo rechaza antes de
   * llegar aquí.
   */
  readonly season?: number
}

/**
 * Una página del selector, con el índice de temporadas del título.
 *
 * El índice va **fuera** de la página: `StoredEpisodePage` es lo que se guarda y
 * lo que el contrato del plugin devuelve —una ventana de cien episodios—, y el
 * índice describe el título entero. Guardarlo dentro obligaría a escribirlo en
 * cada página y a que las páginas del plugin mintieran sobre un campo que no
 * tienen.
 */
export interface EpisodesPageOutcome extends CacheOutcome<StoredEpisodePage> {
  readonly seasons?: readonly EpisodeSeason[]
}

/** Clave de caché de una búsqueda: el proveedor y la consulta normalizada. */
export function searchKey(providerId: string, query: string): string {
  return `${providerId}#${normalizeQuery(query)}`
}

export interface ServerContainer {
  readonly store: CatalogStore
  readonly revalidator: Revalidator
  readonly queue: WriteQueue
  /** Tickets opacos: el cliente nunca ve una URL del upstream. */
  readonly tickets: TicketStore
  /**
   * Playlists HLS ya reescritas, por ticket.
   *
   * Vive aquí y no en la ruta porque las dos mitades de una reproducción HLS la
   * necesitan: la ruta del ticket la escribe al reescribir, y la del segmento la
   * lee para resolver `seg/:index` sin volver a bajar la playlist.
   */
  readonly playlists: PlaylistCache
  /** Reproductor externo. Si no hay mpv, `play` dice que no está. */
  readonly mpv: MpvPlayer
  /** Resuelve el stream de un episodio, con la caché de URL corta. */
  resolveStream(
    provider: Provider,
    request: StreamRequest,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly StreamSource[]>, ProviderError>>
  /** Detalle de un título, con caché y refresco por detrás si toca. */
  getAnime(
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<AnimeDetail>, ProviderError>>
  /** Lista de episodios, con caché. Deja el detalle escrito si hacía falta. */
  getEpisodes(
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly Episode[]>, ProviderError>>
  /**
   * Una página del selector, con la caché de cinco minutos o la de la lista.
   *
   * Aquí vive la decisión de dónde sale la página: del proveedor, si declara
   * `episodePages`, o del troceado de la lista completa que ya cachea
   * `getEpisodes`. La ruta no sabe cuál de los dos caminos se tomó.
   *
   * Con una temporada pedida, la página es **suya** —su primer centenar, sus
   * páginas siguientes— y el índice de temporadas sigue siendo el del título:
   * el selector tiene que poder ofrecer todas desde cualquier página.
   */
  getEpisodesPage(
    provider: Provider,
    ref: ProviderRef,
    request: EpisodesPageRequest,
    callOptions: CallOptions,
  ): Promise<Result<EpisodesPageOutcome, ProviderError>>
  /**
   * Un episodio por su número, con el proveedor o desde la lista cacheada.
   *
   * No tiene caché propia: lo que se pide una vez —un salto a un número— no se
   * vuelve a pedir en la misma sesión, y el número suelto no es una lista que
   * merezca una tabla. La lista cacheada sí es la de `getEpisodes`.
   */
  getEpisode(
    provider: Provider,
    ref: ProviderRef,
    number: number,
    callOptions: CallOptions,
    season?: number,
  ): Promise<Result<Episode, ProviderError>>
  /**
   * El último episodio del título, con el proveedor o desde la lista cacheada.
   *
   * Con `season`, el último de esa temporada. Sin ella, el último de la temporada
   * más alta y no el número más alto del título: con numeración por temporada,
   * ese número vive en la temporada 1.
   */
  getLatestEpisode(
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
    season?: number,
  ): Promise<Result<Episode, ProviderError>>
  /** Resultados de un proveedor, con caché y refresco por detrás si toca. */
  searchProvider(
    provider: Provider,
    query: string,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly SearchResult[]>, ProviderError>>
  /**
   * Novedades de la fuente, con caché y refresco por detrás si toca.
   *
   * Va aquí y no en la ruta por el mismo motivo que el detalle: el TTL se mira en
   * un solo sitio. Hasta T54 la ruta servía la caché aunque estuviera caducada, y
   * una entrada publicada después de la primera carga no aparecía jamás.
   */
  getFeed(
    provider: Provider,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly FeedEntry[]>, ProviderError>>
  /** Tendencias de la fuente, con caché y refresco por detrás si toca. */
  getTrending(
    provider: Provider,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly SearchResult[]>, ProviderError>>
  close(): Promise<void>
}

export interface ContainerOptions {
  readonly db: StoreConnection
  readonly queue?: WriteQueue
  readonly revalidator?: Revalidator
  /** Almacén de tickets. Se inyecta para poder fijar la capacidad en un test. */
  readonly tickets?: TicketStore
  /** Caché de playlists. Se inyecta para poder fijar su TTL en un test. */
  readonly playlists?: PlaylistCache
  /** Si hay mpv en el `PATH`. Lo decide el arranque, que puede esperar. */
  readonly mpvAvailable?: boolean
  /** Lanzador de mpv, inyectable: una prueba no abre ventanas. */
  readonly spawnMpv?: SpawnMpv
  /**
   * Reloj inyectable.
   *
   * Sin él no se puede probar la caducidad ni el `stale-while-revalidate` sin
   * esperar quince minutos de reloj real.
   */
  readonly now?: () => number
}

export function createContainer(options: ContainerOptions): ServerContainer {
  const queue = options.queue ?? createWriteQueue()
  const revalidator = options.revalidator ?? createRevalidator({ concurrency: 2 })
  const resource: RevalidateResource = 'search'

  // El store comparte la cola y el revalidador: con uno distinto en cada sitio,
  // el cierre tendría que acordarse de todos y las escrituras de fondo podrían
  // solaparse con las de la ruta.
  const store = createCatalogStore(options.db, {
    queue,
    revalidator,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const tickets = options.tickets ?? createTicketStore()
  // La vida del índice de una playlist es la del ticket que la nombra, no la
  // frescura de su texto: una reproducción entera pide segmentos contra él. Con
  // los diez segundos por defecto, todos los segmentos pasaban a ser 404 a los
  // pocos segundos de cargar la lista y la reproducción se paraba.
  const playlists = options.playlists ?? createPlaylistCache({ ttlMs: DEFAULT_TTL_S * 1000 })
  const mpv = createMpvPlayer({
    spawn: options.spawnMpv ?? spawnMpvProcess,
    available: options.mpvAvailable ?? false,
  })

  /*
   * La capacidad de red de los plugins, registrada una vez por contenedor.
   *
   * `createPluginFetch` lee `NN_ANIME_ALLOW_LOOPBACK` por su cuenta —la misma
   * variable que el proxy, y el aviso de arranque del CLI ya cubre las dos—, así
   * que aquí no hay nada que pasarle: la fábrica se construye en cada llamada, con
   * el `signal` y el `timeoutMs` de quien la pidió.
   */
  setPluginFetchFactory(pluginFetchFactory)

  /**
   * El stream de un episodio, con su caché de URL corta.
   *
   * No pasa por `readThrough` porque aquí **no hay rama stale**: un enlace
   * vencido no se sirve «un poco viejo», se resuelve otra vez. La caché de
   * streams devuelve `null` en cuanto pasa el TTL, así que sólo hay acierto o
   * fallo, y refrescar por detrás no tiene sentido: nadie espera un enlace que
   * ya no vale.
   */
  const loadStream = async (
    provider: Provider,
    request: StreamRequest,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly StreamSource[]>, ProviderError>> => {
    try {
      const cached = await store.readStream(request.episodeRef, request.mode)
      if (cached !== null) return ok({ value: [cached], source: 'hit' })

      const resultado = await fetchStream(provider, request, callOptions)
      if (!resultado.ok) return err(resultado.error)

      try {
        await store.writeStream(request, resultado.value)
      } catch {
        // No poder cachear es peor rendimiento, no un fallo: el episodio puede
        // no estar en la base porque nadie abrió su ficha. Devolver un error
        // aquí dejaría al usuario sin reproducir por un problema de caché.
      }

      return ok({ value: resultado.value, source: 'miss' })
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'resolveStream'))
    }
  }

  const loadAnime = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<AnimeDetail>, ProviderError>> => {
    const clave = `${provider.id}#${ref.value}`

    try {
      const outcome = await readThrough<AnimeDetail>({
        key: clave,
        resource: 'anime',
        revalidator,
        read: () => store.readAnime(ref),
        fetch: async () => {
          const resultado = await fetchAnime(provider, ref, callOptions)
          if (!resultado.ok) throw resultado.error

          return resultado.value
        },
        write: (detalle) => store.writeAnime(ref, detalle),
        onError: (key, message) => {
          markRevalidateError(options.db, 'anime', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'anime', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getAnime'))
    }
  }

  /**
   * El título tiene que existir antes de colgarle nada.
   *
   * La clave foránea lo exige: sin la fila del anime, guardar episodios o
   * páginas falla. Si no está, se pide el detalle primero —una llamada más en el
   * peor caso— en lugar de escribir filas huérfanas que no se podrían leer.
   */
  const ensureAnime = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<unknown, ProviderError>> => {
    if ((await store.readAnime(ref)) !== null) return ok(undefined)

    const detalle = await loadAnime(provider, ref, callOptions)
    if (!detalle.ok) return detalle

    return ok(undefined)
  }

  const loadEpisodes = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly Episode[]>, ProviderError>> => {
    const clave = `${provider.id}#${ref.value}`

    const titulo = await ensureAnime(provider, ref, callOptions)
    if (!titulo.ok) return titulo

    try {
      const outcome = await readThrough<readonly Episode[]>({
        key: clave,
        resource: 'episodes',
        revalidator,
        read: () => store.readEpisodes(ref),
        fetch: async () => {
          const resultado = await fetchEpisodes(provider, ref, callOptions)
          if (!resultado.ok) throw resultado.error

          return resultado.value
        },
        write: (lista) => store.writeEpisodes(ref, lista),
        onError: (key, message) => {
          markRevalidateError(options.db, 'episodes', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'episodes', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getEpisodes'))
    }
  }

  /**
   * Una página del selector.
   *
   * Dos caminos según lo que el proveedor sepa hacer, y la ruta ve uno solo:
   *
   * - Con `episodePages`, la página se pide tal cual y se cachea cinco minutos.
   *   Un acierto **no vencido** se sirve sin red; una página vencida se vuelve a
   *   pedir, sin rama «vieja servible», como el stream: una ventana de ayer no
   *   se sirve un poco vieja, se pide otra vez.
   * - Sin la capacidad, se pide la lista completa de siempre —con su caché de
   *   seis horas— y se trocea aquí. El troceado es del servidor para que el
   *   selector tenga un solo camino: un plugin viejo no se queda sin páginas.
   */
  const loadEpisodesPage = async (
    provider: Provider,
    ref: ProviderRef,
    request: EpisodesPageRequest,
    callOptions: CallOptions,
  ): Promise<Result<EpisodesPageOutcome, ProviderError>> => {
    try {
      if (provider.capabilities.episodePages === true) {
        // La página cuelga del título: sin su fila, la escritura falla.
        const titulo = await ensureAnime(provider, ref, callOptions)
        if (!titulo.ok) return titulo

        const guardada = await store.readEpisodePage(ref, request.page)
        if (guardada !== null && !guardada.stale) {
          return ok({ value: guardada.value, source: 'hit' })
        }

        const resultado = await fetchEpisodesPage(provider, ref, request.page, callOptions)
        if (!resultado.ok) return err(resultado.error)

        await store.writeEpisodePage(ref, request.page, resultado.value)

        return ok({ value: resultado.value, source: 'miss' })
      }

      const lista = await loadEpisodes(provider, ref, callOptions)
      if (!lista.ok) return lista

      const completa = lista.value.value
      const seasons = episodeSeasons(completa)
      if (request.season === undefined) {
        return ok({
          value: sliceEpisodesPage(completa, request.page),
          source: lista.value.source,
          ...(seasons === undefined ? {} : { seasons }),
        })
      }

      const temporada = completa.filter((episodio) => seasonOf(episodio) === request.season)
      if (temporada.length === 0) {
        // La temporada pedida no está: 404 como el episodio suelto que no
        // existe, y por el mismo camino —el `estado` del contexto es el que ya
        // lee `statusForEpisodes`— para que la interfaz no trate dos «no está»
        // de forma distinta.
        return err(
          new ProviderError({
            message: `el título ${ref.value} de ${provider.id} no tiene la temporada ${request.season}`,
            scope: provider.id,
            op: 'getEpisodesPage',
            context: { estado: 404 },
          }),
        )
      }

      return ok({
        // El total es el de **la temporada** cuando se pidió una: con numeración
        // por temporada, «Episodio 2 de 9» mezclaba la etiqueta de la fuente con
        // el total del título entero. Sin temporada, sigue siendo el del título.
        value: sliceEpisodesPage(temporada, request.page),
        source: lista.value.source,
        ...(seasons === undefined ? {} : { seasons }),
      })
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getEpisodesPage'))
    }
  }

  /** Un episodio por número: del proveedor o de la lista cacheada. */
  const loadEpisode = async (
    provider: Provider,
    ref: ProviderRef,
    number: number,
    callOptions: CallOptions,
    season?: number,
  ): Promise<Result<Episode, ProviderError>> => {
    try {
      if (provider.capabilities.episodePages === true) {
        return await fetchEpisode(provider, ref, number, callOptions)
      }

      const lista = await loadEpisodes(provider, ref, callOptions)
      if (!lista.ok) return lista

      // Con temporada, el número se busca **dentro de ella**. Sin temporada, el
      // número puede existir en varias: devolver la primera sería abrir un
      // episodio que nadie pidió, así que se dice que hace falta elegir.
      const candidatos = lista.value.value.filter(
        (episodio) =>
          episodio.number === number && (season === undefined || seasonOf(episodio) === season),
      )
      const [encontrado] = candidatos
      if (encontrado === undefined) return err(episodeNotFound(provider, ref, number, season))

      if (season === undefined) {
        const temporadas = [
          ...new Set(
            candidatos
              .map((episodio) => seasonOf(episodio))
              .filter((temporada): temporada is number => temporada !== undefined),
          ),
        ]
        if (temporadas.length > 1) {
          return err(episodeAmbiguous(provider, ref, number, temporadas))
        }
      }

      return ok(encontrado)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getEpisode'))
    }
  }

  /** El último episodio: del proveedor o el mayor de la lista cacheada. */
  const loadLatestEpisode = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
    season?: number,
  ): Promise<Result<Episode, ProviderError>> => {
    try {
      if (provider.capabilities.episodePages === true) {
        return await fetchLatestEpisode(provider, ref, callOptions)
      }

      const lista = await loadEpisodes(provider, ref, callOptions)
      if (!lista.ok) return lista

      const candidatos =
        season === undefined
          ? lista.value.value
          : lista.value.value.filter((episodio) => seasonOf(episodio) === season)

      if (candidatos.length === 0) return err(episodesEmpty(provider, ref, season))

      // El último es el de la temporada más alta y, dentro de ella, el número más
      // alto. Sin temporadas, esto es el máximo número de siempre. No se toma el
      // último de la lista porque una fuente puede servirla en cualquier orden.
      let ultimo: Episode | undefined
      for (const episodio of candidatos) {
        if (ultimo === undefined) {
          ultimo = episodio
          continue
        }

        const temporada = seasonOf(episodio) ?? 0
        const temporadaUltima = seasonOf(ultimo) ?? 0
        if (
          temporada > temporadaUltima ||
          (temporada === temporadaUltima && episodio.number > ultimo.number)
        ) {
          ultimo = episodio
        }
      }

      if (ultimo === undefined) return err(episodesEmpty(provider, ref, season))

      return ok(ultimo)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getLatestEpisode'))
    }
  }

  /**
   * Las novedades de la fuente.
   *
   * La clave lleva el recurso delante porque el revalidador deduplica por clave
   * sola: sin el prefijo, el feed de `fixture` y sus tendencias compartirían
   * entrada y una de las dos revalidaciones se descartaría por duplicada.
   */
  const loadFeed = async (
    provider: Provider,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly FeedEntry[]>, ProviderError>> => {
    try {
      const outcome = await readThrough<readonly FeedEntry[]>({
        key: `feed#${provider.id}`,
        resource: 'feed',
        revalidator,
        read: () => store.readFeed(provider.id),
        fetch: async () => {
          const resultado = await fetchFeed(provider, callOptions)
          if (!resultado.ok) throw resultado.error

          // El recorte va antes de escribir: lo que no se cachea no se sirve.
          return resultado.value.slice(0, MAX_FEED_ENTRIES)
        },
        write: (entradas) => store.writeFeed(provider.id, entradas),
        onError: (key, message) => {
          markRevalidateError(options.db, 'feed', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'feed', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getFeed'))
    }
  }

  /** Las tendencias de la fuente, con el mismo camino que el feed. */
  const loadTrending = async (
    provider: Provider,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly SearchResult[]>, ProviderError>> => {
    try {
      const outcome = await readThrough<readonly SearchResult[]>({
        key: `trending#${provider.id}`,
        resource: 'trending',
        revalidator,
        read: () => store.readTrending(provider.id),
        fetch: async () => {
          const resultado = await fetchTrending(provider, callOptions)
          if (!resultado.ok) throw resultado.error

          return resultado.value
        },
        write: (resultados) => store.writeTrending(provider.id, resultados),
        onError: (key, message) => {
          markRevalidateError(options.db, 'trending', key, message)
        },
        onSuccess: (key) => {
          clearRevalidateError(options.db, 'trending', key)
        },
      })

      return ok(outcome)
    } catch (cause) {
      return err(asProviderError(cause, provider.id, 'getTrending'))
    }
  }

  return {
    store,
    revalidator,
    queue,
    tickets,
    playlists,
    mpv,
    getAnime: loadAnime,
    getEpisodes: loadEpisodes,
    getEpisodesPage: loadEpisodesPage,
    getEpisode: loadEpisode,
    getLatestEpisode: loadLatestEpisode,
    getFeed: loadFeed,
    getTrending: loadTrending,
    resolveStream: loadStream,

    async searchProvider(provider, query, callOptions) {
      const key = searchKey(provider.id, query)

      try {
        const outcome = await readThrough<readonly SearchResult[]>({
          key,
          resource,
          revalidator,
          read: () => store.readSearch(provider.id, query),
          fetch: async () => {
            const resultado = await searchProvider(provider, query, callOptions)
            if (!resultado.ok) throw resultado.error

            return resultado.value
          },
          write: async (results) => {
            await store.writeSearch(provider.id, query, results)
          },
          onError: (clave, message) => {
            markRevalidateError(options.db, resource, clave, message)
          },
          onSuccess: (clave) => {
            clearRevalidateError(options.db, resource, clave)
          },
        })

        return ok(outcome)
      } catch (cause) {
        // La ruta no tiene que saber si falló el proveedor o la escritura: aquí
        // se convierte en un `Result` y el agregado decide qué evento emitir.
        return err(asProviderError(cause, provider.id, 'search'))
      }
    },

    async close() {
      await store.close()
    },
  }
}

/**
 * Trocea una lista de episodios en la página pedida.
 *
 * `hasMore` sale del trozo y no del tamaño: la última página puede venir
 * incompleta y eso no significa que haya más. `total` es la longitud de la lista
 * porque aquí sí se conoce entera; con un proveedor que pagina lo dice él, y si
 * no lo dice no se inventa.
 *
 * `total` se puede decir aparte, y hay un caso que lo necesita: la página de una
 * temporada. Lo que se trocea es la temporada, y lo que la fila numera es el
 * título —«Episodio 12 de 91»—, así que el total no puede salir del trozo.
 */
function sliceEpisodesPage(
  episodes: readonly Episode[],
  page: number,
  total: number = episodes.length,
): StoredEpisodePage {
  const desde = (page - 1) * EPISODES_PER_PAGE

  return {
    episodes: episodes.slice(desde, desde + EPISODES_PER_PAGE),
    page,
    hasMore: desde + EPISODES_PER_PAGE < episodes.length,
    total,
  }
}

/**
 * El número pedido no está en la lista: es un 404, no una página vacía.
 *
 * El `estado` del contexto es el que ya lee `statusForEpisodes` para decidir el
 * estado HTTP: inventar aquí un código nuevo obligaría a la ruta a distinguir un
 * fallo del proveedor de un hueco de numeración, y los dos son «no está».
 */
function episodeNotFound(
  provider: Provider,
  ref: ProviderRef,
  number: number,
  season?: number,
): ProviderError {
  const donde = season === undefined ? '' : ` en la temporada ${season}`

  return new ProviderError({
    message: `el título ${ref.value} de ${provider.id} no tiene ningún episodio con el número ${number}${donde}`,
    scope: provider.id,
    op: 'getEpisode',
    context: { estado: 404 },
  })
}

/**
 * El número existe en varias temporadas y no se pidió ninguna.
 *
 * Es un 409 y no el primero de la lista: con numeración por temporada, «el
 * episodio 2» no identifica nada, y abrir el de la temporada 1 mientras se ve la
 * 3 es reproducir el episodio equivocado.
 */
function episodeAmbiguous(
  provider: Provider,
  ref: ProviderRef,
  number: number,
  seasons: readonly number[],
): ProviderError {
  return new ProviderError({
    message: `el título ${ref.value} de ${provider.id} tiene el episodio ${number} en varias temporadas (${seasons.join(', ')}); indica ?season=`,
    scope: provider.id,
    op: 'getEpisode',
    context: { estado: 409, temporadas: seasons.join(',') },
  })
}

/** Un título sin episodios no tiene último: 404 con el motivo, no un hueco. */
function episodesEmpty(provider: Provider, ref: ProviderRef, season?: number): ProviderError {
  const donde = season === undefined ? '' : ` en la temporada ${season}`

  return new ProviderError({
    message: `el título ${ref.value} de ${provider.id} no tiene episodios${donde}`,
    scope: provider.id,
    op: 'getLatestEpisode',
    context: { estado: 404 },
  })
}

/** Cualquier fallo se convierte en el error del proveedor que lo causó. */
function asProviderError(cause: unknown, providerId: string, op: string): ProviderError {
  return cause instanceof ProviderError
    ? cause
    : new ProviderError({
        message: cause instanceof Error ? cause.message : String(cause),
        scope: providerId,
        op,
        cause,
      })
}
