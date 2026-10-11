/**
 * Las dos lecturas locales de la ficha: relacionados y episodios vistos.
 *
 * Las dos son **locales**: leen la base y no llaman al proveedor. Por eso no
 * llevan `X-Cache` —ese encabezado dice de dónde salió un dato cacheado del
 * proveedor, y aquí no hay ninguno— y por eso no pueden tardar lo que tarda una
 * red.
 *
 * Van juntas en un archivo porque comparten lo único que hay que decidir: que el
 * proveedor exista. Un proveedor desconocido es 404 —la misma regla que el
 * detalle y los episodios—, y una referencia que no está en la base es lista
 * vacía: nadie abrió esa ficha todavía, y eso no es un error.
 *
 * El tope del límite está aquí y no en el cliente: un `?limit=100000` no puede
 * convertirse en una lectura de la tabla entera pintada en una fila.
 */

import { errorResponseSchema, relatedResponseSchema, watchedResponseSchema } from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'

/** Cuántos relacionados se devuelven si nadie pide otra cosa. */
export const DEFAULT_RELATED_LIMIT = 12

/** El techo: más de esto no cabe en la fila y sí en memoria. */
export const MAX_RELATED_LIMIT = 24

/**
 * El límite pedido, saneado.
 *
 * Un valor que no sea un entero positivo se ignora y manda el de por defecto: no
 * es un error de la petición, es una petición sin preferencia.
 */
export function relatedLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RELATED_LIMIT

  const numero = Number(raw)
  if (!Number.isInteger(numero) || numero <= 0) return DEFAULT_RELATED_LIMIT

  return Math.min(numero, MAX_RELATED_LIMIT)
}

export interface DetailRoutesOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
}

export function registerDetailRoutes(app: Hono, options: DetailRoutesOptions): void {
  const desconocido = (providerId: string) =>
    errorResponseSchema.parse({ error: `no hay ningún proveedor llamado ${providerId}` })

  app.get('/api/anime/:providerId/:ref/related', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    if (findProvider(options.providers, providerId) === undefined) {
      return c.json(desconocido(providerId), 404)
    }

    const items = await options.container.store.listRelated(
      { providerId, value: ref },
      relatedLimit(c.req.query('limit')),
    )

    return c.json(relatedResponseSchema.parse({ items }))
  })

  app.get('/api/anime/:providerId/:ref/watched', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    if (findProvider(options.providers, providerId) === undefined) {
      return c.json(desconocido(providerId), 404)
    }

    const filas = await options.container.store.listWatchedEpisodes({ providerId, value: ref })

    return c.json(
      watchedResponseSchema.parse({
        episodes: filas.map((fila) => ({
          number: fila.number,
          mode: fila.mode,
          positionS: fila.positionS,
          durationS: fila.durationS,
          ratio: fila.ratio,
          finished: fila.finished,
          // La fecha viaja como ISO, igual que en «continuar viendo»: dos formas
          // de fecha en la misma interfaz acaban en una conversión olvidada.
          watchedAt: fila.watchedAt.toISOString(),
        })),
      }),
    )
  })
}
