/**
 * Rutas de visionado: `POST /api/watch` y `PATCH /api/watch/:id`.
 *
 * Son dos y no una porque son dos momentos distintos: abrir la fila cuando la
 * reproducción **empieza de verdad**, y moverla mientras avanza. Sin el primer
 * paso, cargar la ficha de un episodio ya contaría como haberlo visto, y
 * «continuar viendo» se llenaría de títulos que nadie reprodujo.
 *
 * El identificador lo devuelve el alta y lo usa el avance: una fila, un
 * visionado. Buscar por episodio y modo en cada avance haría que dos pestañas
 * abiertas con el mismo episodio se pisaran la posición.
 */

import {
  errorResponseSchema,
  watchStartRequestSchema,
  watchStartResponseSchema,
  watchUpdateRequestSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'

export interface WatchRouteOptions {
  readonly container: ServerContainer
}

export function registerWatchRoutes(app: Hono, options: WatchRouteOptions): void {
  app.post('/api/watch', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = watchStartRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const { animeRef, episodeRef, mode, startAtS } = parsed.data

    try {
      const id = await options.container.store.recordWatch({
        animeRef,
        episodeRef,
        mode,
        positionS: startAtS ?? 0,
        durationS: 0,
        startedAt: new Date(),
      })

      return c.json(watchStartResponseSchema.parse({ id }), 201)
    } catch (cause) {
      // El caso normal: el episodio no está en la base porque nadie abrió su
      // ficha. Es un 404, no un 500.
      return c.json(
        errorResponseSchema.parse({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        404,
      )
    }
  })

  app.patch('/api/watch/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(errorResponseSchema.parse({ error: 'ese identificador no es válido' }), 400)
    }

    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = watchUpdateRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    try {
      await options.container.store.updateWatchPosition(
        id,
        parsed.data.positionS,
        parsed.data.durationS,
      )
    } catch (cause) {
      return c.json(
        errorResponseSchema.parse({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
        404,
      )
    }

    return c.body(null, 204)
  })
}
