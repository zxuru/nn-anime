/**
 * Ruta de portadas: `GET /api/cover/:providerId/:ref`.
 *
 * Existe porque la interfaz prohíbe incrustar recursos remotos: sin ella no hay
 * forma de mostrar una portada sin incumplir su propio contrato. El cliente manda
 * una **referencia**, nunca una dirección, así que el navegador no puede
 * convertirse en un proxy hacia donde quiera y la lista blanca de destinos sigue
 * siendo la única puerta.
 *
 * Tres cosas que la ruta decide y no delega:
 *
 * - **Si la referencia no está en la caché de metadatos, es 404 sin preguntar al
 *   proveedor.** La ruta no descubre portadas: sirve la de un título que ya se
 *   conoce.
 * - **El tipo de contenido sale de una lista blanca de tipos ráster.** Un
 *   `image/svg+xml` es un documento capaz de ejecutar guiones y se serviría desde
 *   nuestro origen; se rechaza con 415. La CSP lo detendría, pero esa defensa es
 *   indirecta y no debe ser la única.
 * - **Tope de 5 MB.** Por encima, 413 y no se cachea.
 *
 * La referencia puede llevar barras, así que el cliente la escapa con
 * `encodeURIComponent`; sin escapar, la ruta da 404 (medido con Hono al auditar).
 */

import { errorResponseSchema } from '@nn-anime/core'
import {
  type FetchLike,
  MAX_COVER_BYTES,
  proxyBytes,
  RASTER_TYPES,
  type Resolver,
} from '@nn-anime/media-proxy'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'

/** Una semana, el TTL de miniatura de la tabla del spec. */
export const COVER_MAX_AGE_S = 604800

export interface CoverRouteOptions {
  readonly container: ServerContainer
  /** Se inyecta en los tests para no salir a la red. */
  readonly fetchImpl?: FetchLike
  /** Resolutor del DNS, inyectable para probar sin red. */
  readonly resolver?: Resolver
}

/**
 * ETag de una portada, derivado de su referencia.
 *
 * Es un hash y no la referencia: el nombre de un archivo de caché —o el valor de
 * una cabecera— no se deriva nunca de un dato del proveedor. La referencia puede
 * tener forma de ascenso (`..%2F..%2F`), y ahí no hay recorrido posible sólo
 * mientras nadie la use como ruta.
 */
export function coverEtag(providerId: string, ref: string): string {
  const hash = new Bun.CryptoHasher('sha256').update(`${providerId}\u0000${ref}`).digest('hex')

  return `"${hash.slice(0, 16)}"`
}

export function registerCoverRoute(app: Hono, options: CoverRouteOptions): void {
  app.get('/api/cover/:providerId/:ref', async (c) => {
    const providerId = c.req.param('providerId')
    const ref = c.req.param('ref')

    const detalle = await options.container.store.readAnime({ providerId, value: ref })
    const portada = detalle?.value.coverUrl

    if (portada === undefined) {
      return c.json(
        errorResponseSchema.parse({
          error: `no hay ninguna portada cacheada para ${providerId}/${ref}`,
        }),
        404,
      )
    }

    const etag = coverEtag(providerId, ref)
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304)
    }

    const respuesta = await proxyBytes({
      url: portada,
      headers: {},
      signal: c.req.raw.signal,
      acceptedTypes: RASTER_TYPES,
      maxBytes: MAX_COVER_BYTES,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    })

    if (!respuesta.ok) return respuesta

    // La caché larga y el ETag son lo que evita pedir la misma portada en cada
    // visita; el spec la llama «caché HTTP normal» y es exactamente esto.
    //
    // Se envuelve la respuesta del proxy para añadirlos: devolver el objeto tal
    // cual salta el mapa de cabeceras del contexto, y `c.header` se perdería sin
    // decir nada. Lo encontró la prueba.
    const salida = new Response(respuesta.body, {
      status: respuesta.status,
      headers: respuesta.headers,
    })
    salida.headers.set('cache-control', `public, max-age=${COVER_MAX_AGE_S}`)
    salida.headers.set('etag', etag)

    return salida
  })
}
