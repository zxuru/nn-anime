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

/** Esquemas de URL admitidos en cualquier dato que venga de un proveedor. */
const ALLOWED_URL_SCHEMES: readonly string[] = ['http:', 'https:']

const SPACE_CODE = 0x20
const DELETE_CODE = 0x7f

/**
 * Si la dirección lleva un espacio o un carácter de control.
 *
 * Un espacio o un carácter de control no se escribe en una URL: se codifica.
 * `new URL` los descarta o los normaliza, así que una cadena que los lleve **no
 * es la dirección que se va a pedir**. Validar una cosa y pedir otra es el
 * hueco que este esquema cierra. Se recorre la cadena en vez de usar una
 * expresión regular porque el linter del proyecto prohíbe los caracteres de
 * control literales dentro de un patrón.
 */
function hasBlankOrControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= SPACE_CODE || code === DELETE_CODE) return true
  }

  return false
}

/**
 * Autoridad explícita: al esquema le sigue `//`.
 *
 * Sin esto, `http:/x` pasa la validación y `new URL` lo convierte en
 * `http://x/`: la cadena guardada y la pedida nombran sitios distintos.
 */
const EXPLICIT_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

/**
 * Dirección web, validada en el esquema.
 *
 * `z.string().min(1)` dejaba pasar `javascript:` o `data:`. La regla del
 * proyecto es que el esquema se valida **en la frontera**, y la frontera es
 * este archivo: si la comprobación viviera sólo en la interfaz, cualquier
 * consumidor nuevo de estos tipos —el reproductor, un exportador, un test—
 * volvería a abrir el agujero. Aquí se cierra para todos.
 *
 * Las credenciales se rechazan: `stream_cache` persiste la dirección, y unas
 * credenciales del upstream acabarían en disco en claro, que es lo que el
 * `Never` del catálogo prohíbe para los headers.
 */
export const httpUrlSchema = z
  .string()
  .min(1)
  .refine((value) => !hasBlankOrControl(value), {
    message: 'la dirección no admite espacios ni caracteres de control',
  })
  .refine((value) => EXPLICIT_AUTHORITY.test(value) && isWebUrl(value), {
    message: 'la dirección tiene que ser http o https, con host',
  })
  .refine((value) => !hasCredentials(value), {
    message: 'la dirección no admite usuario ni contraseña',
  })

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ALLOWED_URL_SCHEMES.includes(url.protocol) && url.host !== ''
  } catch {
    return false
  }
}

function hasCredentials(value: string): boolean {
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

/**
 * Lo que un proveedor dice saber hacer.
 *
 * Vive aquí y no en `provider-sdk` porque también cruza el HTTP: la interfaz
 * recibe las capacidades en `/api/providers`. Dos definiciones de la misma forma,
 * una para el plugin y otra para la respuesta, es exactamente el tipo de deriva
 * que no da error de compilación.
 */
export const providerCapabilitiesSchema = z.strictObject({
  search: z.boolean(),
  sub: z.boolean(),
  dub: z.boolean(),
  trending: z.boolean(),
  /**
   * El proveedor publica novedades que no dependen de una búsqueda.
   *
   * Con valor por defecto y no obligatorio: este schema es estricto y lo leen los
   * manifiestos de plugins **ya instalados**. Un campo requerido nuevo los
   * rechazaría a todos al cargar, por una función que su autor no pidió.
   */
  feed: z.boolean().default(false),
})

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
  url: httpUrlSchema,
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
  url: httpUrlSchema,
  kind: streamKindSchema,
  quality: z.string().min(1).optional(),
  headers: streamHeadersSchema.optional(),
  subtitles: z.array(subtitleTrackSchema).optional(),
})

export const searchResultSchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  titleAlt: z.string().min(1).optional(),
  coverUrl: httpUrlSchema.optional(),
  year: z.number().int().optional(),
  kind: titleKindSchema.optional(),
})

/**
 * Una entrada de la lista de novedades de una fuente.
 *
 * Es un `SearchResult` con fecha, y la fecha es la razón de que exista: un feed
 * sabe **cuándo** publicó algo y una búsqueda no. Va en ISO-8601 y como cadena, no
 * como `Date`, porque el dato cruza JSON tres veces —el manifiesto del plugin, la
 * caché en disco y la respuesta HTTP— y un `Date` se convierte en cadena por el
 * camino y volvería como cadena igual: el tipo estaría mintiendo.
 */
export const feedEntrySchema = searchResultSchema.extend({
  publishedAt: z.iso.datetime().optional(),
})

export const animeDetailSchema = searchResultSchema.extend({
  synopsis: z.string().optional(),
  status: airingStatusSchema.optional(),
  episodeCount: z.number().int().nonnegative().optional(),
  genres: z.array(z.string().min(1)),
  studios: z.array(z.string().min(1)),
})

/**
 * Resumen de un título para listas.
 *
 * Tiene schema propio, y no es un `SearchResult` recortado, porque es lo que
 * viaja en las listas de favoritos y de «continuar viendo»: la interfaz lo
 * valida al recibirlo, así que tiene que existir en la frontera y no sólo como
 * tipo escrito a mano.
 */
export const animeSummarySchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  coverUrl: httpUrlSchema.optional(),
  year: z.number().int().optional(),
  kind: titleKindSchema.optional(),
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
  coverUrl: httpUrlSchema.optional(),
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
