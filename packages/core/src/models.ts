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
  providerCapabilitiesSchema,
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

export type ProviderCapabilities = DeepReadonly<z.infer<typeof providerCapabilitiesSchema>>
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

/**
 * Resumen de un título para listas: favoritos, continuar viendo, tendencias.
 *
 * Es lo que cabe en una tarjeta —ref, título, portada, año y tipo— y no el
 * detalle entero. Guardar el detalle completo para pintar una fila de la home
 * obligaría a leer y descartar sinopsis y episodios que nadie va a mostrar.
 */
export interface AnimeSummary {
  readonly ref: ProviderRef
  readonly title: string
  readonly coverUrl?: string
  readonly year?: number
  readonly kind?: TitleKind
}

/** Una búsqueda registrada, para la lista de recientes. */
export interface SearchRecord {
  readonly query: string
  readonly providerId: string
  readonly hits: number
  readonly searchedAt: Date
}

/**
 * Un visionado, tal como lo devuelve el historial.
 *
 * Lleva el resumen del anime dentro y no sólo su id: la fila «continuar viendo»
 * necesita título y portada, y resolverlo con una consulta por elemento es el
 * N+1 que el spec prohíbe. Se lee en la misma consulta.
 */
export interface WatchRecord {
  readonly id: number
  readonly anime: AnimeSummary
  readonly providerId: string
  readonly episodeNumber: number
  readonly mode: Mode
  readonly positionS: number
  readonly durationS: number
  readonly startedAt: Date
  readonly finished: boolean
}

/** Qué hizo el runner de migraciones, y en qué versión quedó el esquema. */
export interface MigrationReport {
  readonly applied: readonly number[]
  readonly version: number
}

/**
 * Qué borró la limpieza, contado por tabla.
 *
 * Por tabla y no un total: «borré 120 filas» no dice si tocó el historial del
 * usuario o sólo la caché, y esa diferencia es la que importa antes de ejecutar
 * una limpieza sobre datos ajenos.
 */
export interface PruneReport {
  readonly deleted: Readonly<Record<string, number>>
}

/**
 * Clave de una consulta de búsqueda.
 *
 * Vive en `core` porque la usan dos consumidores distintos y la clave tiene que
 * ser **la misma** en los dos: el server la usa para no repetir la consulta a un
 * proveedor, y el store para la caché de resultados. Si cada uno normalizara a
 * su manera, la misma búsqueda ocuparía dos entradas y ninguna acertaría.
 *
 * Las tres cosas juntas porque las tres cambian el resultado de comparar textos
 * que el usuario ve iguales: `" Naruto "` y `"naruto"` son la misma búsqueda, y
 * una `é` compuesta y una descompuesta también.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().normalize('NFC')
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
