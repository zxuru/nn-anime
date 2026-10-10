/**
 * Ruta de detalle: `GET /api/anime/:providerId/:ref`.
 *
 * Devuelve el detalle por el mismo camino que la búsqueda: `readThrough` decide
 * si sale de la caché, si hay que pedirlo o si se sirve lo viejo mientras se
 * refresca. Aquí no hay ninguna regla de caché escrita a mano.
 *
 * Dos cosas que se ven en el código y no son adorno:
 *
 * - **`X-Cache`** dice de dónde salió: `hit`, `miss` o `stale`. Sin eso, «va
 *   lento» no se puede diagnosticar, y con eso se distingue una caché que no
 *   acierta de un proveedor que tarda.
 * - **Un proveedor desconocido es 404, no 500.** No es un fallo del servidor:
 *   es una referencia que no existe, y decir «error interno» obligaría a mirar
 *   los registros para descubrir algo que se sabe.
 *
 * Si la petición trae `?q=`, se anota en `search_history`: es el rastro de «este
 * título se abrió desde esta búsqueda», y es la señal que `recsys` usa después.
 * El detalle no puede adivinar de dónde vino; se lo dice quien navega.
 */

import {
  animeResponseSchema,
  errorResponseSchema,
  normalizeQuery,
  type ProviderError,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'

export interface AnimeRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  /** Tiempo límite por proveedor. Se acorta en los tests. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/** El proveedor pedido, si está entre los activos. */
export function findProvider(
  providers: readonly Provider[],
  providerId: string,
): Provider | undefined {
  return providers.find((provider) => provider.id === providerId)
}

/**
 * El estado HTTP que corresponde a un fallo del proveedor.
 *
 * Un 404 del upstream es un 404 aquí: el título no existe. Cualquier otro fallo
 * es del proveedor, no de la petición, así que es 502: quien lea el código no
 * tiene que adivinar de quién es la culpa.
 */
export function statusFor(error: ProviderError): 404 | 502 {
  return error.context.estado === 404 ? 404 : 502
}

export function registerAnimeRoutes(app: Hono, options: AnimeRouteOptions): void {
  app.get('/api/anime/:providerId/:ref', async (c) => {
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
    const resultado = await options.container.getAnime(
      provider,
      { providerId, value: ref },
      callOptions,
    )

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        statusFor(resultado.error),
      )
    }

    // El rastro de la búsqueda, si la petición dice de dónde viene.
    const consulta = c.req.query('q')
    if (consulta !== undefined && normalizeQuery(consulta) !== '') {
      await options.container.store.recordSearch(consulta, providerId, 1)
    }

    c.header('X-Cache', resultado.value.source)

    return c.json(animeResponseSchema.parse(resultado.value.value))
  })
}
