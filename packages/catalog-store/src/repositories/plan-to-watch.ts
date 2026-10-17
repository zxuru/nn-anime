/**
 * La marca de «quiero ver» de una obra.
 *
 * Es la tercera hermana del favorito y de la marca de visto, y comparte sus dos
 * decisiones: la tabla tiene el anime como clave primaria —así que marcar dos
 * veces no puede crear dos filas y la operación se escribe como «dejar en este
 * estado» y no como «insertar»— y marcar un título que no está en la base lanza
 * `StoreError`, porque el caso normal es una obra cuya ficha nadie abrió todavía:
 * eso es un 404, no un 500.
 *
 * Lo que **no** hace, y es lo que la distingue del visionado: no escribe ni un
 * `watch_event`. Querer ver algo no es haberlo visto, y fabricar progreso que
 * nadie hizo ensuciaría la afinidad del motor. Quien la lee para el motor la
 * recibe con la fecha en que se marcó, que es lo que necesita para desempatar.
 *
 * Y **no toca las otras dos marcas**: ver una obra no la saca de aquí ni ponerla
 * aquí la marca como vista. Son tres listas independientes del usuario.
 */

import type { Database } from 'bun:sqlite'
import { type AnimeSummary, type ProviderRef, StoreError, titleKindSchema } from '@nn-anime/core'
import { animeIdOf } from './episodes'

/** Un título pendiente, con la fecha en que se marcó. */
export interface PlanToWatchTitle extends AnimeSummary {
  readonly createdAt: Date
}

interface PlanRow {
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

export function createPlanToWatchRepository(db: Database) {
  return {
    /** `true` deja la obra pendiente; `false` la quita. Idempotente. */
    setPlanToWatch(ref: ProviderRef, value: boolean): void {
      const animeId = animeIdOf(db, ref)
      if (animeId === undefined) {
        throw new StoreError({
          message: `no se puede marcar como pendiente una obra que no está: ${ref.value}`,
          scope: 'catalog-store',
          op: 'setPlanToWatch',
        })
      }

      if (!value) {
        db.query('DELETE FROM plan_to_watch WHERE anime_id = ?').run(animeId)
        return
      }

      db.query(
        'INSERT INTO plan_to_watch (anime_id, created_at) VALUES (?, ?) ON CONFLICT (anime_id) DO NOTHING',
      ).run(animeId, Date.now())
    },

    /**
     * Las obras pendientes, de la más reciente a la más antigua.
     *
     * Una sola consulta con `JOIN`, como la de favoritos y la de vistos: la tabla
     * es pequeña por construcción —una fila por obra marcada— y no hay nada que
     * trocear.
     */
    listPlanToWatch(): readonly PlanToWatchTitle[] {
      const rows = db
        .query<PlanRow, []>(
          `SELECT a.provider_id AS provider_id, a.provider_ref AS provider_ref, a.title AS title,
                  a.cover_url AS cover_url, a.year AS year, a.raw_json AS raw_json,
                  p.created_at AS created_at
             FROM plan_to_watch p
             JOIN anime a ON a.id = p.anime_id
            ORDER BY p.created_at DESC`,
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
          createdAt: new Date(row.created_at),
        }
      })
    },
  }
}

export type PlanToWatchStore = ReturnType<typeof createPlanToWatchRepository>
