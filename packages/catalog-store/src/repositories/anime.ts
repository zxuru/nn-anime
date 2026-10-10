/**
 * Repositorio de detalles de anime.
 *
 * La fila guarda dos cosas a la vez: columnas para lo que se consulta y ordena
 * —título, año, estado, fecha— y `raw_json` con el detalle completo. Se lee del
 * JSON porque es lo único que conserva **todo** y en orden: `genres` y `studios`
 * son listas ordenadas, y una tabla de géneros las devolvería por nombre. Las
 * columnas siguen haciendo falta para `pruneOrphans` y para las consultas de
 * `recsys`, que no pueden mirar dentro de un JSON sin recorrerlo entero.
 *
 * Todas las lecturas devuelven `null` en un MISS. Devolver un objeto vacío
 * obligaría a cada consumidor a distinguir «sin datos» de «datos vacíos», y esa
 * comprobación se olvida una vez por consumidor.
 */

import type { Database } from 'bun:sqlite'
import {
  type AnimeDetail,
  animeDetailSchema,
  type CacheHit,
  type Episode,
  type ProviderRef,
  StoreError,
} from '@nn-anime/core'
import { cacheHit, TTL_SECONDS } from '../cache-policy'
import { animeIdOf, markEpisodesFetched, replaceEpisodes } from './episodes'

interface AnimeRow {
  readonly id: number
  readonly fetched_at: number
  readonly ttl_s: number
  readonly raw_json: string | null
}

export interface AnimeRepository {
  /** `null` cuando no hay fila. `stale` se calcula, no se guarda. */
  read(ref: ProviderRef, now?: number): CacheHit<AnimeDetail> | null
  write(ref: ProviderRef, detail: AnimeDetail, now?: number): void
  /**
   * El detalle y su lista de episodios, en **una sola transacción**.
   *
   * Es lo que usa una ruta de detalle: si se escribieran por separado y fallara
   * la segunda, quedaría un anime en la base sin sus episodios, y la siguiente
   * lectura diría que tiene cero. Media escritura es peor que ninguna.
   */
  writeWith(ref: ProviderRef, detail: AnimeDetail, episodes: readonly Episode[], now?: number): void
  /** Identificador interno, para las tablas que apuntan al anime. */
  idOf(ref: ProviderRef): number | undefined
}

function parseDetail(row: AnimeRow, ref: ProviderRef): AnimeDetail {
  if (row.raw_json === null) {
    throw new StoreError({
      message: `la fila del anime ${ref.providerId}/${ref.value} no tiene raw_json`,
      scope: 'catalog-store',
      op: 'readAnime',
    })
  }

  const parsed = animeDetailSchema.safeParse(JSON.parse(row.raw_json))
  if (!parsed.success) {
    throw new StoreError({
      message: `el raw_json del anime ${ref.providerId}/${ref.value} no cumple el schema: ${parsed.error.message}`,
      scope: 'catalog-store',
      op: 'readAnime',
    })
  }

  return parsed.data
}

export function createAnimeRepository(db: Database, ttlS: number = TTL_SECONDS.anime) {
  const select = db.query<AnimeRow, [string, string]>(
    'SELECT id, fetched_at, ttl_s, raw_json FROM anime WHERE provider_id = ? AND provider_ref = ?',
  )

  return {
    read(ref: ProviderRef, now: number = Date.now()): CacheHit<AnimeDetail> | null {
      const row = select.get(ref.providerId, ref.value)
      if (row === null) return null

      return cacheHit(parseDetail(row, ref), row.fetched_at, row.ttl_s, now)
    },

    write(ref: ProviderRef, detail: AnimeDetail, now: number = Date.now()): void {
      db.transaction(() => {
        writeAnimeRow(db, ref, detail, now, ttlS)
      })()
    },

    writeWith(
      ref: ProviderRef,
      detail: AnimeDetail,
      episodes: readonly Episode[],
      now: number = Date.now(),
    ): void {
      db.transaction(() => {
        writeAnimeRow(db, ref, detail, now, ttlS)

        const id = animeIdOf(db, ref)
        if (id === undefined) {
          throw new StoreError({
            message: `el anime ${ref.providerId}/${ref.value} no se pudo leer dentro de su propia transacción`,
            scope: 'catalog-store',
            op: 'writeAnimeWithEpisodes',
          })
        }

        replaceEpisodes(db, id, episodes, now, TTL_SECONDS.episodes)
        markEpisodesFetched(db, id, now, TTL_SECONDS.episodes)
      })()
    },

    idOf(ref: ProviderRef): number | undefined {
      return animeIdOf(db, ref)
    },
  }
}

/** La fila del anime y sus géneros. Se usa dentro de una transacción. */
function writeAnimeRow(
  db: Database,
  ref: ProviderRef,
  detail: AnimeDetail,
  now: number,
  ttlS: number,
): void {
  db.query(
    `INSERT INTO anime (
           provider_id, provider_ref, title, title_alt, synopsis, cover_url,
           year, status, episode_count, fetched_at, ttl_s, raw_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider_id, provider_ref) DO UPDATE SET
           title = excluded.title,
           title_alt = excluded.title_alt,
           synopsis = excluded.synopsis,
           cover_url = excluded.cover_url,
           year = excluded.year,
           status = excluded.status,
           episode_count = excluded.episode_count,
           fetched_at = excluded.fetched_at,
           ttl_s = excluded.ttl_s,
           raw_json = excluded.raw_json`,
  ).run(
    ref.providerId,
    ref.value,
    detail.title,
    detail.titleAlt ?? null,
    detail.synopsis ?? null,
    detail.coverUrl ?? null,
    detail.year ?? null,
    detail.status ?? null,
    detail.episodeCount ?? null,
    now,
    ttlS,
    JSON.stringify(detail),
  )

  const row = db
    .query<{ id: number }, [string, string]>(
      'SELECT id FROM anime WHERE provider_id = ? AND provider_ref = ?',
    )
    .get(ref.providerId, ref.value)
  if (row === null) {
    throw new StoreError({
      message: `el anime ${ref.providerId}/${ref.value} no se pudo leer después de escribirlo`,
      scope: 'catalog-store',
      op: 'writeAnime',
    })
  }

  // Los géneros se reemplazan enteros: un título que pierde un género no
  // puede conservarlo en la tabla por no borrar lo viejo.
  db.query('DELETE FROM genre WHERE anime_id = ?').run(row.id)
  const insertGenre = db.query('INSERT INTO genre (anime_id, name) VALUES (?, ?)')
  for (const genre of detail.genres) insertGenre.run(row.id, genre)
}

export type AnimeStore = ReturnType<typeof createAnimeRepository>
