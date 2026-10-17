/**
 * La marca de «ya visto» de una obra.
 *
 * Es la hermana del favorito y comparte sus dos decisiones: la tabla tiene el
 * anime como clave primaria —así que marcar dos veces no puede crear dos filas y
 * la operación se escribe como «dejar en este estado» y no como «insertar»— y
 * marcar un título que no está en la base lanza `StoreError`, porque el caso
 * normal es una obra cuya ficha nadie abrió todavía: eso es un 404, no un 500.
 *
 * Lo que **no** hace, y es lo que la distingue del visionado: no escribe ni un
 * `watch_event`. La marca es de la obra y no resume episodios; quien la lee para
 * el motor la recibe con la fecha en que se marcó, que es lo que necesita para
 * desempatar.
 */

import type { Database } from 'bun:sqlite'
import { type AnimeSummary, type ProviderRef, StoreError, titleKindSchema } from '@nn-anime/core'
import { animeIdOf } from './episodes'

/** Un título marcado, con la fecha en que se marcó. */
export interface WatchedTitle extends AnimeSummary {
  readonly watchedAt: Date
}

interface WatchedRow {
  readonly provider_id: string
  readonly provider_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly raw_json: string | null
  readonly created_at: number
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

export function createWatchedTitlesRepository(db: Database) {
  return {
    /** `true` deja la obra como vista; `false` la quita. Idempotente. */
    setWatchedTitle(ref: ProviderRef, value: boolean): void {
      const animeId = animeIdOf(db, ref)
      if (animeId === undefined) {
        throw new StoreError({
          message: `no se puede marcar como vista una obra que no está: ${ref.value}`,
          scope: 'catalog-store',
          op: 'setWatchedTitle',
        })
      }

      if (!value) {
        db.query('DELETE FROM watched_title WHERE anime_id = ?').run(animeId)
        return
      }

      db.query(
        'INSERT INTO watched_title (anime_id, created_at) VALUES (?, ?) ON CONFLICT (anime_id) DO NOTHING',
      ).run(animeId, Date.now())
    },

    /**
     * Las obras marcadas, de la más reciente a la más antigua.
     *
     * Una sola consulta con `JOIN`, como la de favoritos: la tabla es pequeña por
     * construcción —una fila por obra marcada— y no hay nada que trocear.
     */
    listWatchedTitles(): readonly WatchedTitle[] {
      const rows = db
        .query<WatchedRow, []>(
          `SELECT a.provider_id AS provider_id, a.provider_ref AS provider_ref, a.title AS title,
                  a.cover_url AS cover_url, a.year AS year, a.raw_json AS raw_json,
                  w.created_at AS created_at
             FROM watched_title w
             JOIN anime a ON a.id = w.anime_id
            ORDER BY w.created_at DESC`,
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
          watchedAt: new Date(row.created_at),
        }
      })
    },
  }
}

export type WatchedTitlesStore = ReturnType<typeof createWatchedTitlesRepository>
