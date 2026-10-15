/**
 * Fachada `CatalogStore`.
 *
 * Es lo que usa el resto de la aplicación, y existe por dos motivos:
 *
 * 1. **Es el único punto de escritura.** Todas las escrituras pasan por la cola,
 *    así que la revalidación de fondo y una ruta nunca escriben a la vez. La
 *    regla tiene un solo dueño en lugar de repetirse en cada repositorio.
 * 2. **Los repositorios siguen siendo sincrónicos.** `bun:sqlite` lo es, y
 *    fingir lo contrario dentro sería mentira; la fachada los envuelve en
 *    promesas porque quien llama —una ruta HTTP— sí es asíncrono.
 *
 * El cierre se hace en un solo sitio y en orden: primero se para la
 * revalidación, después se cierra la cola y se vacía, y sólo entonces se cierra
 * la base. Cerrar la base antes deja escrituras en el aire que fallan con un
 * error de «base cerrada» en un sitio que no tiene nada que ver.
 */

import type { Database } from 'bun:sqlite'
import type {
  AniListEntry,
  AniListImageKind,
  AnimeDetail,
  AnimeSummary,
  CacheHit,
  Episode,
  FeedEntry,
  MigrationReport,
  ProviderRef,
  PruneReport,
  SearchRecord,
  SearchResult,
  StreamMode,
  StreamRequest,
  StreamSource,
  WatchEventInput,
  WatchedEpisode,
  WatchRecord,
} from '@nn-anime/core'
import type { z } from 'zod'
import { findCoverUrl } from './cover-ref'
import { runMigrations } from './migrations/runner'
import { pruneOrphans } from './prune'
import { type AdultRepository, createAdultRepository } from './repositories/adult'
import { type AniListRepository, createAniListRepository } from './repositories/anilist'
import { type CandidateRow, createAnimeRepository } from './repositories/anime'
import { createEpisodePageRepository, type StoredEpisodePage } from './repositories/episode-page'
import { createEpisodesRepository } from './repositories/episodes'
import { createFavoritesRepository } from './repositories/favorites'
import { createFeedRepository } from './repositories/feed'
import { createRecentRepository } from './repositories/recent'
import { createRelatedRepository, type RelatedScope } from './repositories/related'
import { createSearchRepository } from './repositories/search'
import { createSearchHistoryRepository } from './repositories/search-history'
import { createSettingsRepository } from './repositories/settings'
import { createStreamRepository } from './repositories/stream'
import { createTrendingRepository } from './repositories/trending'
import { createWatchRepository } from './repositories/watch'
import { createWatchedEpisodesRepository } from './repositories/watched-episodes'
import type { Revalidator } from './revalidate'
import { createWriteQueue, type WriteQueue } from './write-queue'

export interface CatalogStoreOptions {
  /** Se comparte con quien revalide en segundo plano. Por defecto, una nueva. */
  readonly queue?: WriteQueue
  /** Si se indica, `close` la para antes de cerrar la base. */
  readonly revalidator?: Revalidator
  /** Reloj inyectable, para probar caducidades sin esperar. */
  readonly now?: () => number
}

/**
 * El contrato del spec, con dos matices escritos:
 *
 * - `recordWatch` devuelve el identificador de la fila. La ruta que registra el
 *   inicio de la reproducción tiene que devolvérselo al reproductor para que
 *   pueda actualizar la posición después.
 * - `getSetting` pide un schema además del valor por defecto. El JSON de la fila
 *   es `unknown`; devolverlo como `T` exigiría una conversión de tipo o mentir
 *   al compilador. Con el schema, un ajuste con otra forma devuelve el valor por
 *   defecto en lugar de colarse disfrazado.
 */
