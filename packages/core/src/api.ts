/**
 * Contrato HTTP: las formas que cruzan la frontera entre el server y la interfaz.
 *
 * Viven aquí, en `core`, y no en cada lado, porque son **la misma forma**. El
 * server las usa para construir y la interfaz para validar; con dos definiciones
 * paralelas, un campo renombrado en el server no da error de compilación —da un
 * `ApiShapeError` en el navegador, tres capas más lejos de la causa.
 *
 * Cada respuesta es estricta: una clave de más es un error, no algo que se
 * ignora. Un campo nuevo que nadie declaró es o un error del server o un cambio
 * de contrato, y en ambos casos conviene enterarse en la frontera.
 */

import { z } from 'zod'
import {
  animeDetailSchema,
  animeSummarySchema,
  episodeSchema,
  httpUrlSchema,
  modeSchema,
  providerCapabilitiesSchema,
  providerRefSchema,
  searchResultSchema,
  streamRequestSchema,
  titleKindSchema,
} from './schema'

/** Estado de carga de un plugin. */
export const providerStatusSchema = z.enum(['active', 'rejected'])

/**
 * Un proveedor tal como lo ve la interfaz.
 *
 * `capabilities` va entero aunque la interfaz hoy sólo mire `sub` y `dub`:
 * recortarlo obligaría a cambiar el contrato el día que la interfaz quiera
 * mostrar si un proveedor sabe buscar o traer tendencias.
 */
export const providerSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  capabilities: providerCapabilitiesSchema,
  status: providerStatusSchema,
  /** Motivo del rechazo, sólo cuando no cargó. */
  reason: z.string().min(1).optional(),
})

/** Un rechazo, en una línea que la interfaz pueda mostrar. */
export const errorResponseSchema = z.strictObject({
  error: z.string().min(1),
})

export const healthResponseSchema = z.strictObject({
  version: z.string().min(1),
  port: z.number().int(),
  mpv: z.boolean(),
  providers: z.array(providerSummarySchema),
})

export const providersResponseSchema = z.strictObject({
  providers: z.array(providerSummarySchema),
})

/**
 * Ruta de un endpoint, dentro de un proveedor declarativo.
 *
 * Se exige que sea **relativa**: una ruta absoluta dentro de la plantilla
 * apuntaría a un sitio distinto del de la dirección base, y el formulario
 * dejaría de describir un proveedor para describir dos. Los caracteres de
 * control se rechazan aquí porque esta cadena acaba dentro de una URL y de un
 * archivo.
 */
const endpointTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes('://'), {
    message: 'la ruta tiene que ser relativa a la dirección base',
  })
  .refine((value) => !/[\r\n\0]/.test(value), {
    message: 'la ruta no admite caracteres de control',
  })

const queryTemplateSchema = endpointTemplateSchema.refine((value) => value.includes('{query}'), {
  message: 'falta el marcador {query}',
})

const refTemplateSchema = endpointTemplateSchema.refine((value) => value.includes('{ref}'), {
  message: 'falta el marcador {ref}',
})

/**
 * Dónde vive cada dato dentro del JSON del sitio.
 *
 * Es una ruta con puntos (`data.items`) y la cadena vacía significa «el valor
 * mismo»: la raíz, para una respuesta que ya es la lista. Se admiten estos
 * nombres y no un JSON Pointer porque lo que se escribe aquí lo teclea una
 * persona en un formulario.
 */
const fieldPathSchema = z.string().trim().max(200)

export const providerFieldMapSchema = z.strictObject({
  searchItems: fieldPathSchema.default(''),
  searchId: fieldPathSchema.default('id'),
  searchTitle: fieldPathSchema.default('title'),
  animeTitle: fieldPathSchema.default('title'),
  animeGenres: fieldPathSchema.default('genres'),
  animeStudios: fieldPathSchema.default('studios'),
  episodeItems: fieldPathSchema.default(''),
  episodeId: fieldPathSchema.default('id'),
  episodeNumber: fieldPathSchema.default('number'),
  episodeTitle: fieldPathSchema.default('title'),
  streamUrl: fieldPathSchema.default('url'),
  streamKind: fieldPathSchema.default('kind'),
})

/**
 * La descripción de un proveedor, tal como la manda el formulario.
 *
 * Esto **no** es un proveedor: es lo que basta para generar uno. La diferencia
 * importa: aquí no entra código, así que la interfaz puede aceptar esta forma
 * sin convertirse en un ejecutor de lo que le manden. El código lo escribe el
 * servidor, a partir de esta descripción, y por eso el archivo resultante es
 * siempre el mismo para la misma entrada.
 *
 * `id` es kebab-case porque es a la vez el nombre del archivo —tiene que ser un
 * nombre de archivo seguro, y validarlo aquí es lo que evita que lo sea por
 * accidente— y el identificador que viaja en las rutas.
 */
