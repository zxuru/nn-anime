/**
 * Apertura de la base y sus ajustes de conexión.
 *
 * Este paquete es el **único** que abre SQLite: ningún otro importa `bun:sqlite`,
 * y hay un test que lo comprueba recorriendo el resto de los paquetes. Sin esa
 * regla, la política de caché y de TTL acabaría reimplementada en cada consumidor
 * y con criterios distintos.
 *
 * Los tres `PRAGMA` no son adorno:
 *
 * - `journal_mode = WAL`: lectura y escritura a la vez. Sin él, la interfaz
 *   leyendo mientras se escribe la revalidación da `SQLITE_BUSY`.
 * - `foreign_keys = ON`: SQLite viene con las claves foráneas **apagadas**, así
 *   que `ON DELETE CASCADE` no hace nada y quedan huérfanos. Es el ajuste que
 *   más se olvida porque el esquema se lee como si estuviera activo.
 * - `busy_timeout = 5000`: esperar a que el otro termine en vez de fallar al
 *   instante. La cola de revalidación escribe en paralelo con las lecturas.
 */

import { Database } from 'bun:sqlite'

/** Milisegundos que una conexión espera a que se libere el bloqueo. */
export const BUSY_TIMEOUT_MS = 5000

/**
 * El tipo de conexión, con nombre propio.
 *
 * Los demás paquetes lo importan de aquí en lugar de importar el módulo de
 * SQLite de Bun: este paquete es su único dueño, y hay un test que recorre todos
 * los paquetes para comprobar que nadie más lo nombra.
 */
export type StoreConnection = Database

/**
 * Abre la base en la ruta indicada, creándola si no existe.
 *
 * Funciona con `:memory:` además de con un archivo, porque los tests de
 * `recsys` tienen que correr sin tocar el disco.
 *
 * No devuelve un `Result`: no poder abrir la base no es algo de lo que la
 * aplicación pueda recuperarse con una alternativa. Falla, y quien arranca lo
 * cuenta.
 */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true })

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)

  return db
}
