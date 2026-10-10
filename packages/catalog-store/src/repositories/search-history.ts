/**
 * Búsquedas recientes.
 *
 * Es un registro, no una caché: cada búsqueda añade una fila con su número de
 * aciertos, y la caché de resultados vive en `search_cache`, con su propia clave
 * normalizada. Mezclarlas obligaría a decidir qué hacer cuando el usuario busca
 * lo mismo dos veces —¿una fila o dos?— y la respuesta es distinta en cada caso:
 * para el historial son dos, y para la caché es una.
 *
 * La consulta se guarda **tal como la escribió el usuario**, sin normalizar. La
 * clave de caché se normaliza porque tiene que coincidir; el historial se lee, y
 * ahí «Naruto» y «naruto» son lo que la persona escribió.
 */

import type { Database } from 'bun:sqlite'
import { type SearchRecord, StoreError } from '@nn-anime/core'

interface SearchHistoryRow {
  readonly query: string
  readonly provider_id: string
  readonly hits: number
  readonly created_at: number
}

export function createSearchHistoryRepository(db: Database, now: () => number = Date.now) {
  return {
    recordSearch(query: string, providerId: string, hits: number): void {
      if (!Number.isInteger(hits) || hits < 0) {
        throw new StoreError({
          message: `los aciertos de una búsqueda tienen que ser un entero no negativo, no ${hits}`,
          scope: 'catalog-store',
          op: 'recordSearch',
        })
      }

      db.query(
        'INSERT INTO search_history (query, provider_id, hits, created_at) VALUES (?, ?, ?, ?)',
      ).run(query, providerId, hits, now())
    },

    listRecentSearches(limit: number): readonly SearchRecord[] {
      const rows = db
        .query<SearchHistoryRow, [number]>(
          `SELECT query, provider_id, hits, created_at
             FROM search_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
        )
        .all(limit)

      return rows.map((row) => ({
        query: row.query,
        providerId: row.provider_id,
        hits: row.hits,
        searchedAt: new Date(row.created_at),
      }))
    },
  }
}

export type SearchHistoryStore = ReturnType<typeof createSearchHistoryRepository>
