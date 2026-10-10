/**
 * Favoritos.
 *
 * Marcar dos veces el mismo título **no puede** crear dos filas: la clave
 * primaria de la tabla es el anime, así que el esquema ya lo impide, pero la
 * operación se escribe igualmente como «dejar en este estado» en lugar de
 * «insertar»: un botón que se pulsa dos veces es lo normal, no la excepción, y
 * un `insert` que falla por clave duplicada convertiría eso en un error.
 */

import type { Database } from 'bun:sqlite'
import { type AnimeSummary, type ProviderRef, StoreError, titleKindSchema } from '@nn-anime/core'
import { animeIdOf } from './episodes'

interface FavoriteRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly raw_json: string | null
}

function kindOf(raw: string | null): AnimeSummary['kind'] {
  if (raw === null) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) return undefined

    const kind = titleKindSchema.safeParse(parsed.kind)

    return kind.success ? kind.data : undefined
  } catch {
    return undefined
  }
}

export function createFavoritesRepository(db: Database) {
  return {
    /** `true` deja el título en favoritos; `false` lo saca. Idempotente. */
    setFavorite(ref: ProviderRef, value: boolean): void {
      const animeId = animeIdOf(db, ref)
      if (animeId === undefined) {
        throw new StoreError({
          message: `no se puede marcar como favorito un anime que no está: ${ref.value}`,
          scope: 'catalog-store',
          op: 'setFavorite',
        })
      }

      if (!value) {
        db.query('DELETE FROM favorite WHERE anime_id = ?').run(animeId)
        return
      }

      db.query(
        'INSERT INTO favorite (anime_id, created_at) VALUES (?, ?) ON CONFLICT (anime_id) DO NOTHING',
      ).run(animeId, Date.now())
    },

    listFavorites(): readonly AnimeSummary[] {
      const rows = db
        .query<FavoriteRow, []>(
          `SELECT a.provider_id AS provider_id, a.provider_ref AS provider_ref, a.title AS title,
                  a.cover_url AS cover_url, a.year AS year, a.raw_json AS raw_json
             FROM favorite f
             JOIN anime a ON a.id = f.anime_id
            ORDER BY f.created_at DESC`,
        )
        .all()

      return rows.map((row) => {
        const kind = kindOf(row.raw_json)

        return {
          ref: { providerId: row.provider_id, value: row.provider_ref },
          title: row.title,
          ...(row.cover_url === null ? {} : { coverUrl: row.cover_url }),
          ...(row.year === null ? {} : { year: row.year }),
          ...(kind === undefined ? {} : { kind }),
        }
      })
    },
  }
}

export type FavoritesStore = ReturnType<typeof createFavoritesRepository>
