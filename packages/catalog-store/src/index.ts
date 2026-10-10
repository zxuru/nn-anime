/**
 * Superficie pública de `@nn-anime/catalog-store`.
 *
 * Este paquete es el único dueño del estado persistente y el único que abre
 * SQLite. Hoy expone la apertura de la base y las migraciones; los repositorios
 * se añaden en las tareas siguientes y la fachada `CatalogStore` los agrupa.
 */

export { BUSY_TIMEOUT_MS, openDb } from './db'
export {
  listMigrations,
  type MigrationFile,
  type MigrationReport,
  runMigrations,
  schemaVersion,
} from './migrations/runner'
