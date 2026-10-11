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
  type WriteQueue,
} from '@nn-anime/catalog-store'
import type { FeedEntry, StreamRequest, StreamSource } from '@nn-anime/core'
import {
  type AnimeDetail,
  type Episode,
  err,
  normalizeQuery,
  ok,
  ProviderError,
  type ProviderRef,
  type Result,
  type SearchResult,
} from '@nn-anime/core'
import {
  createMpvPlayer,
  createPlaylistCache,
  createTicketStore,
  DEFAULT_TTL_S,
  type MpvPlayer,
  type PlaylistCache,
  type SpawnMpv,
  spawnMpvProcess,
  type TicketStore,
} from '@nn-anime/media-proxy'
import {
  type CallOptions,
  getAnime as fetchAnime,
  getEpisodes as fetchEpisodes,
  getFeed as fetchFeed,
  resolveStream as fetchStream,
  getTrending as fetchTrending,
  type Provider,
  search as searchProvider,
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

  const loadEpisodes = async (
    provider: Provider,
    ref: ProviderRef,
    callOptions: CallOptions,
  ): Promise<Result<CacheOutcome<readonly Episode[]>, ProviderError>> => {
    const clave = `${provider.id}#${ref.value}`

    // La lista de episodios pertenece a un anime, y la clave foránea lo exige:
    // sin la fila del título, guardar episodios falla. Si no está, se pide el
    // detalle primero —una llamada más en el peor caso— en lugar de escribir
    // episodios huérfanos que no se podrían leer.
    if ((await store.readAnime(ref)) === null) {
      const detalle = await loadAnime(provider, ref, callOptions)
      if (!detalle.ok) return detalle
    }

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
