/**
 * Rutas de reproducción: resolver el stream y proxear sus bytes.
 *
 * `POST /api/stream/resolve` no devuelve la URL del upstream: emite un ticket por
 * cada fuente y devuelve la dirección del proxy. El cliente web nunca ve —ni
 * puede compartir— el enlace del sitio de terceros, y los headers que el upstream
 * exige se quedan en el proceso: `toPublicStreamSource` los quita por tipo, así
 * que no hay forma de que se cuelen.
 *
 * `GET /stream/:ticket` resuelve el ticket y reenvía los bytes con su `Range`. Un
 * ticket que no existe es 404 y uno vencido es 410: la diferencia importa al
 * depurar, y son dos cosas distintas.
 */

import {
  errorResponseSchema,
  streamRequestSchema,
  streamResolveResponseSchema,
  toPublicStreamSource,
} from '@nn-anime/core'
import {
  contentTypeFor,
  type FetchLike,
  proxyBytes,
  type Resolver,
  resourceKind,
} from '@nn-anime/media-proxy'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'

export interface StreamRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
  /** Se inyecta en los tests para no salir a la red al proxear. */
  readonly fetchImpl?: FetchLike
  /** Resolutor del DNS, inyectable para probar sin red. */
  readonly resolver?: Resolver
  /** Excepción de loopback, sólo para el e2e. */
  readonly allowLoopback?: boolean
}

const DEFAULT_TIMEOUT_MS = 8000

/** La dirección con la que el cliente pide los bytes: el ticket, no la URL. */
export function ticketPath(ticket: string): string {
  return `/stream/${ticket}`
}

export function registerStreamRoutes(app: Hono, options: StreamRouteOptions): void {
  app.post('/api/stream/resolve', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = streamRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const provider = findProvider(options.providers, parsed.data.episodeRef.providerId)
    if (provider === undefined) {
      return c.json(
        errorResponseSchema.parse({
          error: `no hay ningún proveedor llamado ${parsed.data.episodeRef.providerId}`,
        }),
        404,
      )
    }

    const callOptions: CallOptions = {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }
    const resultado = await options.container.resolveStream(provider, parsed.data, callOptions)

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        resultado.error.context.estado === 404 ? 404 : 502,
      )
    }

    // Cada fuente se convierte en un ticket: la URL del upstream se queda aquí.
    const sources = resultado.value.value.map((source) => {
      const ticket = options.container.tickets.issue({
        url: source.url,
        headers: source.headers ?? {},
      })

      return toPublicStreamSource({ ...source, url: ticketPath(ticket) })
    })

    c.header('X-Cache', resultado.value.source)

    return c.json(streamResolveResponseSchema.parse({ sources }))
  })

  app.get('/stream/:ticket', async (c) => {
    const ticket = c.req.param('ticket')
    const salida = options.container.tickets.resolve(ticket)

    if (!salida.ok) {
      return c.json(
        errorResponseSchema.parse({
          error:
            salida.kind === 'expired'
              ? 'el ticket caducó; vuelve a resolver el stream'
              : 'ese ticket no existe',
        }),
        salida.kind === 'expired' ? 410 : 404,
      )
    }

    // El tipo se decide por lo que se pidió, no por lo que diga el upstream: una
    // playlist servida como `text/html` es la forma más simple de convertir un
    // proxy en un XSS. Un archivo progresivo es la excepción, porque su
    // contenedor real sólo lo sabe el upstream.
    const tipo = contentTypeFor(resourceKind(salida.contents.url))

    const respuesta = await proxyBytes({
      url: salida.contents.url,
      headers: salida.contents.headers,
      range: c.req.header('range'),
      signal: c.req.raw.signal,
      ...(tipo === undefined ? {} : { forceType: tipo }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })

    return respuesta
  })
}