export const providerDraftSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'minúsculas, dígitos y guiones'),
  name: z.string().trim().min(1).max(80),
  baseUrl: httpUrlSchema,
  capabilities: providerCapabilitiesSchema,
  endpoints: z.strictObject({
    search: queryTemplateSchema,
    anime: refTemplateSchema,
    episodes: refTemplateSchema,
    stream: refTemplateSchema,
    trending: endpointTemplateSchema.optional(),
  }),
  /**
   * Se puede omitir entero: cada campo tiene su valor por defecto, y quien no
   * los conozca no tiene por qué mandarlos. El formulario los manda porque los
   * enseña, que no es lo mismo que hacerlos obligatorios.
   *
   * Es `prefault` y no `default` porque el valor que falta es del **entrante**:
   * `{}` todavía no es un mapa de campos, es lo que hay que pasar por el schema
   * para que los doce nombres aparezcan.
   */
  fields: providerFieldMapSchema.prefault({}),
})

/** Lo que devuelve registrar un proveedor: el que quedó cargado. */
export const providerRegisterResponseSchema = z.strictObject({
  provider: providerSummarySchema,
})

export const favoritesResponseSchema = z.strictObject({
  favorites: z.array(animeSummarySchema),
})

/** Alta o baja de un favorito. `value` dice en qué estado queda. */
export const favoriteRequestSchema = z.strictObject({
  ref: providerRefSchema,
  value: z.boolean(),
})

/**
 * Una fuente de reproducción tal y como la ve el cliente.
 *
 * `url` es la ruta del proxy con su ticket, no la del upstream: el tipo no
 * admite cabeceras, así que no hay forma de que se cuelen. Es la forma que
 * devuelve `toPublicStreamSource`.
 */
export const streamSourceResponseSchema = z.strictObject({
  url: z.string().min(1),
  kind: z.enum(['hls', 'file']),
  quality: z.string().min(1).optional(),
  subtitles: z.array(z.unknown()).optional(),
})

export const streamResolveResponseSchema = z.strictObject({
  sources: z.array(streamSourceResponseSchema),
})

/**
 * Handoff al reproductor externo: `POST /api/play/mpv`.
 *
 * El cuerpo es el de resolver un stream más el segundo por el que empezar, y la
 * respuesta es el `pid` del proceso. Viven aquí y no en la ruta del server
 * porque la interfaz manda el cuerpo y lee la respuesta: dos definiciones
 * paralelas se separan en el primer campo que alguien renombre.
 */
export const mpvPlayRequestSchema = streamRequestSchema.extend({
  /** Segundo en el que empezar, para reanudar donde se dejó. */
  startAtS: z.number().min(0).optional(),
})

export const mpvPlayResponseSchema = z.strictObject({ pid: z.number().int().positive() })

export type MpvPlayRequest = z.infer<typeof mpvPlayRequestSchema>
export type MpvPlayResponse = z.infer<typeof mpvPlayResponseSchema>

/** Alta de un visionado: qué episodio, en qué modo y desde dónde. */
export const watchStartRequestSchema = z.strictObject({
  animeRef: providerRefSchema,
  episodeRef: providerRefSchema,
  mode: modeSchema,
  startAtS: z.number().nonnegative().optional(),
})

export const watchStartResponseSchema = z.strictObject({ id: z.number().int().positive() })

/** Avance de un visionado. La duración se manda porque sólo el reproductor la sabe. */
export const watchUpdateRequestSchema = z.strictObject({
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
})

/**
 * Una recomendación, tal y como la ve el cliente.
 *
 * `components` **no está aquí**: es información de depuración y el spec prohíbe
 * exponerla por defecto. Si alguien la necesita, hay una opción explícita.
 */
export const recommendationSchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  coverUrl: httpUrlSchema.optional(),
  year: z.number().int().optional(),
  kind: titleKindSchema.optional(),
  score: z.number(),
  /**
   * Los géneros del título.
   *
   * Los lleva el motor —son sus características— y salen aquí porque la home los
   * necesita para el cartel de destacado y para la lista de géneros. Sin ellos
   * habría que pedir el detalle de cada título para pintar una fila.
   */
  tags: z.array(z.string().min(1)),
  reason: z.strictObject({
    kind: z.string().min(1),
    text: z.string().min(1),
  }),
  reasons: z.array(
    z.strictObject({
      kind: z.string().min(1),
      text: z.string().min(1),
    }),
  ),
})

export const recommendationsResponseSchema = z.strictObject({
  items: z.array(recommendationSchema),
  /** Sin historial: la interfaz lo usa para explicarse. */
  coldStart: z.boolean(),
})

