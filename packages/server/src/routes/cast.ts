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

import { castInfoResponseSchema } from '@rona/core'
import type { Hono } from 'hono'
import { lanUrls } from '../party/lan'

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
