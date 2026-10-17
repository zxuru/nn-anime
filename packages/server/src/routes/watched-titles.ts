/**
 * Rutas de la marca de visto: `GET /api/watched-titles` y `POST /api/watched-titles`.
 *
 * El contrato es el de los favoritos, copiado a propósito: un solo `POST` con
 * `value` —que dice en qué estado queda la obra— en lugar de un `POST` para marcar
 * y un `DELETE` para desmarcar, 204 al dejarla en el estado pedido, 404 si el
 * título no está en la base y 400 si el cuerpo no valida. Dos formas de hacer lo
 * mismo en la misma aplicación son dos formas de equivocarse.
 *
 * **La lectura no filtra por adultos, y es una decisión.** `/api/favorites` sí lo
 * hace porque alimenta una fila de la vitrina que enseña tarjetas; ésta contesta
 * una pregunta de estado —«¿esta obra está marcada?»— y la lee el botón de la
 * ficha. Filtrarla dejaría el botón en «no está» sobre una obra que sí lo está, y
 * pulsarlo no haría nada visible: la marca es del usuario, no del catálogo. El día
 * que haya una fila «Vistos», el filtro va donde se arman las tarjetas.
 */

import {
  errorResponseSchema,
  watchedTitleRequestSchema,
  watchedTitlesResponseSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'

export interface WatchedTitlesRouteOptions {
  readonly container: ServerContainer
}

export function registerWatchedTitlesRoutes(app: Hono, options: WatchedTitlesRouteOptions): void {
  app.get('/api/watched-titles', async (c) => {
    const marcadas = await options.container.store.listWatchedTitles()

    // La fecha de la marca no viaja: la usa el motor para desempatar y la interfaz
    // no la pinta. El schema es estricto, así que se arma el resumen a mano.
    const items = marcadas.map(({ watchedAt: _watchedAt, ...resumen }) => resumen)

    return c.json(watchedTitlesResponseSchema.parse({ items }))
  })

  app.post('/api/watched-titles', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = watchedTitleRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    try {
      await options.container.store.setWatchedTitle(parsed.data.ref, parsed.data.value)
    } catch (cause) {
      // El caso normal: la obra no está en la base porque nadie abrió su ficha.
      // Es un 404, no un 500: la petición era correcta y el título no.
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
