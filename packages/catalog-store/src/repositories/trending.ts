/**
 * Caché de tendencias.
 *
 * Es una tabla propia y no una entrada de `search_cache`: una búsqueda la pide el
 * usuario y una tendencia la pide la home sola, con vidas distintas y con un
 * significado distinto. Meterlas en la misma tabla con una clave reservada habría
 * sido un truco que el siguiente que la leyera tendría que descifrar.
 *
 * La auditoría de T47 encontró que **nadie las cacheaba**: la segunda carga de la
 * home volvía a llamar a `getTrending`.
 */

import type { Database } from 'bun:sqlite'
import { type CacheHit, type SearchResult, StoreError, searchResultSchema } from '@nn-anime/core'
import { cacheHit, TTL_SECONDS } from '../cache-policy'

interface TrendingRow {
  readonly provider_id: string
  readonly results_json: string
  readonly fetched_at: number
  readonly ttl_s: number
}

export interface TrendingRepository {
  read(providerId: string, now?: number): CacheHit<readonly SearchResult[]> | null
  write(providerId: string, results: readonly SearchResult[], now?: number): void
}

export function createTrendingRepository(db: Database): TrendingRepository {
  const ttlS = TTL_SECONDS.trending
  const select = db.query<TrendingRow, [string]>(
    'SELECT provider_id, results_json, fetched_at, ttl_s FROM trending_cache WHERE provider_id = ?',
  )
  const replace = db.query(
    `INSERT INTO trending_cache (provider_id, results_json, fetched_at, ttl_s)
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
      const resultados = searchResultSchema.array().safeParse(crudo)

      if (!resultados.success) {
        throw new StoreError({
          message: 'la caché de tendencias tiene una forma que no se entiende',
          context: { providerId },
          op: 'readTrending',
        })
      }

      return cacheHit(resultados.data, fila.fetched_at, fila.ttl_s, now)
    },

    write(providerId, results, now = Date.now()) {
      replace.run(providerId, JSON.stringify(results), now, ttlS)
    },
  }
}
