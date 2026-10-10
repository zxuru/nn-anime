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
  continueWatchingResponseSchema,
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

/**
 * La fila «continuar viendo».
 *
 * Se cortan los visionados terminados y los que no llegaron al 2 %: lo primero
 * porque ya se vio, y lo segundo porque abrir un episodio y cerrarlo no es «estar
 * viendo» nada. Y se cortan por arriba al 95 %: lo que está a punto de acabarse no
 * es algo que apetezca continuar.
 *
 * La proporción la calcula el servidor y no el cliente: si la calculara cada
 * pantalla, dos pantallas podrían pintar la misma barra con valores distintos.
 */
export const MIN_CONTINUE_RATIO = 0.02
export const MAX_CONTINUE_RATIO = 0.95

export function registerWatchRoutes(app: Hono, options: WatchRouteOptions): void {
  app.get('/api/watch/recent', async (c) => {
    const filas = await options.container.store.listRecentlyWatched(20)

    const items = filas
      .map((fila) => {
        const ratio =
          fila.durationS > 0 ? Math.min(fila.positionS / fila.durationS, 1) : fila.finished ? 1 : 0

        return { fila, ratio }
      })
      .filter(({ ratio }) => ratio >= MIN_CONTINUE_RATIO && ratio <= MAX_CONTINUE_RATIO)
      .map(({ fila, ratio }) => ({
        animeRef: fila.anime.ref,
        title: fila.anime.title,
        ...(fila.anime.coverUrl === undefined ? {} : { coverUrl: fila.anime.coverUrl }),
        episodeRef: {
          providerId: fila.providerId,
          value: `${fila.anime.ref.value}#${fila.episodeNumber}`,
        },
        episodeNumber: fila.episodeNumber,
        mode: fila.mode,
        positionS: fila.positionS,
        durationS: fila.durationS,
        ratio,
        watchedAt: fila.startedAt.toISOString(),
      }))

    return c.json(continueWatchingResponseSchema.parse({ items }))
  })

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
