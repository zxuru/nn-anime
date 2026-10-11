/**
 * Superficie pública de `@nn-anime/catalog-store`.
 *
 * Este paquete es el único dueño del estado persistente y el único que abre
 * SQLite. Expone la base y las migraciones, los repositorios —que son piezas
 * internas, aquí exportadas para poder probarlas— y la fachada `CatalogStore`,
 * que es lo que usa el resto de la aplicación.
 *
 * **La fachada es el único punto por el que se escribe.** Todas sus escrituras
 * pasan por la cola: sin eso, la revalidación de fondo y una escritura de la
 * ruta podrían solaparse, y SQLite admite muchas lecturas pero una sola
 * escritura. Encolarlas aquí, y no en cada repositorio, hace que la regla tenga
 * un solo dueño: quien quiera escribir, pasa por la fachada.
 */

export { type CacheResource, cacheHit, isStale, TTL_SECONDS } from './cache-policy'
export { findCoverUrl } from './cover-ref'
export { BUSY_TIMEOUT_MS, openDb, type StoreConnection } from './db'
export {
  listMigrations,
  type MigrationFile,
  type MigrationReport,
  runMigrations,
  schemaVersion,
} from './migrations/runner'
export {
  PRUNE_AFTER_DAYS,
  PRUNE_SIZE_THRESHOLD_BYTES,
  PRUNED_TABLES,
  pruneOrphans,
  STREAM_GRACE_DAYS,
  shouldPrune,
} from './prune'
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
export { createSettingsRepository, type SettingsStore } from './repositories/settings'
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
export { type CatalogStore, type CatalogStoreOptions, createCatalogStore } from './store'
export { createWriteQueue, type WriteQueue } from './write-queue'
