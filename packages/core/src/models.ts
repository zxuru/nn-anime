/**
 * Tipos públicos del dominio, derivados de los schemas.
 *
 * Se derivan en lugar de escribirse a mano para que no puedan divergir de la
 * validación. `DeepReadonly` añade la inmutabilidad que el estilo del proyecto
 * exige: nada de lo que sale de una frontera se modifica en su lugar.
 */

import type { z } from 'zod'
import type {
  airingStatusSchema,
  animeDetailSchema,
  candidateSchema,
  episodeSchema,
  modeSchema,
  providerRefSchema,
  searchResultSchema,
  streamModeSchema,
  streamRequestSchema,
  streamSourceSchema,
  subtitleFormatSchema,
  subtitleTrackSchema,
  titleKindSchema,
  watchEventInputSchema,
} from './schema'

/** Inmutabilidad profunda. `Date` y los primitivos se conservan tal cual. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends Date
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T

export type Mode = z.infer<typeof modeSchema>
export type StreamMode = z.infer<typeof streamModeSchema>
export type TitleKind = z.infer<typeof titleKindSchema>
export type AiringStatus = z.infer<typeof airingStatusSchema>
export type SubtitleFormat = z.infer<typeof subtitleFormatSchema>

export type ProviderRef = DeepReadonly<z.infer<typeof providerRefSchema>>
export type SubtitleTrack = DeepReadonly<z.infer<typeof subtitleTrackSchema>>
export type StreamSource = DeepReadonly<z.infer<typeof streamSourceSchema>>
export type SearchResult = DeepReadonly<z.infer<typeof searchResultSchema>>
export type AnimeDetail = DeepReadonly<z.infer<typeof animeDetailSchema>>
export type Episode = DeepReadonly<z.infer<typeof episodeSchema>>
export type StreamRequest = DeepReadonly<z.infer<typeof streamRequestSchema>>
export type WatchEventInput = DeepReadonly<z.infer<typeof watchEventInputSchema>>
export type Candidate = DeepReadonly<z.infer<typeof candidateSchema>>

/**
 * Forma de un stream tal como puede salir del proceso hacia el cliente web.
 *
 * `headers` no existe en este tipo, y ésa es la garantía: el compilador impide
 * que un header de upstream se filtre por descuido. Es la única frontera del
 * sistema donde vive esa información.
 */
export type PublicStreamSource = Omit<StreamSource, 'headers'>

export interface CacheHit<T> {
  readonly value: T
  readonly fetchedAt: Date
  /** Verdadero cuando el TTL venció pero el dato sigue siendo servible. */
  readonly stale: boolean
  readonly ttlS: number
}

/** Quita los headers de un stream. Las claves ausentes no se incluyen. */
export function toPublicStreamSource(source: StreamSource): PublicStreamSource {
  return {
    url: source.url,
    kind: source.kind,
    ...(source.quality === undefined ? {} : { quality: source.quality }),
    ...(source.subtitles === undefined ? {} : { subtitles: source.subtitles }),
  }
}
