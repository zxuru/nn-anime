/**
 * Caché de URLs de stream.
 *
 * Tres reglas que no son las de los metadatos:
 *
 * 1. **El TTL es corto (600 s) y no hay dato stale.** Un enlace de video caduca
 *    de verdad: servir uno de hace media hora no es «un poco viejo», es un 403
 *    del upstream en mitad de la reproducción. Por eso `readStream` devuelve
 *    `null` en cuanto vence —no un `CacheHit` con `stale: true`— y la ruta que
 *    lo use revalidará antes de reproducir.
 * 2. **Los headers del upstream no se guardan.** La fila lleva URL, tipo,
 *    calidad y subtítulos, y nada más. Los headers viven en la memoria del
 *    proceso (`media-proxy`), que es lo que dice la mitigación 6: en disco
 *    serían cookies y tokens de un tercero en claro, y caducan igual que la URL.
 *    Aquí no hay columna donde ponerlos, así que no hay forma de que se cuelen
 *    por descuido.
 * 3. **Se cachea una sola fuente**, la que el llamador elija (o la primera que
 *    devolvió el proveedor, que es su propio orden de preferencia). La clave es
 *    (episodio, modo), así que el esquema admite una fila por par; guardar la
 *    lista entera necesitaría otra tabla y el contrato no la pide.
 */

import type { Database } from 'bun:sqlite'
import {
  type ProviderRef,
  StoreError,
  type StreamMode,
  type StreamRequest,
  type StreamSource,
  streamSourceSchema,
  subtitleTrackSchema,
} from '@nn-anime/core'
import { z } from 'zod'
import { TTL_SECONDS } from '../cache-policy'
import { episodeIdOf } from './episodes'

const SUBTITLES = z.array(subtitleTrackSchema)

interface StreamRow {
  readonly url: string
  readonly kind: string
  readonly quality: string | null
  readonly subtitles_json: string | null
  readonly fetched_at: number
  readonly ttl_s: number
}

/**
 * La fuente que se guarda.
 *
 * Manda la calidad pedida; si no hay ninguna que coincida, la **primera** que
 * devolvió el proveedor, que es su orden de preferencia y no el nuestro.
 * Inventar aquí una preferencia por `hls` sobre `file` sería una decisión de
 * reproducción tomada en la capa de persistencia.
 */
export function chooseSource(
  request: StreamRequest,
  sources: readonly StreamSource[],
): StreamSource | undefined {
  if (sources.length === 0) return undefined

  const pedida = request.preferredQuality
  if (pedida !== undefined) {
    const coincide = sources.find((source) => source.quality === pedida)
    if (coincide !== undefined) return coincide
  }

  return sources[0]
}

function parseSource(row: StreamRow, ref: ProviderRef, mode: StreamMode): StreamSource {
  const subtitles =
    row.subtitles_json === null ? undefined : SUBTITLES.safeParse(JSON.parse(row.subtitles_json))

  if (subtitles !== undefined && !subtitles.success) {
    throw new StoreError({
      message: `los subtítulos cacheados de ${ref.value}/${mode} no cumplen el schema: ${subtitles.error.message}`,
      scope: 'catalog-store',
      op: 'readStream',
    })
  }

  const parsed = streamSourceSchema.safeParse({
    url: row.url,
    kind: row.kind,
    ...(row.quality === null ? {} : { quality: row.quality }),
    ...(subtitles === undefined || !subtitles.success ? {} : { subtitles: subtitles.data }),
  })

  if (!parsed.success) {
    throw new StoreError({
      message: `el stream cacheado de ${ref.value}/${mode} no cumple el schema: ${parsed.error.message}`,
      scope: 'catalog-store',
      op: 'readStream',
    })
  }

  // `parsed.data` nunca lleva headers: el schema no los lee de la fila y la fila
  // no los tiene. La forma pública se cumple por construcción.
  return parsed.data
}

export function createStreamRepository(db: Database, ttlS: number = TTL_SECONDS.stream) {
  const select = db.query<StreamRow, [number, string]>(
    `SELECT url, kind, quality, subtitles_json, fetched_at, ttl_s
       FROM stream_cache WHERE episode_id = ? AND mode = ?`,
  )

  return {
    /** `null` si no hay fila **o si el TTL venció**: un enlace viejo no sirve. */
    read(episodeRef: ProviderRef, mode: StreamMode, now: number = Date.now()): StreamSource | null {
      const episodeId = episodeIdOf(db, episodeRef)
      if (episodeId === undefined) return null

      const row = select.get(episodeId, mode)
      if (row === null) return null
      if (row.fetched_at + row.ttl_s * 1000 <= now) return null

      return parseSource(row, episodeRef, mode)
    },

    /**
     * Guarda la fuente elegida. Una lista vacía no escribe nada: no hay fuente
     * que cachear, y fingir una fila con URL vacía rompería el schema al leerla.
     *
     * Los headers de la fuente se descartan aquí, en el único sitio donde la
     * fuente entra: no hay ningún camino por el que puedan llegar a la fila.
     */
    write(
      request: StreamRequest,
      sources: readonly StreamSource[],
      now: number = Date.now(),
    ): void {
      const source = chooseSource(request, sources)
      if (source === undefined) return

      const episodeId = episodeIdOf(db, request.episodeRef)
      if (episodeId === undefined) {
        throw new StoreError({
          message: `no se puede guardar el stream de un episodio que no está: ${request.episodeRef.value}`,
          scope: 'catalog-store',
          op: 'writeStream',
        })
      }

      db.query(
        `INSERT INTO stream_cache (episode_id, mode, url, kind, quality, subtitles_json, fetched_at, ttl_s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (episode_id, mode) DO UPDATE SET
           url = excluded.url,
           kind = excluded.kind,
           quality = excluded.quality,
           subtitles_json = excluded.subtitles_json,
           fetched_at = excluded.fetched_at,
           ttl_s = excluded.ttl_s`,
      ).run(
        episodeId,
        request.mode,
        source.url,
        source.kind,
        source.quality ?? null,
        source.subtitles === undefined ? null : JSON.stringify(source.subtitles),
        now,
        ttlS,
      )
    },

    /** Borra la clave indicada y sólo esa. */
    invalidateStream(episodeRef: ProviderRef, mode: StreamMode): number {
      const episodeId = episodeIdOf(db, episodeRef)
      if (episodeId === undefined) return 0

      return db
        .query('DELETE FROM stream_cache WHERE episode_id = ? AND mode = ?')
        .run(episodeId, mode).changes
    },
  }
}

export type StreamStore = ReturnType<typeof createStreamRepository>
