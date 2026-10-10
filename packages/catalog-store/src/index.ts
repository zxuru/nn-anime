/**
 * Superficie pública de `@nn-anime/catalog-store`.
 *
 * Este paquete es el único dueño del estado persistente y el único que abre
 * SQLite. Hoy expone la apertura de la base y las migraciones; los repositorios
 * se añaden en las tareas siguientes y la fachada `CatalogStore` los agrupa.
 */

export { type CacheResource, cacheHit, isStale, TTL_SECONDS } from './cache-policy'
export { BUSY_TIMEOUT_MS, openDb } from './db'
export {
  listMigrations,
  type MigrationFile,
  type MigrationReport,
  runMigrations,
  schemaVersion,
} from './migrations/runner'
export { type AnimeRepository, type AnimeStore, createAnimeRepository } from './repositories/anime'
export {
  createEpisodesRepository,
  type EpisodesStore,
} from './repositories/episodes'
export { createFavoritesRepository, type FavoritesStore } from './repositories/favorites'
export {
  createSearchRepository,
  type SearchStore,
} from './repositories/search'
export {
  createSearchHistoryRepository,
  type SearchHistoryStore,
} from './repositories/search-history'
export {
  chooseSource,
  createStreamRepository,
  type StreamStore,
} from './repositories/stream'
export { createWatchRepository, type WatchStore } from './repositories/watch'
export {
  clearRevalidateError,
  createRevalidator,
  listRevalidateErrors,
  markRevalidateError,
  type RevalidateError,
  type RevalidateResource,
  type RevalidateTask,
  type Revalidator,
  type RevalidatorOptions,
  refKey,
} from './revalidate'
export { createWriteQueue, type WriteQueue } from './write-queue'
