/**
 * Schemas Zod del modelo de dominio.
 *
 * Este archivo es la fuente de verdad de las formas: los tipos de `models.ts`
 * se derivan de aquí, así que no pueden desincronizarse.
 *
 * Todos los objetos son estrictos: una clave desconocida es un rechazo, no algo
 * que se ignora en silencio. En una respuesta de proveedor, una clave de más es
 * o un error del plugin o un cambio de contrato, y en ambos casos conviene
 * enterarse.
 */

import { z } from 'zod'

const HEADER_NAME = /^[A-Za-z0-9-]+$/
const CONTROL_CHARACTERS = /[\r\n\0]/

export const modeSchema = z.enum(['sub', 'dub', 'raw'])
export const streamModeSchema = z.enum(['sub', 'dub'])
export const titleKindSchema = z.enum(['tv', 'movie', 'ova', 'ona', 'special'])
export const airingStatusSchema = z.enum(['airing', 'finished', 'upcoming', 'unknown'])
export const subtitleFormatSchema = z.enum(['vtt', 'srt', 'ass'])
export const streamKindSchema = z.enum(['hls', 'file'])

/** Referencia opaca a un título dentro de un proveedor. */
export const providerRefSchema = z.strictObject({
  providerId: z.string().min(1),
  value: z.string().min(1),
})

export const subtitleTrackSchema = z.strictObject({
  lang: z.string().min(1),
  label: z.string().min(1),
  url: z.string().min(1),
  format: subtitleFormatSchema,
  default: z.boolean().optional(),
})

/**
 * Headers que el upstream exige. Se validan aquí, en la frontera, para que
 * ningún valor sin validar pueda llegar al proxy ni a la línea de comandos de
 * mpv: un salto de línea inyectaría una cabecera adicional.
 */
export const streamHeadersSchema = z.record(
  z.string().regex(HEADER_NAME, 'el nombre del header sólo admite letras, dígitos y guiones'),
  z.string().refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: 'el valor del header no admite caracteres de control',
  }),
)

export const streamSourceSchema = z.strictObject({
  url: z.string().min(1),
  kind: streamKindSchema,
  quality: z.string().min(1).optional(),
  headers: streamHeadersSchema.optional(),
  subtitles: z.array(subtitleTrackSchema).optional(),
})

export const searchResultSchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  titleAlt: z.string().min(1).optional(),
  coverUrl: z.string().min(1).optional(),
  year: z.number().int().optional(),
  kind: titleKindSchema.optional(),
})

export const animeDetailSchema = searchResultSchema.extend({
  synopsis: z.string().optional(),
  status: airingStatusSchema.optional(),
  episodeCount: z.number().int().nonnegative().optional(),
  genres: z.array(z.string().min(1)),
  studios: z.array(z.string().min(1)),
})

export const episodeSchema = z.strictObject({
  ref: providerRefSchema,
  animeRef: providerRefSchema,
  number: z.number().int().nonnegative(),
  title: z.string().min(1).optional(),
  durationS: z.number().nonnegative().optional(),
  mode: modeSchema,
})

export const streamRequestSchema = z.strictObject({
  episodeRef: providerRefSchema,
  mode: streamModeSchema,
  preferredQuality: z.string().min(1).optional(),
})

export const watchEventInputSchema = z.strictObject({
  animeRef: providerRefSchema,
  episodeRef: providerRefSchema,
  mode: modeSchema,
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  startedAt: z.date(),
})

export const candidateSchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  tags: z.array(z.string().min(1)),
  year: z.number().int().optional(),
  studios: z.array(z.string().min(1)),
  /** Popularidad normalizada dentro del proveedor, de 0 a 1. */
  popularity: z.number().min(0).max(1).optional(),
  coverUrl: z.string().min(1).optional(),
})

/** Schema de un acierto de caché, parametrizado por el schema del valor. */
export function cacheHitSchema<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value,
    fetchedAt: z.date(),
    stale: z.boolean(),
    ttlS: z.number().int().nonnegative(),
  })
}
