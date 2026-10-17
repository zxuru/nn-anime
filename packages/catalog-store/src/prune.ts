/**
 * Limpieza de huérfanos.
 *
 * Es la única reducción de disco de la aplicación, así que borra lo menos
 * posible y lo cuenta todo. Dos reglas, del spec:
 *
 * - **`stream_cache` vencido hace más de un día.** Una URL caducada no sirve; se
 *   le da un día de margen porque guardarla no cuesta nada y borrarla pronto
 *   obliga a resolver el stream otra vez.
 * - **Detalles sin actividad en 90 días**, con sus episodios y sus géneros.
 *
 * Dos protecciones que **no** están en el spec y conviene saber:
 *
 * 1. **Un favorito nunca se limpia.** El spec dice «no se haya visto ni buscado
 *    en 90 días», y un favorito no es ninguna de las dos cosas; borrarlo sería
 *    hacer desaparecer de la lista algo que el usuario marcó a mano. Ante la
 *    duda, se conserva. **Y lo mismo vale para la marca de visto**: una película
 *    vista fuera de la aplicación puede no tener un solo visionado ni búsqueda, y
 *    su marca se iría con el detalle a los 90 días sin que nadie la quitara.
 * 2. **«Buscado» no se puede saber por título.** `search_history` guarda la
 *    consulta y el proveedor, no los títulos que salieron. Lo que sí cubre el
 *    caso es que un título abierto desde una búsqueda se cachea en ese momento:
 *    su `fetched_at` es reciente y no entra en el plazo de 90 días.
 *
 * Todo se borra en una transacción y con cuentas por tabla. «Borré 120 filas» no
 * dice si tocó el historial del usuario o sólo la caché, y esa diferencia es la
 * que importa antes de limpiar datos ajenos.
 */

import type { Database } from 'bun:sqlite'
import type { PruneReport } from '@nn-anime/core'

/** Días sin actividad antes de poder limpiar un detalle. */
export const PRUNE_AFTER_DAYS = 90

/** Margen que se le da a un stream caducado antes de borrarlo. */
export const STREAM_GRACE_DAYS = 1

/** Tamaño a partir del cual el arranque ofrece la limpieza. */
export const PRUNE_SIZE_THRESHOLD_BYTES = 200 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000

/** Si conviene limpiar, según el tamaño de la base. */
export function shouldPrune(sizeBytes: number, threshold = PRUNE_SIZE_THRESHOLD_BYTES): boolean {
  return sizeBytes > threshold
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/**
 * Los detalles que se pueden limpiar: sin actividad en el plazo, sin favorito y
 * sin la marca de visto.
 *
 * Se seleccionan primero y se borran después con la lista de identificadores, en
 * lugar de repetir la subconsulta en cada `DELETE`: así lo que se borra es
 * exactamente lo que se contó, y no lo que la base decida entre una sentencia y
 * la siguiente.
 */
function doomedAnime(db: Database, cutoff: number): readonly number[] {
  const filas = db
    .query<{ id: number }, [number, number]>(
      `SELECT a.id AS id
         FROM anime a
        WHERE a.fetched_at <= ?
          AND NOT EXISTS (SELECT 1 FROM favorite f WHERE f.anime_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM watched_title w WHERE w.anime_id = a.id)
          AND NOT EXISTS (
            SELECT 1 FROM watch_event w WHERE w.anime_id = a.id AND w.started_at > ?
          )`,
    )
    .all(cutoff, cutoff)

  return filas.map((fila) => fila.id)
}

/**
 * Las tablas que la limpieza puede tocar.
 *
 * El informe las lleva **todas**, con cero cuando no tocó ninguna: `undefined` y
 * `0` se confunden con facilidad al pintar el resultado, y «no borré nada de
 * aquí» es un dato, no un hueco.
 */
export const PRUNED_TABLES: readonly string[] = [
  'stream_cache',
  'watch_event',
  'favorite',
  'watched_title',
  'episode',
  'genre',
  'anime',
]

export function pruneOrphans(db: Database, now: Date = new Date()): PruneReport {
  const ahora = now.getTime()
  const limiteDetalle = ahora - PRUNE_AFTER_DAYS * DAY_MS
  const borradas: Record<string, number> = Object.fromEntries(
    PRUNED_TABLES.map((tabla) => [tabla, 0]),
  )

  const apply = db.transaction(() => {
    borradas.stream_cache = db
      .query('DELETE FROM stream_cache WHERE fetched_at + ttl_s * 1000 + ? <= ?')
      .run(STREAM_GRACE_DAYS * DAY_MS, ahora).changes

    const ids = doomedAnime(db, limiteDetalle)
    if (ids.length === 0) return

    const lista = placeholders(ids.length)

    for (const tabla of ['watch_event', 'favorite', 'watched_title']) {
      const borradasAqui = db
        .query(`DELETE FROM ${tabla} WHERE anime_id IN (${lista})`)
        .run(...ids).changes

      borradas[tabla] = (borradas[tabla] ?? 0) + borradasAqui
    }

    borradas.stream_cache += db
      .query(
        `DELETE FROM stream_cache
          WHERE episode_id IN (SELECT id FROM episode WHERE anime_id IN (${lista}))`,
      )
      .run(...ids).changes

    borradas.episode = db
      .query(`DELETE FROM episode WHERE anime_id IN (${lista})`)
      .run(...ids).changes

    borradas.genre = db.query(`DELETE FROM genre WHERE anime_id IN (${lista})`).run(...ids).changes

    borradas.anime = db.query(`DELETE FROM anime WHERE id IN (${lista})`).run(...ids).changes
  })

  apply()

  return { deleted: borradas }
}
