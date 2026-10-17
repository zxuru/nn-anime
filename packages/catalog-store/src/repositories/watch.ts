/**
 * Historial de visionado y progreso.
 *
 * `recordWatch` abre una fila y `updateWatchPosition` la mueve. Son dos
 * operaciones distintas a propósito: el reproductor informa cada quince segundos,
 * y con un `insert` por informe el historial tendría cuatro filas por minuto del
 * mismo episodio. Aquí se escribe una vez al empezar y se actualiza después, que
 * es lo que hace que «seguir viendo» muestre un episodio y no catorce.
 *
 * La lista se lee en **una consulta** con `JOIN`, no una por fila: el spec lo
 * prohíbe expresamente, y es el error clásico de esta pantalla —veinte filas,
 * veinte consultas, y una home que tarda un segundo con una base diminuta—.
 */

import type { Database } from 'bun:sqlite'
import {
  type AnimeSummary,
  isFinished,
  modeSchema,
  type ProviderRef,
  StoreError,
  titleKindSchema,
  type WatchEventInput,
  type WatchRecord,
} from '@nn-anime/core'
import { animeIdOf, episodeIdOf } from './episodes'

interface WatchRow {
  readonly id: number
  readonly provider_id: string
  readonly mode: string
  readonly position_s: number
  readonly duration_s: number
  readonly started_at: number
  readonly finished: number
  readonly episode_number: number
  readonly anime_provider: string
  readonly anime_ref: string
  readonly title: string
  readonly cover_url: string | null
  readonly year: number | null
  readonly raw_json: string | null
}

/**
 * El tipo de título, que está en `raw_json` y no en una columna.
 *
 * Se valida con el schema en vez de confiar en lo que haya en el JSON: un valor
 * raro en la base no puede convertirse en un `kind` que la interfaz no sepa
 * pintar. Y un `raw_json` ilegible tampoco puede impedir mostrar la fila: el
 * campo es opcional y la alternativa sería perder el historial entero.
 */
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

function toRecord(row: WatchRow): WatchRecord {
  const mode = modeSchema.safeParse(row.mode)
  if (!mode.success) {
    throw new StoreError({
      message: `el visionado ${row.id} tiene un modo que no existe: ${row.mode}`,
      scope: 'catalog-store',
      op: 'listRecentlyWatched',
    })
  }

  const kind = kindOf(row.raw_json)

  return {
    id: row.id,
    anime: {
      ref: { providerId: row.anime_provider, value: row.anime_ref },
      title: row.title,
      ...(row.cover_url === null ? {} : { coverUrl: row.cover_url }),
      ...(row.year === null ? {} : { year: row.year }),
      ...(kind === undefined ? {} : { kind }),
    },
    providerId: row.provider_id,
    episodeNumber: row.episode_number,
    mode: mode.data,
    positionS: row.position_s,
    durationS: row.duration_s,
    startedAt: new Date(row.started_at),
    finished: row.finished === 1,
  }
}

/**
 * La proyección de un visionado con los datos del anime.
 *
 * Va en una constante porque la leen **dos** consultas —la de «continuar viendo»
 * y la del historial— y tienen que devolver exactamente la misma forma: con dos
 * copias, añadir una columna a una sola daría dos `WatchRecord` distintos según
 * por dónde se llegue, y el que se dejara atrás saldría con un campo en `undefined`
 * sin que nada avisara.
 *
 * El `JOIN` es lo que evita el N+1 que el spec prohíbe: veinte filas son una
 * consulta, no veinte.
 */
const WATCH_SELECT = `SELECT w.id AS id, w.provider_id AS provider_id, w.mode AS mode,
                             w.position_s AS position_s, w.duration_s AS duration_s,
                             w.started_at AS started_at, w.finished AS finished,
                             e.number AS episode_number,
                             a.provider_id AS anime_provider, a.provider_ref AS anime_ref,
                             a.title AS title, a.cover_url AS cover_url, a.year AS year,
                             a.raw_json AS raw_json
                        FROM watch_event w
                        JOIN episode e ON e.id = w.episode_id
                        JOIN anime a ON a.id = w.anime_id`

