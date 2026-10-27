/**
 * La ruta de metadatos de no-anime.
 *
 * **Es aditiva y opcional.** Sin clave de TMDB devuelve `{metadata: null}` y no
 * sale a la red; con una fuente de anime tampoco, porque AniList ya cubre esa
 * ficha. La interfaz puede pedirla siempre y quedarse con lo que publique el
 * plugin cuando no haya nada.
 *
 * No es una ruta de enriquecimiento de AniList: aquélla empareja por título y año
 * contra un catálogo de anime y devuelve su ficha; ésta sólo rellena sinopsis,
 * géneros y año de películas y series de acción real.
 */

import {
  errorResponseSchema,
  mediaOf,
  mediaTypeOf,
  type ProviderRef,
  tmdbMetadataResponseSchema,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Context, Hono } from 'hono'
import type { ServerContainer } from '../container'
import { createTmdbClient, type TmdbFetch } from '../tmdb/client'
import { findProvider } from './anime'
import { tmdbKeyOf } from './settings'

const DEFAULT_TIMEOUT_MS = 8000

export interface TmdbRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  /** Se inyecta en las pruebas: la ruta nunca sale a la red real en un test. */
  readonly fetchImpl?: TmdbFetch | undefined
  readonly now?: (() => number) | undefined
}

function callOptionsOf(c: Context): CallOptions {
  return { signal: c.req.raw.signal, timeoutMs: DEFAULT_TIMEOUT_MS }
}

export function registerTmdbRoute(app: Hono, options: TmdbRouteOptions): void {
  const client = createTmdbClient({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  app.get('/api/anime/:providerId/:ref/metadata', async (c) => {
    const provider = findProvider(options.providers, c.req.param('providerId'))
    if (provider === undefined) {
      return c.json(
        errorResponseSchema.parse({
          error: `no hay ningún proveedor llamado ${c.req.param('providerId')}`,
        }),
        404,
      )
    }

    const apiKey = await tmdbKeyOf(options.container.store)
    if (apiKey === undefined) return c.json(tmdbMetadataResponseSchema.parse({ metadata: null }))

    const ref: ProviderRef = { providerId: provider.id, value: c.req.param('ref') }
    const detalle = await options.container.getAnime(provider, ref, callOptionsOf(c))
    if (!detalle.ok) {
      return c.json(errorResponseSchema.parse({ error: detalle.error.message }), 502)
    }

    const anime = detalle.value.value
    const proveedor = mediaOf(provider.capabilities)

    // AniList ya cubre el anime. Preguntar a TMDB por él sería una petición que
    // no puede mejorar la ficha y que gasta una cuota ajena.
    if (mediaTypeOf(anime, proveedor) === 'anime') {
      return c.json(tmdbMetadataResponseSchema.parse({ metadata: null }))
    }

    const metadata = await client.lookup({
      apiKey,
      title: anime.title,
      ...(anime.titleAlt === undefined ? {} : { titleAlt: anime.titleAlt }),
      ...(anime.year === undefined ? {} : { year: anime.year }),
      kind: anime.kind === 'movie' ? 'movie' : 'series',
      signal: c.req.raw.signal,
    })

    return c.json(tmdbMetadataResponseSchema.parse({ metadata }))
  })
}
