/**
 * El estado de visionado de cada episodio de un título.
 *
 * Es lo que convierte la lista de episodios en un índice de lo que queda
 * pendiente: un episodio terminado se marca como visto y uno a medias dice por
 * dónde iba. Se marca el **episodio**, no el par episodio y modo: verlo en
 * subtitulado es haberlo visto, y marcarlo por modo partiría en dos la misma
 * fila de la lista.
 *
 * **Una consulta, no una por episodio**: una temporada de 24 haría 24 viajes a
 * la base para pintar una lista, que es el patrón que el spec del almacén
 * prohíbe. Se ordena por proporción vista y se queda la primera fila de cada
 * número, en memoria.
 *
 * El `finished` guardado y el derivado de la proporción se suman con `O`: una
 * fila escrita antes de que existiera el umbral sigue contando como vista, y el
 * día que haya marca manual —fuera de esta entrega— tampoco se perderá.
 */

import type { Database } from 'bun:sqlite'
import { isFinished, modeSchema, type ProviderRef, StoreError, watchedRatio } from '@nn-anime/core'
import type { WatchedEpisode } from '@nn-anime/core/models'

interface WatchedRow {
  readonly number: number
  readonly mode: string
  readonly position_s: number
  readonly duration_s: number
  readonly started_at: number
  readonly finished: number
}

export function createWatchedEpisodesRepository(db: Database) {
  /**
   * El visionado más avanzado de cada episodio, de mayor a menor.
   *
   * El orden lo hace SQL y no JavaScript para no traer a memoria más de lo que
   * se va a usar; `CASE` porque un `duration_s` a cero dividiría por cero, y el
   * episodio del que no se sabe la duración vale lo mismo que su bandera.
   */
  const select = db.query<WatchedRow, [string, string]>(
    `SELECT e.number AS number, w.mode AS mode, w.position_s, w.duration_s,
            w.started_at, w.finished
       FROM watch_event w
       JOIN episode e ON e.id = w.episode_id
       JOIN anime a ON a.id = w.anime_id
      WHERE a.provider_id = ? AND a.provider_ref = ?
      ORDER BY e.number,
               (CASE WHEN w.duration_s > 0 THEN w.position_s / w.duration_s ELSE w.finished END) DESC,
               w.started_at DESC`,
  )

  return {
    list(animeRef: ProviderRef): readonly WatchedEpisode[] {
      const filas = select.all(animeRef.providerId, animeRef.value)
      const porNumero = new Map<number, WatchedEpisode>()

      for (const fila of filas) {
        // Ya viene la mejor de cada número la primera: repetir la clave sería
        // pisarla con una peor.
        if (porNumero.has(fila.number)) continue

        const modo = modeSchema.safeParse(fila.mode)
        if (!modo.success) {
          throw new StoreError({
            message: `el visionado del episodio ${fila.number} tiene un modo que no existe: ${fila.mode}`,
            scope: 'catalog-store',
            op: 'listWatchedEpisodes',
          })
        }

        porNumero.set(fila.number, {
          number: fila.number,
          mode: modo.data,
          positionS: fila.position_s,
          durationS: fila.duration_s,
          ratio: watchedRatio(fila.position_s, fila.duration_s),
          finished: fila.finished === 1 || isFinished(fila.position_s, fila.duration_s),
          watchedAt: new Date(fila.started_at),
        })
      }

      return [...porNumero.values()]
    },
  }
}

export type WatchedEpisodesStore = ReturnType<typeof createWatchedEpisodesRepository>
