/**
 * La pregunta que la interfaz hace antes de ofrecer el mando de transmitir.
 *
 * No emite tickets ni abre nada: dice si `RONA_CAST=1` está encendido, si el
 * servidor escucha en una dirección que una TV pueda alcanzar y con qué IPv4 de
 * la LAN se puede probar. Sin esto, el mando aparecería en un servidor atado a
 * `127.0.0.1` y la TV no tendría a dónde pedir el video.
 *
 * La ruta exige la sesión normal: el ticket de emisión sólo abre `/stream/*`, y
 * una TV no necesita saber si el cast está disponible.
 */

import {
  castInfoResponseSchema,
  castSessionRequestSchema,
  castSessionResponseSchema,
  errorResponseSchema,
} from '@rona/core'
import type { CallOptions, Provider } from '@rona/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { lanUrls } from '../party/lan'
import { findProvider } from './anime'

export interface CastRouteOptions {
  /** `RONA_CAST=1`. */
  readonly enabled: boolean
  /** Interfaz donde escucha el servidor. */
  readonly host: string
  /** Hay `RONA_TOKEN`; sin él no se abre una LAN. */
  readonly token: boolean
  /** Direcciones para probar; en tests, fijas. */
  readonly urls?: ((port: number) => string[]) | undefined
}

export interface CastSessionRouteOptions extends CastRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number | undefined
}

/** El mismo plazo que resolver un stream: la emisión no inventa otro. */
const DEFAULT_CAST_TIMEOUT_MS = 8000

/** ¿El nombre es loopback? Se compara con lo que la TV no puede alcanzar. */
export function esLoopback(host: string): boolean {
  const valor = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const lower = valor.toLowerCase()

  return lower === 'localhost' || lower === '::1' || /^127\./.test(lower)
}

/** ¿La dirección es alcanzable desde otra máquina? */
function utilParaLaTv(url: string): boolean {
  try {
    const host = new URL(url).hostname

    return !esLoopback(host)
  } catch {
    return false
  }
}

export function registerCastRoutes(
  app: Hono,
  getPort: () => number,
  options: CastRouteOptions,
): void {
  app.get('/api/cast/info', (c) => {
    c.header('cache-control', 'no-store')

    const motivo = !options.enabled
      ? 'disabled'
      : !options.token
        ? 'no-token'
        : esLoopback(options.host)
          ? 'loopback'
          : undefined

    if (motivo !== undefined) {
      return c.json(
        castInfoResponseSchema.parse({
          available: false,
          urls: [],
          reason: motivo,
        }),
      )
    }

    const urls = (options.urls ?? lanUrls)(getPort()).filter(utilParaLaTv)

    if (urls.length === 0) {
      return c.json(
        castInfoResponseSchema.parse({
          available: false,
          urls: [],
          reason: 'no-address',
        }),
      )
    }

    return c.json(castInfoResponseSchema.parse({ available: true, urls }))
  })
}

/**
 * Abre y cierra una emisión.
 *
 * El cuerpo es el mismo de resolver un stream: el cliente no manda una URL, y la
 * resolución ocurre en el servidor. La diferencia es la credencial: el ticket
 * vive cuatro horas y se revoca al cerrar, para que una TV que no tiene nuestra
 * cookie pueda pedir el video.
 */
export function registerCastSessionRoutes(
  app: Hono,
  getPort: () => number,
  options: CastSessionRouteOptions,
): void {
  app.post('/api/cast/session', async (c) => {
    if (!options.enabled) {
      return c.json(errorResponseSchema.parse({ error: 'el cast está apagado (RONA_CAST=1)' }), 409)
    }

    if (!options.token || esLoopback(options.host)) {
      return c.json(
        errorResponseSchema.parse({
          error: 'el cast necesita una LAN con token; abre la aplicación en modo servidor',
        }),
        409,
      )
    }

    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = castSessionRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const datos = parsed.data
    let origen: { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly kind: 'hls' | 'file' }

    if ('url' in datos) {
      // El reproductor manda el ticket que ya está usando: el servidor no
      // acepta una URL arbitraria, sólo una ruta del proxy.
      const ticket = datos.url.slice('/stream/'.length)
      const deEmision = options.container.castTickets.resolve(ticket)
      const contenido = deEmision.ok ? deEmision : options.container.tickets.resolve(ticket)

      if (!contenido.ok) {
        return c.json(
          errorResponseSchema.parse({
            error:
              contenido.kind === 'expired'
                ? 'el ticket de la reproducción caducó; vuelve a abrir el episodio'
                : 'el ticket de la reproducción no existe',
          }),
          contenido.kind === 'expired' ? 410 : 404,
        )
      }

      origen = {
        url: contenido.contents.url,
        headers: contenido.contents.headers,
        kind: datos.kind,
      }
    } else {
      const provider = findProvider(options.providers, datos.episodeRef.providerId)
      if (provider === undefined) {
        return c.json(
          errorResponseSchema.parse({
            error: `no hay ningún proveedor llamado ${datos.episodeRef.providerId}`,
          }),
          404,
        )
      }

      const callOptions: CallOptions = {
        signal: c.req.raw.signal,
        timeoutMs: options.timeoutMs ?? DEFAULT_CAST_TIMEOUT_MS,
      }
      const resultado = await options.container.resolveStream(provider, datos, callOptions)

      if (!resultado.ok) {
        return c.json(
          errorResponseSchema.parse({ error: resultado.error.message }),
          resultado.error.context.estado === 404 ? 404 : 502,
        )
      }

      const fuente = resultado.value.value[0]
      if (fuente === undefined) {
        return c.json(
          errorResponseSchema.parse({ error: 'el proveedor no dio ninguna fuente para la emisión' }),
          502,
        )
      }

      origen = {
        url: fuente.url,
        headers: fuente.headers ?? {},
        kind: fuente.kind,
      }
    }

    const bases = (options.urls ?? lanUrls)(getPort()).filter(utilParaLaTv)
    if (bases.length === 0) {
      return c.json(
        errorResponseSchema.parse({
          error: 'no hay ninguna dirección de la LAN a la que la TV pueda pedir el video',
        }),
        409,
      )
    }

    const videoTicket = options.container.castTickets.issue({
      url: origen.url,
      headers: origen.headers,
    })
    const session = options.container.castSessions.create(videoTicket)

    c.header('cache-control', 'no-store')

    return c.json(
      castSessionResponseSchema.parse({
        id: session.id,
        kind: origen.kind,
        urls: bases.map((base) => `${base}/stream/${videoTicket}`),
        expiresAt: session.expiresAt,
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        ...(parsed.data.poster === undefined ? {} : { poster: parsed.data.poster }),
        subtitles: [],
      }),
    )
  })

  app.delete('/api/cast/session/:id', (c) => {
    const session = options.container.castSessions.revoke(c.req.param('id'))
    if (session === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'esa emisión no existe' }), 404)
    }

    options.container.castTickets.revoke(session.videoTicket)

    return c.body(null, 204)
  })
}
