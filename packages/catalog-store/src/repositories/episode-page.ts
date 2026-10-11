/**
 * Caché de las páginas del selector de episodios.
 *
 * Cinco minutos, no las seis horas de la lista completa: una página es lo que se
 * está mirando ahora mismo y la lista entera es el catálogo del título. La
 * ventana corta es además la que deja al plugin parar cuando la fuente limita por
 * ráfaga, en vez de servir durante horas una página que ya no vale.
 *
 * La forma de la página es la del contrato —`EpisodePage` del SDK— escrita aquí y
 * no importada: la dependencia va del SDK al almacén y no al revés, y una
 * conversión de tipo para que encajen dos formas idénticas sería una conversión
 * que nadie revisa.
 *
 * Una página que no está es un MISS, como la lista: no hay rama «vieja pero
 * servible», porque un enlace de ayer no se sirve un poco viejo, se pide otra vez.
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
import { animeIdOf } from './episodes'

/** Lo que se guarda de una página: el contrato, sin la referencia del título. */
export interface StoredEpisodePage {
  readonly episodes: readonly Episode[]
  readonly page: number
  readonly hasMore: boolean
  readonly total?: number
}

interface PageRow {
  readonly episodes_json: string
  readonly has_more: number
  readonly total: number | null
  readonly fetched_at: number
  readonly ttl_s: number
}

export interface EpisodePageRepository {
  read(ref: ProviderRef, page: number, now?: number): CacheHit<StoredEpisodePage> | null
  write(ref: ProviderRef, page: number, value: StoredEpisodePage, now?: number): void
}

export function createEpisodePageRepository(db: Database): EpisodePageRepository {
  const ttlS = TTL_SECONDS.episodePage
  const select = db.query<PageRow, [number, number]>(
    `SELECT episodes_json, has_more, total, fetched_at, ttl_s
       FROM episode_page
      WHERE anime_id = ? AND page = ?`,
  )
  const replace = db.query(
    `INSERT INTO episode_page (anime_id, page, episodes_json, has_more, total, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (anime_id, page) DO UPDATE SET
       episodes_json = excluded.episodes_json,
       has_more      = excluded.has_more,
       total         = excluded.total,
       fetched_at    = excluded.fetched_at,
       ttl_s         = excluded.ttl_s`,
  )

  return {
    read(ref, page, now = Date.now()) {
      const animeId = animeIdOf(db, ref)
      // Sin fila del título no hay página que colgar: es un MISS, no un error.
      // El error es de la escritura, que es la que necesita el título para
      // existir.
      if (animeId === undefined) return null

      const fila = select.get(animeId, page)
      if (fila === null) return null

      const crudo: unknown = JSON.parse(fila.episodes_json)
      const episodios = episodeSchema.array().safeParse(crudo)

      if (!episodios.success) {
        throw new StoreError({
          message: `la página ${page} de ${ref.providerId}/${ref.value} tiene una forma que no se entiende`,
          context: { providerId: ref.providerId, ref: ref.value, page },
          op: 'readEpisodePage',
        })
      }

      return cacheHit(
        {
          episodes: episodios.data,
          page,
          hasMore: fila.has_more === 1,
          ...(fila.total === null ? {} : { total: fila.total }),
        },
        fila.fetched_at,
        fila.ttl_s,
        now,
      )
    },

    write(ref, page, value, now = Date.now()) {
      const animeId = animeIdOf(db, ref)
      if (animeId === undefined) {
        // La clave foránea lo exigiría igual, y el error de SQLite al incumplirla
        // no dice cuál falta.
        throw new StoreError({
          message: `no hay ningún título ${ref.providerId}/${ref.value} al que colgar su página ${page}`,
          context: { providerId: ref.providerId, ref: ref.value, page },
          op: 'writeEpisodePage',
        })
      }

      replace.run(
        animeId,
        page,
        JSON.stringify(value.episodes),
        value.hasMore ? 1 : 0,
        value.total ?? null,
        now,
        ttlS,
      )
    },
  }
}