export interface CatalogStore {
  readAnime(ref: ProviderRef): Promise<CacheHit<AnimeDetail> | null>
  writeAnime(ref: ProviderRef, detail: AnimeDetail): Promise<void>
  /**
   * Marca una referencia como contenido para adultos.
   *
   * Lo que se guarda es un booleano por referencia, nunca la obra. La marca **no
   * caduca**: que una obra sea para adultos no se vence, y por eso el refresco del
   * proveedor —que reescribe la fila del anime— no la toca.
   */
  markAdult(ref: ProviderRef): Promise<void>
  /**
   * De estas referencias, las que constan como para adultos.
   *
   * Va por lote porque quien pregunta trae una fila entera, y **sin lista devuelve todas
   * las que constan**: quien tiene que filtrar un corpus largo —el motor de
   * recomendaciones— no puede construir una consulta con un par por candidato. Una
   * referencia marcada no vuelve a preguntarse a AniList: la marca es local y dura.
   */
  listAdultRefs(refs?: readonly ProviderRef[]): Promise<readonly ProviderRef[]>
  /**
   * La URL de portada de una referencia que ya apareció en un listado cacheado.
   *
   * `readAnime` sólo la tiene si alguien abrió la ficha. Esto cubre el hueco de
   * los resultados de búsqueda y de las tendencias, que traen su portada sin
   * detalle: sin esto, sus tarjetas piden una imagen que la ruta contesta 404
   * hasta que alguien abre el título.
   */
  readCover(ref: ProviderRef): Promise<string | undefined>
  /** Los títulos cacheados, con sus tags, para el motor de recomendación. */
  listCandidates(limit: number): Promise<readonly CandidateRow[]>
  /**
   * Lo último que la aplicación conoce, del más nuevo al más viejo.
   *
   * Une lo abierto y lo encontrado por una búsqueda. Es la reserva del destacado de
   * la home —y una señal del motor en el arranque en frío—: existe para que la
   * primera pantalla no dependa de que el usuario haya buscado o de que su proveedor
   * ofrezca tendencias. La fila «Último añadido», que la pintaba, se retiró de la
   * home en T118: repetía lo que ya enseñaban las novedades y el top.
   */
  listRecentSummaries(limit: number): Promise<readonly AnimeSummary[]>
  /**
   * Los títulos cacheados cuyo género encaja con el término.
   *
   * Los proveedores buscan por título: ninguno entiende «acción». Esta consulta
   * —la que da sentido a la fila de géneros de la home— sale de la base.
   */
  searchByGenre(term: string, limit: number): Promise<readonly SearchResult[]>
  /** Tendencias cacheadas de un proveedor. */
  readTrending(providerId: string): Promise<CacheHit<readonly SearchResult[]> | null>
  writeTrending(providerId: string, results: readonly SearchResult[]): Promise<void>
  /** Feed de novedades cacheado de un proveedor, con sus fechas. */
  readFeed(providerId: string): Promise<CacheHit<readonly FeedEntry[]> | null>
  writeFeed(providerId: string, entries: readonly FeedEntry[]): Promise<void>
  readEpisodes(ref: ProviderRef): Promise<CacheHit<readonly Episode[]> | null>
  writeEpisodes(ref: ProviderRef, episodes: readonly Episode[]): Promise<void>
  /**
   * Una página del selector, con su ventana de cinco minutos.
   *
   * Va aparte de `readEpisodes` porque son dos preguntas distintas: «qué
   * episodios tiene esta serie» —seis horas— y «qué hay en esta ventana» —cinco
   * minutos—. Un plugin que sabe paginar no pide la lista entera, y una página
   * caducada no se sirve vieja: se pide otra vez.
   */
  readEpisodePage(ref: ProviderRef, page: number): Promise<CacheHit<StoredEpisodePage> | null>
  writeEpisodePage(ref: ProviderRef, page: number, value: StoredEpisodePage): Promise<void>
  /** Detalle y episodios en una sola transacción. */
  writeAnimeWithEpisodes(
    ref: ProviderRef,
    detail: AnimeDetail,
    episodes: readonly Episode[],
  ): Promise<void>
  readSearch(providerId: string, query: string): Promise<CacheHit<readonly SearchResult[]> | null>
  writeSearch(providerId: string, query: string, results: readonly SearchResult[]): Promise<void>