export function createWatchRepository(db: Database) {
  const episodeLookup = (ref: ProviderRef): number | undefined => episodeIdOf(db, ref)

  return {
    /**
     * Abre una fila de visionado y devuelve su identificador.
     *
     * El contrato dice `Promise<void>`, pero el identificador es necesario: la
     * ruta que registra el inicio de la reproducción tiene que devolverlo para
     * que el reproductor pueda actualizar la posición después. Devolverlo es
     * aditivo; quien no lo mire, no lo ve.
     */
    recordWatch(event: WatchEventInput): number {
      const animeId = animeIdOf(db, event.animeRef)
      if (animeId === undefined) {
        throw new StoreError({
          message: `no se puede registrar un visionado de un anime que no está: ${event.animeRef.value}`,
          scope: 'catalog-store',
          op: 'recordWatch',
        })
      }

      const episodeId = episodeLookup(event.episodeRef)
      if (episodeId === undefined) {
        throw new StoreError({
          message: `no se puede registrar un visionado de un episodio que no está: ${event.episodeRef.value}`,
          scope: 'catalog-store',
          op: 'recordWatch',
        })
      }

      db.query(
        `INSERT INTO watch_event
           (anime_id, episode_id, provider_id, mode, position_s, duration_s, started_at, finished)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(
        animeId,
        episodeId,
        event.animeRef.providerId,
        event.mode,
        event.positionS,
        event.durationS,
        event.startedAt.getTime(),
      )

      const row = db.query<{ id: number }, []>('SELECT last_insert_rowid() AS id').get()

      return row?.id ?? 0
    },

    /**
     * Mueve la fila indicada. No crea ninguna.
     *
     * `finished` se escribe aquí y no en una ruta aparte: la proporción vista
     * sólo se conoce en el momento de guardar la posición, y calcularla después
     * obligaría a releer todas las filas para marcarlas. El umbral vive en
     * `core` porque lo lee también la interfaz que pinta el episodio.
     */
    updateWatchPosition(eventId: number, positionS: number, durationS: number): void {
      const resultado = db
        .query('UPDATE watch_event SET position_s = ?, duration_s = ?, finished = ? WHERE id = ?')
        .run(positionS, durationS, isFinished(positionS, durationS) ? 1 : 0, eventId)

      if (resultado.changes === 0) {
        throw new StoreError({
          message: `no hay ningún visionado con el identificador ${eventId}`,
          scope: 'catalog-store',
          op: 'updateWatchPosition',
        })
      }
    },

    /**
     * Lo visto hace poco, con los datos del anime en la misma consulta.
     *
     * Una fila por visionado, no por actualización: el progreso se mueve en su
     * sitio, así que el mismo episodio aparece una sola vez.
     */
    listRecentlyWatched(limit: number): readonly WatchRecord[] {
      const rows = db
        .query<WatchRow, [number]>(
          `${WATCH_SELECT}
            ORDER BY w.started_at DESC
            LIMIT ?`,
        )
        .all(limit)

      return rows.map(toRecord)
    },

    /**
     * El historial, por páginas.
     *
     * Es la misma consulta que `listRecentlyWatched` con un desplazamiento, y va
     * aparte **a propósito**: aquélla alimenta la fila «continuar viendo» y es
     * señal de afinidad del motor, así que no se le puede cambiar la semántica
     * —ni el tope, ni el orden, ni el troceado— para servir una pantalla nueva.
     * Aquí no se agrupa por episodio ni se descarta lo terminado: el historial
     * cuenta **lo que pasó**, y que un episodio se reprodujera dos veces son dos
     * renglones, no uno.
     *
     * El desplazamiento y no un cursor porque el orden es por fecha de inicio y el
     * historial se escribe por detrás: una página que se desplaza sola mientras se
     * mira es peor que un salto entre páginas, y el usuario está mirando lo que ya
     * tiene delante.
     */
    listWatchHistory(limit: number, offset: number): readonly WatchRecord[] {
      const rows = db
        .query<WatchRow, [number, number]>(
          `${WATCH_SELECT}
            ORDER BY w.started_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(limit, offset)

      return rows.map(toRecord)
    },
  }
}

export type WatchStore = ReturnType<typeof createWatchRepository>
