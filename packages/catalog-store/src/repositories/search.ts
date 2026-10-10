/**
 * Caché de resultados de búsqueda, por proveedor y consulta.
 *
 * La clave es la consulta **normalizada**, con la misma función que usa el
 * server para no repetir la petición. Si cada lado normalizara a su manera, la
 * misma búsqueda ocuparía dos entradas —una por convención— y ninguna de las dos
 * acertaría al leer.
 *
 * Se guarda por proveedor y no por consulta sola: el mismo término devuelve
 * cosas distintas en cada fuente, y mezclarlas haría que un proveedor viera los
 * resultados de otro.
 */

import type { Database } from 'bun:sqlite'
import {
  type CacheHit,
  normalizeQuery,
  type SearchResult,
  StoreError,
  searchResultSchema,
} from '@nn-anime/core'
import { z } from 'zod'
import { cacheHit, TTL_SECONDS } from '../cache-policy'

const SEARCH_RESULTS = z.array(searchResultSchema)

interface SearchRow {
  readonly results_json: string
  readonly fetched_at: number
  readonly ttl_s: number
}

function parseResults(row: SearchRow, providerId: string, query: string): readonly SearchResult[] {
  const parsed = SEARCH_RESULTS.safeParse(JSON.parse(row.results_json))
  if (!parsed.success) {
    throw new StoreError({
      message: `los resultados cacheados de ${providerId}/${query} no cumplen el schema: ${parsed.error.message}`,
      scope: 'catalog-store',
      op: 'readSearch',
    })
  }

  return parsed.data
}

export function createSearchRepository(db: Database, ttlS: number = TTL_SECONDS.search) {
  const select = db.query<SearchRow, [string, string]>(
    'SELECT results_json, fetched_at, ttl_s FROM search_cache WHERE provider_id = ? AND query = ?',
  )

  return {
    read(
      providerId: string,
      query: string,
      now: number = Date.now(),
    ): CacheHit<readonly SearchResult[]> | null {
      const row = select.get(providerId, normalizeQuery(query))
      if (row === null) return null

      return cacheHit(parseResults(row, providerId, query), row.fetched_at, row.ttl_s, now)
    },

    write(
      providerId: string,
      query: string,
      results: readonly SearchResult[],
      now: number = Date.now(),
    ): void {
      db.query(
        `INSERT INTO search_cache (provider_id, query, results_json, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider_id, query) DO UPDATE SET
           results_json = excluded.results_json,
           fetched_at = excluded.fetched_at,
           ttl_s = excluded.ttl_s`,
      ).run(providerId, normalizeQuery(query), JSON.stringify(results), now, ttlS)
    },
  }
}

export type SearchStore = ReturnType<typeof createSearchRepository>
