/**
 * Las tres lecturas locales de la ficha: relacionados, fuentes y episodios vistos.
 *
 * Las tres son **locales**: leen la base y no llaman al proveedor. Por eso no
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

import type { RelatedScope } from '@nn-anime/catalog-store'
import {
  errorResponseSchema,
  relatedResponseSchema,
  sourcesResponseSchema,
  watchedResponseSchema,
} from '@nn-anime/core'
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

/**
 * El alcance pedido, saneado.
 *
 * Un valor desconocido cae a `'saga'`, igual que un límite sin sentido cae al de
 * por defecto: una petición sin preferencia no es una petición mal formada, y un
 * 400 aquí sólo conseguiría que una interfaz vieja dejara de pintar la sección.
 */
export function relatedScope(raw: string | undefined): RelatedScope {
  return raw === 'franchise' ? 'franchise' : 'saga'
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
      relatedScope(c.req.query('scope')),
    )

    return c.json(relatedResponseSchema.parse({ items }))
  })

  /**
   * Las otras fuentes que tienen esta misma obra.
   *
   * Sin red: lee la base, como los relacionados. No lleva `limit` en la consulta
   * porque el tope lo pone el servidor —la fila de la ficha es corta— y una
   * interfaz no tiene por qué poder pedir la tabla entera.
   */
  app.get('/api/anime/:providerId/:ref/sources', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    if (findProvider(options.providers, providerId) === undefined) {
      return c.json(desconocido(providerId), 404)
    }

    const items = await options.container.store.listSources(
      { providerId, value: ref },
      MAX_RELATED_LIMIT,
    )

    return c.json(sourcesResponseSchema.parse({ items: [...items] }))
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
