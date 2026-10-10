/**
 * Ruta de episodios: `GET /api/anime/:providerId/:ref/episodes`.
 *
 * Va aparte del detalle porque se piden en momentos distintos: el detalle al
 * abrir la ficha y los episodios al desplegar la lista, con TTL distintos
 * (86400 y 21600). Juntarlos obligaría a pedir y guardar lo que nadie ha pedido
 * todavía.
 *
 * El `X-Cache` que se anuncia es el **de la lista**, no el del detalle: si el
 * detalle hubo que traerlo para poder guardar los episodios, eso es un detalle
 * interno de la implementación, y quien pregunta por los episodios quiere saber
 * de dónde salieron los episodios.
 */

import { episodesResponseSchema, errorResponseSchema, type ProviderError } from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'

export interface EpisodesRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * El estado HTTP de un fallo del proveedor.
 *
 * Se repite el criterio del detalle —404 del upstream es 404, lo demás es 502—
 * en una función propia: la comprobación es del recurso, no del tipo de dato,
 * pero el criterio tiene que ser el mismo en las dos rutas para que la interfaz
 * no trate de forma distinta dos fallos iguales.
 */
export function statusForEpisodes(error: ProviderError): 404 | 502 {
  return error.context.estado === 404 ? 404 : 502
}

export function registerEpisodesRoute(app: Hono, options: EpisodesRouteOptions): void {
  app.get('/api/anime/:providerId/:ref/episodes', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    const provider = findProvider(options.providers, providerId)
    if (provider === undefined) {
      return c.json(
        errorResponseSchema.parse({ error: `no hay ningún proveedor llamado ${providerId}` }),
        404,
      )
    }

    const callOptions: CallOptions = {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }
    const resultado = await options.container.getEpisodes(
      provider,
      { providerId, value: ref },
      callOptions,
    )

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        statusForEpisodes(resultado.error),
      )
    }

    c.header('X-Cache', resultado.value.source)

    // La forma compartida envuelve la lista: un cuerpo que es un array a secas
    // no se puede ampliar después sin romper a quien lo lee.
    return c.json(episodesResponseSchema.parse({ episodes: resultado.value.value }))
  })
}
