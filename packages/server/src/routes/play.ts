/**
 * Rutas del reproductor externo: `POST /api/play/mpv`, sus eventos y su parada.
 *
 * Tres cosas que se ven en el código y no son adorno:
 *
 * - **A mpv se le da la URL del proxy con su ticket, no la del upstream.** Si se
 *   le diera la del sitio, el ticket y la lista blanca de destinos dejarían de
 *   servir para el reproductor externo, que es justo donde más fácil es saltarse
 *   el proxy sin que nadie lo note.
 * - **La URL tiene que ser absoluta.** mpv no entiende rutas relativas: se
 *   construye con el origen de la petición, que ya está validado por el guard.
 * - **Sin mpv, 503 y no un 500.** No es un fallo del servidor: es que en esta
 *   máquina no hay reproductor externo, y el plan B es el reproductor del
 *   navegador. El mensaje lo dice.
 */

import { errorResponseSchema, streamRequestSchema } from '@nn-anime/core'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'
import { ticketPath } from './stream'

export const mpvPlayRequestSchema = streamRequestSchema.extend({
  /** Segundo en el que empezar, para reanudar donde se dejó. */
  startAtS: z.number().min(0).optional(),
})

export const mpvPlayResponseSchema = z.strictObject({ pid: z.number().int().positive() })

export interface PlayRouteOptions {
  readonly providers: readonly import('@nn-anime/provider-sdk').Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

export function registerPlayRoutes(app: Hono, options: PlayRouteOptions): void {
  app.post('/api/play/mpv', async (c) => {
    if (!options.container.mpv.available) {
      return c.json(
        errorResponseSchema.parse({
          error: 'no se encontró mpv en el PATH; se puede reproducir en el navegador',
        }),
        503,
      )
    }

    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = mpvPlayRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const provider = findProvider(options.providers, parsed.data.episodeRef.providerId)
    if (provider === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'ese proveedor no existe' }), 404)
    }

    const resultado = await options.container.resolveStream(provider, parsed.data, {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        resultado.error.context.estado === 404 ? 404 : 502,
      )
    }

    const fuente = resultado.value.value[0]
    if (fuente === undefined) {
      return c.json(errorResponseSchema.parse({ error: 'el proveedor no dio ninguna fuente' }), 502)
    }

    const ticket = options.container.tickets.issue({
      url: fuente.url,
      headers: fuente.headers ?? {},
    })

    // Absoluta, con el origen de la petición: mpv no sabe de rutas relativas.
    const url = new URL(ticketPath(ticket), new URL(c.req.url).origin).href
    const salida = options.container.mpv.play({
      url,
      ...(fuente.headers === undefined ? {} : { headers: fuente.headers }),
      ...(parsed.data.startAtS === undefined ? {} : { startAtS: parsed.data.startAtS }),
    })

    if (!salida.ok) {
      // Tres motivos distintos y tres respuestas distintas: decir «error» a los
      // tres obliga a mirar los registros para saber qué pasó.
      const motivos = {
        busy: { texto: 'ya hay un mpv en marcha', estado: 409 },
        'invalid-header': {
          texto: `el proveedor declaró una cabecera que no se puede usar: ${salida.header ?? ''}`,
          estado: 400,
        },
        unavailable: {
          texto: 'no se encontró mpv en el PATH; se puede reproducir en el navegador',
          estado: 503,
        },
      } as const

      const motivo = motivos[salida.reason]

      return c.json(errorResponseSchema.parse({ error: motivo.texto }), motivo.estado)
    }

    return c.json(mpvPlayResponseSchema.parse({ pid: salida.pid }), 202)
  })

  app.get('/api/play/mpv/events', (c) => {
    return streamSSE(c, async (stream) => {
      for await (const evento of options.container.mpv.events()) {
        if (c.req.raw.signal.aborted) break

        await stream.writeSSE({ event: evento.type, data: JSON.stringify(evento) })
      }
    })
  })

  app.post('/api/play/mpv/:pid/stop', (c) => {
    const pid = Number(c.req.param('pid'))
    if (!Number.isInteger(pid) || pid <= 0) {
      return c.json(errorResponseSchema.parse({ error: 'ese pid no es válido' }), 400)
    }

    if (!options.container.mpv.stop(pid)) {
      return c.json(errorResponseSchema.parse({ error: `no hay ningún mpv con pid ${pid}` }), 404)
    }

    return c.body(null, 204)
  })
}
