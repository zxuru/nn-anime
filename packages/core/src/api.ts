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
  providerCapabilitiesSchema,
  providerRefSchema,
  searchResultSchema,
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

export const favoritesResponseSchema = z.strictObject({
  favorites: z.array(animeSummarySchema),
})

/** Alta o baja de un favorito. `value` dice en qué estado queda. */
export const favoriteRequestSchema = z.strictObject({
  ref: providerRefSchema,
  value: z.boolean(),
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
export type FavoriteRequest = z.infer<typeof favoriteRequestSchema>
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>
export type EpisodesResponse = z.infer<typeof episodesResponseSchema>
export type ProviderStatus = z.infer<typeof providerStatusSchema>
export type ProviderSummary = z.infer<typeof providerSummarySchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type ProvidersResponse = z.infer<typeof providersResponseSchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
export type SearchEventPayload = z.infer<typeof searchEventSchema>
