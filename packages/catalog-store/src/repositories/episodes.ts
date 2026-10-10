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
    'SELECT id, provider_id, provider_ref, fetched_at, ttl_s FROM anime WHERE provider_id = ? AND provider_ref = ?',
  )

  const episodesSelect = db.query<EpisodeRow, [number]>(
    'SELECT provider_ref, number, title, duration_s, mode, fetched_at, ttl_s FROM episode WHERE anime_id = ? ORDER BY number',
  )

  return {
    read(ref: ProviderRef, now: number = Date.now()): CacheHit<readonly Episode[]> | null {
      const anime = animeSelect.get(ref.providerId, ref.value)
      if (anime === null) return null

      const animeRef: ProviderRef = { providerId: anime.provider_id, value: anime.provider_ref }
      const rows = episodesSelect.all(anime.id)
      const episodes = rows.map((row) => parseEpisode(row, animeRef))

      // El reloj sale de las filas de episodios, que es donde vive el TTL de la
      // lista (21600), no del anime (86400): usar el del anime serviría como
      // fresca una lista de episodios de hace un día. Sin filas —un título
      // anunciado, con cero episodios— se usa el del anime, porque se pidieron
      // juntos y no hay otra fecha que mirar.
      const first = rows[0]

      return cacheHit(episodes, first?.fetched_at ?? anime.fetched_at, first?.ttl_s ?? ttlS, now)
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
      })()
    },
  }
}

export type EpisodesStore = ReturnType<typeof createEpisodesRepository>
