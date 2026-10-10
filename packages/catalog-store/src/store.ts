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
  AnimeDetail,
  AnimeSummary,
  CacheHit,
  Episode,
  MigrationReport,
  ProviderRef,
  PruneReport,
  SearchRecord,
  SearchResult,
  StreamMode,
  StreamRequest,
  StreamSource,
  WatchEventInput,
  WatchRecord,
} from '@nn-anime/core'
import type { z } from 'zod'
import { runMigrations } from './migrations/runner'
import { pruneOrphans } from './prune'
import { type CandidateRow, createAnimeRepository } from './repositories/anime'
import { createEpisodesRepository } from './repositories/episodes'
import { createFavoritesRepository } from './repositories/favorites'
import { createSearchRepository } from './repositories/search'
import { createSearchHistoryRepository } from './repositories/search-history'
import { createSettingsRepository } from './repositories/settings'
import { createStreamRepository } from './repositories/stream'
import { createWatchRepository } from './repositories/watch'
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
  /** Los títulos cacheados, con sus tags, para el motor de recomendación. */
  listCandidates(limit: number): Promise<readonly CandidateRow[]>
  readEpisodes(ref: ProviderRef): Promise<CacheHit<readonly Episode[]> | null>
  writeEpisodes(ref: ProviderRef, episodes: readonly Episode[]): Promise<void>
  /** Detalle y episodios en una sola transacción. */
  writeAnimeWithEpisodes(
    ref: ProviderRef,
    detail: AnimeDetail,
    episodes: readonly Episode[],
  ): Promise<void>
  readSearch(providerId: string, query: string): Promise<CacheHit<readonly SearchResult[]> | null>
  writeSearch(providerId: string, query: string, results: readonly SearchResult[]): Promise<void>

  readStream(episodeRef: ProviderRef, mode: StreamMode): Promise<StreamSource | null>
  writeStream(request: StreamRequest, sources: readonly StreamSource[]): Promise<void>
  invalidateStream(episodeRef: ProviderRef, mode: StreamMode): Promise<number>

  recordWatch(event: WatchEventInput): Promise<number>
  updateWatchPosition(eventId: number, positionS: number, durationS: number): Promise<void>
  listRecentlyWatched(limit: number): Promise<readonly WatchRecord[]>
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
    readonly anime: ReturnType<typeof createAnimeRepository>
    readonly episodes: ReturnType<typeof createEpisodesRepository>
    readonly search: ReturnType<typeof createSearchRepository>
    readonly streams: ReturnType<typeof createStreamRepository>
    readonly watch: ReturnType<typeof createWatchRepository>
    readonly favorites: ReturnType<typeof createFavoritesRepository>
    readonly history: ReturnType<typeof createSearchHistoryRepository>
    readonly settings: ReturnType<typeof createSettingsRepository>
  }

  let repos: Repos | undefined
  const of = (): Repos =>
    (repos ??= {
      anime: createAnimeRepository(db),
      episodes: createEpisodesRepository(db),
      search: createSearchRepository(db),
      streams: createStreamRepository(db),
      watch: createWatchRepository(db),
      favorites: createFavoritesRepository(db),
      history: createSearchHistoryRepository(db),
      settings: createSettingsRepository(db),
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
    async listCandidates(limit) {
      return of().anime.list(limit)
    },

    async readEpisodes(ref) {
      return of().episodes.read(ref, ahora())
    },
    async writeEpisodes(ref, list) {
      await queue.run(() => of().episodes.write(ref, list, ahora()))
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
