/**
 * Validación Zod del contrato de proveedor.
 *
 * Aquí se valida **todo** lo que un plugin entrega: su forma y cada respuesta
 * que devuelve. Un plugin es código de terceros; sus datos son entrada no
 * confiable aunque vengan del mismo proceso.
 *
 * Los schemas de respuesta son los de `core`, extendidos sólo donde hace falta
 * un mensaje mejor. El de headers se sustituye porque el de `core` dice que hay
 * un nombre inválido, y el autor del plugin necesita saber **cuál**: un plugin
 * con veinte headers y un mensaje sin nombre es un plugin que no se puede
 * arreglar.
 */

import {
  animeDetailSchema,
  episodeSchema,
  feedEntrySchema,
  providerCapabilitiesSchema,
  searchResultSchema,
  streamSourceSchema,
} from '@nn-anime/core'
import { z } from 'zod'
import { PROVIDER_API_VERSION, type Provider, type ProviderMethod } from './types'

const HEADER_NAME = /^[A-Za-z0-9-]+$/
const CONTROL_CHARACTERS = /[\r\n\0]/

/** Identificador estable, en minúsculas y con guiones. Ej: 'mi-fuente'. */
export const providerIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: 'el id tiene que ser kebab-case en minúsculas, como `mi-fuente`',
})

/**
 * Un método tiene que ser una función.
 *
 * No se puede comprobar su firma en tiempo de ejecución, sólo que se pueda
 * llamar: la aridad y los tipos se verifican cuando el plugin se escribe, con
 * estos mismos tipos. Aquí se cierra el caso del objeto que declara `search` y
 * no lo implementa.
 */
function methodSchema<M extends ProviderMethod>(name: M) {
  return z.custom<Provider[M]>((value) => typeof value === 'function', {
    message: `${name} no es una función`,
  })
}

/** Se reexporta la de `core`: la misma forma la recibe el navegador en `/api/providers`. */
export { providerCapabilitiesSchema }

/**
 * Forma del objeto que exporta el archivo de un plugin.
 *
 * Es **laxo** a propósito, no estricto: un plugin es un objeto suyo y puede
 * llevar su propio estado —una caché, un cliente HTTP—, y sus métodos pueden
 * usar `this` para llegar a él. Con un objeto estricto, Zod lo descartaría en
 * silencio y el plugin fallaría al llamar a su primer método, con un error que
 * no habla del plugin. La validación comprueba lo que el contrato exige; lo
 * demás es del plugin y se respeta.
 *
 * El literal `apiVersion` fija la versión en el tipo, no sólo en el mensaje.
 */
export const providerSchema = z.looseObject({
  id: providerIdSchema,
  name: z.string().min(1),
  apiVersion: z.literal(PROVIDER_API_VERSION),
  capabilities: providerCapabilitiesSchema,
  search: methodSchema('search'),
  getAnime: methodSchema('getAnime'),
  getEpisodes: methodSchema('getEpisodes'),
  resolveStream: methodSchema('resolveStream'),
  getTrending: methodSchema('getTrending').optional(),
  getFeed: methodSchema('getFeed').optional(),
})

/** Lo que devuelve `providerSchema`. El literal de versión lo hace asignable a `Provider`. */
export type ProviderShape = z.infer<typeof providerSchema>

/**
 * Headers exigidos por el upstream, validados nombrando el header ofensor.
 *
 * El schema de `core` es el que decide qué es válido; éste sólo mejora el
 * mensaje y añade la ruta, para que el problema señale la clave exacta.
 */
export const providerStreamHeadersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `el nombre del header '${name}' sólo admite letras, dígitos y guiones`,
        })
        continue
      }

      if (CONTROL_CHARACTERS.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `el valor del header '${name}' no admite caracteres de control`,
        })
      }
    }
  })

/**
 * Los mismos streams que acepta `core`, pero con el mensaje de headers que
 * nombra al culpable. `extend` conserva el modo estricto del original.
 */
export const providerStreamSourceSchema = streamSourceSchema.extend({
  headers: providerStreamHeadersSchema.optional(),
})

export const providerSearchResultsSchema = z.array(searchResultSchema)
export const providerAnimeDetailSchema = animeDetailSchema
export const providerEpisodesSchema = z.array(episodeSchema)
export const providerStreamSourcesSchema = z.array(providerStreamSourceSchema)
export const providerFeedSchema = z.array(feedEntrySchema)

/**
 * Schema de respuesta por método, en una tabla.
 *
 * Una tabla y no cinco ramas: quien llama a un método busca su schema por
 * nombre, y añadir un método nuevo es añadir una fila.
 */
export const RESPONSE_SCHEMAS = {
  search: providerSearchResultsSchema,
  getAnime: providerAnimeDetailSchema,
  getEpisodes: providerEpisodesSchema,
  resolveStream: providerStreamSourcesSchema,
  getTrending: providerSearchResultsSchema,
  getFeed: providerFeedSchema,
} as const

/** Lo que devuelve un método, derivado de su schema: no se escribe a mano. */
export type ProviderResponse<M extends ProviderMethod> = z.infer<(typeof RESPONSE_SCHEMAS)[M]>
