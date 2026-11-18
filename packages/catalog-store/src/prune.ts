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
 *    duda, se conserva. **Y lo mismo vale para la marca de visto y para la de
 *    «quiero ver»**: una película vista fuera de la aplicación puede no tener un
 *    solo visionado ni búsqueda, y su marca se iría con el detalle a los 90 días
 *    sin que nadie la quitara. Lo pendiente es el caso extremo de lo mismo: una
 *    obra que alguien guardó para verla más adelante puede llevar meses sin un
 *    solo visionado, y es justo la que no se puede perder.
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
import type { PruneReport } from '@rona/core'

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
 * Los detalles que se pueden limpiar: sin actividad en el plazo, sin favorito,
 * sin la marca de visto y sin la de «quiero ver».
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
          AND NOT EXISTS (SELECT 1 FROM plan_to_watch p WHERE p.anime_id = a.id)
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
  'search_cache',
  'trending_cache',
  'feed_cache',
  'episode_page',
  'anilist_media',
  'anilist_list_cache',
  'aniskip_cache',
  'revalidate_error',
  'search_history',
  'known_cover',
  'known_title',
  'watch_event',
  'favorite',
  'watched_title',
  'plan_to_watch',
  'episode',
  'genre',
  'anime',
]

/** Cachés con `fetched_at` y `ttl_s`: se borran cuando vencen. */
const TTL_TABLES: readonly string[] = [
  'search_cache',
  'trending_cache',
  'feed_cache',
  'episode_page',
  'anilist_media',
  'anilist_list_cache',
  'aniskip_cache',
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

    // Las demás cachés TTL. No tenían poda: la base crecía con cada consulta y
    // el comando manual tampoco las tocaba.
    for (const tabla of TTL_TABLES) {
      borradas[tabla] = db
        .query(`DELETE FROM ${tabla} WHERE fetched_at + ttl_s * 1000 <= ?`)
        .run(ahora).changes
    }

    // El registro de errores y el historial de búsquedas no tienen TTL: se
    // acotan por edad, con el mismo plazo que los detalles.
    borradas.revalidate_error = db
      .query('DELETE FROM revalidate_error WHERE at <= ?')
      .run(limiteDetalle).changes
    borradas.search_history = db
      .query('DELETE FROM search_history WHERE created_at <= ?')
      .run(limiteDetalle).changes

    // Las portadas conocidas no son la caché del listado: sobreviven a su TTL
    // porque una tarjeta puede pedirlas mucho después. Pero tampoco son para
    // siempre: una referencia que no ha vuelto a aparecer en ningún listado en
    // 90 días no la va a pedir nadie, y la fila del detalle —si existe— se
    // consulta antes que esta tabla. Sin este tope, `known_cover` crecía con
    // cada búsqueda y no se vaciaba nunca.
    borradas.known_cover = db
      .query('DELETE FROM known_cover WHERE updated_at <= ?')
      .run(limiteDetalle).changes

    // `known_title` es el resumen que leen los relacionados, y caduca con el
    // mismo plazo y por el mismo motivo: si no, la tabla que vino a evitar el
    // barrido acabaría siendo el barrido, porque crece con cada búsqueda y no
    // se vacía nunca. El detalle abierto —que también alimenta la sección— no
    // depende de esta tabla.
    borradas.known_title = db
      .query('DELETE FROM known_title WHERE updated_at <= ?')
      .run(limiteDetalle).changes

    const ids = doomedAnime(db, limiteDetalle)
    if (ids.length === 0) return

    const lista = placeholders(ids.length)

    for (const tabla of ['watch_event', 'favorite', 'watched_title', 'plan_to_watch']) {
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

  // Borrar filas libera páginas para reutilizarlas, pero no devuelve el archivo
  // al disco: sin `VACUUM`, una base que llegó a 200 MB sigue midiendo 200 MB y
  // el arranque vuelve a ofrecer la limpieza cada vez. Es best-effort: si no
  // hay espacio para reconstruir la base, las filas ya están borradas.
  try {
    db.exec('VACUUM')
  } catch {
    // La limpieza de filas ya se hizo; el disco se recuperará en la próxima.
  }

  return { deleted: borradas }
}