/** Un visionado a medias, tal y como lo ve la fila «continuar viendo». */
export const continueWatchingItemSchema = z.strictObject({
  animeRef: providerRefSchema,
  title: z.string().min(1),
  coverUrl: httpUrlSchema.optional(),
  episodeRef: providerRefSchema,
  episodeNumber: z.number().int().nonnegative(),
  mode: modeSchema,
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  /** Cuánto se vio, de 0 a 1. Lo calcula el servidor para no repetirlo. */
  ratio: z.number().min(0).max(1),
  watchedAt: z.string().min(1),
})

export const continueWatchingResponseSchema = z.strictObject({
  items: z.array(continueWatchingItemSchema),
})

/** Una fila de tendencias. */
export const trendingResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/**
 * Una novedad del feed, con su fecha.
 *
 * La fecha es opcional porque un feed puede no traerla —y entonces sólo ordena el
 * orden de la fuente—, pero cuando está es lo que permite decir qué es nuevo.
 */
export const feedItemSchema = animeSummarySchema.extend({
  publishedAt: z.iso.datetime().optional(),
})

/** La fila de novedades: lo que publica la fuente, sin que nadie busque. */
export const feedResponseSchema = z.strictObject({
  items: z.array(feedItemSchema),
})

/** La fila «último añadido»: lo que la aplicación ya conoce, sin red. */
export const recentResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/** Ajustes que la interfaz puede leer y, en parte, cambiar. */
export const settingsResponseSchema = z.strictObject({
  theme: z.enum(['dark', 'light', 'system']),
  paths: z.strictObject({
    data: z.string().min(1),
    config: z.string().min(1),
    cache: z.string().min(1),
  }),
  mpv: z.strictObject({
    available: z.boolean(),
    version: z.string().optional(),
  }),
  providers: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      capabilities: providerCapabilitiesSchema,
      status: z.enum(['active', 'rejected']),
      /** Por qué se rechazó, si se rechazó. */
      reason: z.string().optional(),
    }),
  ),
})

export const settingsPatchSchema = z.strictObject({
  theme: z.enum(['dark', 'light', 'system']),
})

/** Detalle de un título. Es el mismo schema del dominio, no una copia. */
export const animeResponseSchema = animeDetailSchema

/** Lista de episodios de un título. */
export const episodesResponseSchema = z.strictObject({
  episodes: z.array(episodeSchema),
})

/**
 * Consulta de búsqueda.
 *
 * `provider` se repite en la dirección (`?provider=a&provider=b`), que es lo que
 * permite filtrar por varios sin inventar un separador dentro de un valor.
 */
export const searchQuerySchema = z.strictObject({
  q: z.string().max(200).default(''),
  provider: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).default([]),
})

/** Un evento del flujo de búsqueda, tal como viaja por SSE. */
export const searchEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('results'),
    providerId: z.string().min(1),
    results: z.array(searchResultSchema),
  }),
  z.strictObject({
    type: z.literal('error'),
    providerId: z.string().min(1),
    /**
     * Clasificación del fallo. Es texto y no una enumeración cerrada a
     * propósito: un tipo de fallo nuevo en el SDK no tiene que romper la
     * interfaz, que ya recibe el mensaje para mostrar.
     */
    kind: z.string().min(1),
    message: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('done'), providers: z.number().int().nonnegative() }),
])

export type ErrorResponse = z.infer<typeof errorResponseSchema>
export type AnimeResponse = z.infer<typeof animeResponseSchema>
export type ContinueWatchingItem = z.infer<typeof continueWatchingItemSchema>
export type ContinueWatchingResponse = z.infer<typeof continueWatchingResponseSchema>
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
export type TrendingResponse = z.infer<typeof trendingResponseSchema>
export type FeedItem = z.infer<typeof feedItemSchema>
export type FeedResponse = z.infer<typeof feedResponseSchema>
export type RecentResponse = z.infer<typeof recentResponseSchema>
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
export type RecommendationResponse = z.infer<typeof recommendationSchema>
export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>
export type WatchStartRequest = z.infer<typeof watchStartRequestSchema>
export type WatchStartResponse = z.infer<typeof watchStartResponseSchema>
export type WatchUpdateRequest = z.infer<typeof watchUpdateRequestSchema>
export type StreamResolveResponse = z.infer<typeof streamResolveResponseSchema>
export type StreamSourceResponse = z.infer<typeof streamSourceResponseSchema>
export type FavoriteRequest = z.infer<typeof favoriteRequestSchema>
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>
export type EpisodesResponse = z.infer<typeof episodesResponseSchema>
export type ProviderStatus = z.infer<typeof providerStatusSchema>
export type ProviderSummary = z.infer<typeof providerSummarySchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type ProvidersResponse = z.infer<typeof providersResponseSchema>
export type ProviderDraft = z.infer<typeof providerDraftSchema>
export type ProviderFieldMap = z.infer<typeof providerFieldMapSchema>
export type ProviderRegisterResponse = z.infer<typeof providerRegisterResponseSchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
export type SearchEventPayload = z.infer<typeof searchEventSchema>
