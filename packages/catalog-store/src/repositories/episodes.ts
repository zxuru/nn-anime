/**
 * Repositorio de listas de episodios.
 *
 * Una lista de episodios pertenece a un anime, así que la escritura necesita que
 * el anime exista: la clave foránea lo exige y el error que da SQLite al
 * incumplirla no dice cuál falta. Aquí se comprueba antes y se nombra.
 *
 * Un anime **sin episodios** no es un MISS. Una obra anunciada tiene cero
 * episodios y eso es un dato, no la ausencia de un dato: si se devolviera
 * `null`, cada visita volvería a pedir la lista al proveedor para recibir otra
 * vez la lista vacía. El MISS es que no haya fila del anime.
 */

import type { Database } from 'bun:sqlite'
import {
  type CacheHit,
  type Episode,
  episodeSchema,
  type ProviderRef,
  StoreError,
} from '@nn-anime/core'
import { cacheHit, TTL_SECONDS } from '../cache-policy'

interface AnimeClockRow {
  readonly id: number
  readonly provider_id: string
  readonly provider_ref: string
  readonly fetched_at: number
  readonly ttl_s: number
  readonly episodes_fetched_at: number | null
  readonly episodes_ttl_s: number | null
}

interface EpisodeRow {
  readonly provider_ref: string
  readonly fetched_at: number
  readonly ttl_s: number
  readonly number: number
  readonly title: string | null
  readonly duration_s: number | null
  readonly mode: string
}

function parseEpisode(row: EpisodeRow, anime: ProviderRef): Episode {
  const parsed = episodeSchema.safeParse({
    ref: { providerId: anime.providerId, value: row.provider_ref },
    animeRef: anime,
    number: row.number,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.duration_s === null ? {} : { durationS: row.duration_s }),
    mode: row.mode,
  })

  if (!parsed.success) {
    throw new StoreError({
      message: `el episodio ${row.provider_ref} de ${anime.providerId}/${anime.value} no cumple el schema: ${parsed.error.message}`,
      scope: 'catalog-store',
      op: 'readEpisodes',
    })
  }

  return parsed.data
}

/**
 * Reemplaza la lista de episodios de un anime. **No abre transacción**: quien
 * llama decide si esto va solo o junto con la escritura del detalle, que es lo
 * que necesita T23 para no dejar un anime sin sus episodios si algo falla en
 * medio.
 */
export function replaceEpisodes(
  db: Database,
  animeId: number,
  episodes: readonly Episode[],
  now: number,
  ttlS: number,
): void {
  // Se reemplaza la lista entera: un episodio retirado por el proveedor no puede
  // quedarse en la base porque nadie borró lo viejo.
  db.query('DELETE FROM episode WHERE anime_id = ?').run(animeId)

  const insert = db.query(
    `INSERT INTO episode (anime_id, provider_ref, number, title, duration_s, mode, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  for (const episode of episodes) {
    insert.run(
      animeId,
      episode.ref.value,
      episode.number,
      episode.title ?? null,
      episode.durationS ?? null,
      episode.mode,
      now,
      ttlS,
    )
  }
}

/**
 * Identificador interno de un episodio, a partir de su referencia.
 *
 * Hace falta un `JOIN` con el anime porque la tabla de episodios no guarda el
 * proveedor: lo hereda del anime al que pertenece, y una referencia de episodio
 * sólo es única dentro de su proveedor.
 */
export function episodeIdOf(db: Database, ref: ProviderRef): number | undefined {
  return db
    .query<{ id: number }, [string, string]>(
      `SELECT episode.id AS id
         FROM episode
         JOIN anime ON anime.id = episode.anime_id
        WHERE anime.provider_id = ? AND episode.provider_ref = ?`,
    )
    .get(ref.providerId, ref.value)?.id
}

/**
 * Anota que la lista de episodios se pidió, con su reloj y su TTL.
 *
 * Va aparte de `replaceEpisodes` porque la lista vacía es un caso legítimo: sin
 * la marca, cero filas es indistinguible de «nunca se pidió», y un título
 * anunciado se pediría en cada visita o —peor— se serviría vacío para siempre.
 */
export function markEpisodesFetched(
  db: Database,
  animeId: number,
  now: number,
  ttlS: number,
): void {
  db.query('UPDATE anime SET episodes_fetched_at = ?, episodes_ttl_s = ? WHERE id = ?').run(
    now,
    ttlS,
    animeId,
  )
}

/** Identificador interno de un anime, o `undefined` si no está. */
export function animeIdOf(db: Database, ref: ProviderRef): number | undefined {
  return db
    .query<{ id: number }, [string, string]>(
      'SELECT id FROM anime WHERE provider_id = ? AND provider_ref = ?',
    )
    .get(ref.providerId, ref.value)?.id
}

export function createEpisodesRepository(db: Database, ttlS: number = TTL_SECONDS.episodes) {
  const animeSelect = db.query<AnimeClockRow, [string, string]>(
    `SELECT id, provider_id, provider_ref, fetched_at, ttl_s, episodes_fetched_at, episodes_ttl_s
       FROM anime WHERE provider_id = ? AND provider_ref = ?`,
  )

  const episodesSelect = db.query<EpisodeRow, [number]>(
    'SELECT provider_ref, number, title, duration_s, mode, fetched_at, ttl_s FROM episode WHERE anime_id = ? ORDER BY number',
  )

  return {
    read(ref: ProviderRef, now: number = Date.now()): CacheHit<readonly Episode[]> | null {
      const anime = animeSelect.get(ref.providerId, ref.value)
      if (anime === null) return null

      // La marca es lo que distingue «la lista se pidió y estaba vacía» de
      // «nunca se pidió». Sin ella, un título con cero episodios parecería
      // cacheado en cuanto existiera su fila de detalle.
      if (anime.episodes_fetched_at === null) return null

      const animeRef: ProviderRef = { providerId: anime.provider_id, value: anime.provider_ref }
      const episodes = episodesSelect.all(anime.id).map((row) => parseEpisode(row, animeRef))

      return cacheHit(episodes, anime.episodes_fetched_at, anime.episodes_ttl_s ?? ttlS, now)
    },

    write(ref: ProviderRef, episodes: readonly Episode[], now: number = Date.now()): void {
      const anime = animeSelect.get(ref.providerId, ref.value)
      if (anime === null) {
        throw new StoreError({
          message: `no se pueden guardar episodios de un anime que no está: ${ref.providerId}/${ref.value}`,
          scope: 'catalog-store',
          op: 'writeEpisodes',
        })
      }

      db.transaction(() => {
        replaceEpisodes(db, anime.id, episodes, now, ttlS)

        // La marca de «pedida» se escribe en la misma transacción que la lista:
        // si se escribieran por separado, una lista vacía sin marca se volvería
        // a pedir para siempre y una marca sin lista serviría una vacía falsa.
        markEpisodesFetched(db, anime.id, now, ttlS)
      })()
    },
  }
}

export type EpisodesStore = ReturnType<typeof createEpisodesRepository>
