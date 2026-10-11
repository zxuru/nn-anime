/**
 * Caché del feed de novedades.
 *
 * Es una tabla propia y no una entrada de `trending_cache`, aunque las dos las
 * pida la home sola: un feed trae fechas y se lee para ordenar por novedad, y las
 * tendencias no. Compartir tabla obligaría a que una de las dos fingiera el campo
 * que no tiene.
 *
 * La lección es la de la auditoría de T47: la segunda carga de la home no puede
 * volver a pedirle el feed a un sitio de terceros. Se cachea por proveedor, con
 * su TTL, y se valida lo que se relee: un JSON cacheado que ya no cumple el
 * schema es un error con contexto, no una excepción de parseo.
 */

import type { Database } from 'bun:sqlite'
import { type CacheHit, type FeedEntry, feedEntrySchema, StoreError } from '@nn-anime/core'
import { cacheHit, TTL_SECONDS } from '../cache-policy'

interface FeedRow {
  readonly provider_id: string
  readonly results_json: string
  readonly fetched_at: number
  readonly ttl_s: number
}

export interface FeedRepository {
  read(providerId: string, now?: number): CacheHit<readonly FeedEntry[]> | null
  write(providerId: string, entries: readonly FeedEntry[], now?: number): void
}

export function createFeedRepository(db: Database): FeedRepository {
  const ttlS = TTL_SECONDS.feed
  const select = db.query<FeedRow, [string]>(
    'SELECT provider_id, results_json, fetched_at, ttl_s FROM feed_cache WHERE provider_id = ?',
  )
  const replace = db.query(
    `INSERT INTO feed_cache (provider_id, results_json, fetched_at, ttl_s)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider_id) DO UPDATE SET
       results_json = excluded.results_json,
       fetched_at   = excluded.fetched_at,
       ttl_s        = excluded.ttl_s`,
  )

  return {
    read(providerId, now = Date.now()) {
      const fila = select.get(providerId)
      if (fila === null) return null

      const crudo: unknown = JSON.parse(fila.results_json)
      const entradas = feedEntrySchema.array().safeParse(crudo)

      if (!entradas.success) {
        throw new StoreError({
          message: 'la caché del feed tiene una forma que no se entiende',
          context: { providerId },
          op: 'readFeed',
        })
      }

      return cacheHit(entradas.data, fila.fetched_at, fila.ttl_s, now)
    },

    write(providerId, entries, now = Date.now()) {
      replace.run(providerId, JSON.stringify(entries), now, ttlS)
    },
  }
}