  /**
   * El emparejamiento de una obra local con su ficha de AniList.
   *
   * `null` como valor es «se buscó y no hay equivalente», que es una respuesta y
   * se guarda; `null` como retorno es «no se ha buscado», que es otra cosa. La
   * distinción importa: la primera no vuelve a preguntarse en una semana y la
   * segunda se pregunta en cuanto hace falta.
   */
  readAniListMedia(titleKey: string): Promise<CacheHit<AniListEntry | null> | null>
  writeAniListMedia(titleKey: string, media: AniListEntry | null): Promise<void>
  /**
   * Una lista cacheada de AniList —el top, la parrilla— con el schema de su
   * contenido: la tabla guarda dos formas y quien lee sabe cuál le toca.
   */
  readAniListList<T>(key: string, schema: z.ZodType<T>): Promise<CacheHit<readonly T[]> | null>
  /**
   * Guarda la lista **y las imágenes de las obras que lleva dentro**, para que la
   * ruta de la imagen pueda resolver un id que la vitrina está enseñando sin que
   * nadie haya abierto su ficha.
   */
  writeAniListList<T>(
    key: string,
    items: readonly T[],
    options: { readonly ttlS: number; readonly images: readonly AniListEntry[] },
  ): Promise<void>
  /** La dirección de una imagen ya cacheada. No descubre imágenes nuevas. */
  readAniListImage(mediaId: number, kind: AniListImageKind): Promise<string | undefined>

  readStream(episodeRef: ProviderRef, mode: StreamMode): Promise<StreamSource | null>
  writeStream(request: StreamRequest, sources: readonly StreamSource[]): Promise<void>
  invalidateStream(episodeRef: ProviderRef, mode: StreamMode): Promise<number>

  recordWatch(event: WatchEventInput): Promise<number>
  updateWatchPosition(eventId: number, positionS: number, durationS: number): Promise<void>
  listRecentlyWatched(limit: number): Promise<readonly WatchRecord[]>
  /**
   * Los hermanos de `ref`, de lo que la base ya conoce.
   *
   * El alcance elige la clave del emparejamiento: la saga —el de por defecto— o
   * la franquicia, que junta una serie con su secuela cuando la fuente las nombra
   * distinto. Lista vacía cuando no hay ninguno: quien pinta la sección necesita
   * distinguir «no hay» de «no se pudo» para explicarse.
   */
  listRelated(
    ref: ProviderRef,
    limit: number,
    scope?: RelatedScope,
  ): Promise<readonly AnimeSummary[]>
  /**
   * Las otras fuentes que tienen **esta misma obra**, de lo que la base ya conoce.
   *
   * No son hermanos de saga: es la misma ficha en otro sitio, que es lo que la
   * ficha necesita para ofrecer elegir fuente. Una entrada por proveedor y nunca
   * la del `ref` pedido; lista vacía cuando no hay ninguna, que no es un error.
   */
  listSources(ref: ProviderRef, limit: number): Promise<readonly AnimeSummary[]>
  /**
   * Lo que la base ya conoce que empieza como alguno de estos nombres.
   *
   * Es para emparejar una obra que llega de un tercero —AniList— con su ficha
   * local: la lectura vive aquí —una consulta, la misma de los relacionados— y la
   * identidad la decide quien llama, que es quien tiene los dos lados.
   */
  listLocalCandidates(names: readonly string[], limit: number): Promise<readonly AnimeSummary[]>
  /**
   * El estado de visionado de cada episodio, por número.
   *
   * Una fila por episodio —la del visionado más avanzado—, no una por visionado:
   * el reproductor abre una fila por reproducción y la lista quiere el resultado.
   */
  listWatchedEpisodes(animeRef: ProviderRef): Promise<readonly WatchedEpisode[]>
  setFavorite(ref: ProviderRef, value: boolean): Promise<void>
  listFavorites(): Promise<readonly AnimeSummary[]>
  recordSearch(query: string, providerId: string, hits: number): Promise<void>
  listRecentSearches(limit: number): Promise<readonly SearchRecord[]>

  getSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T>
  setSetting(key: string, value: unknown): Promise<void>
  runMigrations(): Promise<MigrationReport>
  pruneOrphans(now?: Date): Promise<PruneReport>
  close(): Promise<void>
}

export function createCatalogStore(db: Database, options: CatalogStoreOptions = {}): CatalogStore {
  const queue = options.queue ?? createWriteQueue()
  const ahora = options.now ?? Date.now

  /**
   * Los repositorios se crean la primera vez que hacen falta.
   *
   * Preparan sus sentencias al construirse, así que crearlos aquí exigiría que
   * el esquema ya existiera **antes** de llamar a `runMigrations`, y la fachada
   * no podría migrar una base recién creada. Con la creación diferida, el orden
   * natural —migrar y luego usar— sale solo, y da igual cuál sea.
   */
  interface Repos {
    readonly adult: AdultRepository
    readonly anilist: AniListRepository
    readonly anime: ReturnType<typeof createAnimeRepository>
    readonly episodes: ReturnType<typeof createEpisodesRepository>
    readonly episodePages: ReturnType<typeof createEpisodePageRepository>
    readonly search: ReturnType<typeof createSearchRepository>
    readonly streams: ReturnType<typeof createStreamRepository>
    readonly watch: ReturnType<typeof createWatchRepository>
    readonly favorites: ReturnType<typeof createFavoritesRepository>
    readonly history: ReturnType<typeof createSearchHistoryRepository>
    readonly settings: ReturnType<typeof createSettingsRepository>
    readonly trending: ReturnType<typeof createTrendingRepository>
    readonly feed: ReturnType<typeof createFeedRepository>
    readonly recent: ReturnType<typeof createRecentRepository>
    readonly related: ReturnType<typeof createRelatedRepository>
    readonly watched: ReturnType<typeof createWatchedEpisodesRepository>
  }

  let repos: Repos | undefined
  const of = (): Repos =>
    (repos ??= {
      adult: createAdultRepository(db),
      anilist: createAniListRepository(db),
      anime: createAnimeRepository(db),
      episodes: createEpisodesRepository(db),
      episodePages: createEpisodePageRepository(db),
      search: createSearchRepository(db),
      streams: createStreamRepository(db),
      watch: createWatchRepository(db),
      favorites: createFavoritesRepository(db),
      history: createSearchHistoryRepository(db),
      settings: createSettingsRepository(db),
      trending: createTrendingRepository(db),
      feed: createFeedRepository(db),
      recent: createRecentRepository(db),
      related: createRelatedRepository(db),
      watched: createWatchedEpisodesRepository(db),
    })

  return {
    async readAnime(ref) {
      return of().anime.read(ref, ahora())
    },
    async writeAnime(ref, detail) {
      // El reloj se pasa también al escribir: si sólo lo usaran las lecturas,
      // una fila quedaría con la fecha real y la caducidad inyectada no se
      // podría probar. Lo encontró la prueba de integración del ciclo.
      await queue.run(() => of().anime.write(ref, detail, ahora()))
    },
    async markAdult(ref) {
      // La marca es una escritura como las demás: pasa por la cola, que es lo que
      // hace que una sola conexión no tenga dos escrituras a la vez.
      await queue.run(() => of().adult.mark(ref))
    },
    async listAdultRefs(refs) {
      return of().adult.list(refs)
    },
    async readCover(ref) {
      return findCoverUrl(db, ref)
    },
    async listCandidates(limit) {
      return of().anime.list(limit)
    },
    async listRecentSummaries(limit) {
      return of().recent.list(limit)
    },
    async searchByGenre(term, limit) {
      return of().anime.searchByGenre(term, limit)
    },

    async readTrending(providerId) {
      return of().trending.read(providerId, ahora())
    },

    async writeTrending(providerId, results) {
      await queue.run(() => of().trending.write(providerId, results, ahora()))
    },

    async readFeed(providerId) {
      return of().feed.read(providerId, ahora())
    },

    async writeFeed(providerId, entries) {
      await queue.run(() => of().feed.write(providerId, entries, ahora()))
    },

    async readEpisodes(ref) {
      return of().episodes.read(ref, ahora())
    },
    async writeEpisodes(ref, list) {
      await queue.run(() => of().episodes.write(ref, list, ahora()))
    },
    async readEpisodePage(ref, page) {
      return of().episodePages.read(ref, page, ahora())
    },
    async writeEpisodePage(ref, page, value) {
      await queue.run(() => of().episodePages.write(ref, page, value, ahora()))
    },
    async writeAnimeWithEpisodes(ref, detail, list) {
      await queue.run(() => of().anime.writeWith(ref, detail, list, ahora()))
    },
    async readSearch(providerId, query) {
      return of().search.read(providerId, query, ahora())
    },
    async writeSearch(providerId, query, results) {
      await queue.run(() => of().search.write(providerId, query, results, ahora()))
    },

    async readAniListMedia(titleKey) {
      return of().anilist.readMedia(titleKey, ahora())
    },
    async writeAniListMedia(titleKey, media) {
      await queue.run(() => of().anilist.writeMedia(titleKey, media, ahora()))
    },
    async readAniListList(key, schema) {
      return of().anilist.readList(key, schema, ahora())
    },
    async writeAniListList(key, items, options) {
      await queue.run(() => {
        const anilist = of().anilist

        anilist.writeList(key, items, options.ttlS, ahora())
        for (const media of options.images) anilist.writeImages(media)
      })
    },
    async readAniListImage(mediaId, kind) {
      return of().anilist.readImage(mediaId, kind)
    },

    async readStream(episodeRef, mode) {
      return of().streams.read(episodeRef, mode, ahora())
    },
    async writeStream(request, sources) {
      await queue.run(() => of().streams.write(request, sources, ahora()))
    },
    async invalidateStream(episodeRef, mode) {
      return queue.run(() => of().streams.invalidateStream(episodeRef, mode))
    },

    async recordWatch(event) {
      return queue.run(() => of().watch.recordWatch(event))
    },
    async updateWatchPosition(eventId, positionS, durationS) {
      await queue.run(() => of().watch.updateWatchPosition(eventId, positionS, durationS))
    },
    async listRecentlyWatched(limit) {
      return of().watch.listRecentlyWatched(limit)
    },
    async listRelated(ref, limit, scope) {
      return of().related.list(ref, limit, scope)
    },
    async listSources(ref, limit) {
      return of().related.listSources(ref, limit)
    },
    async listLocalCandidates(names, limit) {
      return of().related.candidatesByNames(names, limit)
    },
    async listWatchedEpisodes(animeRef) {
      return of().watched.list(animeRef)
    },
    async setFavorite(ref, value) {
      await queue.run(() => of().favorites.setFavorite(ref, value))
    },
    async listFavorites() {
      return of().favorites.listFavorites()
    },
    async recordSearch(query, providerId, hits) {
      await queue.run(() => of().history.recordSearch(query, providerId, hits))
    },
    async listRecentSearches(limit) {
      return of().history.listRecentSearches(limit)
    },

    async getSetting(key, schema, fallback) {
      return of().settings.get(key, schema, fallback)
    },
    async setSetting(key, value) {
      await queue.run(() => of().settings.set(key, value))
    },
    async runMigrations() {
      return queue.run(() => runMigrations(db))
    },
    async pruneOrphans(now = new Date()) {
      return queue.run(() => pruneOrphans(db, now))
    },

    async close() {
      // Primero lo de fondo, después la cola, y la base al final: al revés,
      // cualquier trabajo en vuelo falla con «base cerrada» en un sitio que no
      // tiene nada que ver con la causa.
      await options.revalidator?.close()
      queue.close()
      await queue.drain()
      db.close()
    },
  }
}
