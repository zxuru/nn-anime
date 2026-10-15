/**
 * Rutas de favoritos: `GET /api/favorites` y `POST /api/favorites`.
 *
 * No son `/api/favorites/:providerId/:ref` porque el alta y la baja se hacen con
 * el mismo cuerpo: `value` dice en qué estado queda el título. Un `POST` para
 * marcar y un `DELETE` para desmarcar obligarían al cliente a saber qué había
 * antes, y el botón no lo sabe: sabe en qué estado quiere dejarlo.
 *
 * La escritura va por la fachada del store, así que pasa por la cola como todas
 * las demás. Marcar dos veces seguidas es idempotente en la tabla y no produce
 * error: un botón que se pulsa dos veces es lo normal.
 */

import { errorResponseSchema, favoriteRequestSchema, favoritesResponseSchema } from '@nn-anime/core'
import type { Hono } from 'hono'
import { sinMarcadas } from '../adultos'
import type { ServerContainer } from '../container'
import { adultContentOf } from './settings'

export interface FavoritesRouteOptions {
  readonly container: ServerContainer
}

export function registerFavoritesRoutes(app: Hono, options: FavoritesRouteOptions): void {
  app.get('/api/favorites', async (c) => {
    const conAdultos = await adultContentOf(options.container.store)

    // Los favoritos son del usuario, y aun así una obra marcada no se enseña con el
    // interruptor apagado: la marca es lo único que puede esconderla, y aquí no hay
    // entrada de AniList que consultar.
    const favoritos = await sinMarcadas(
      options.container.store,
      await options.container.store.listFavorites(),
      conAdultos,
      (favorito) => favorito.ref,
    )

    return c.json(favoritesResponseSchema.parse({ favorites: favoritos }))
  })

  app.post('/api/favorites', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = favoriteRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    try {
      await options.container.store.setFavorite(parsed.data.ref, parsed.data.value)
    } catch (cause) {
      // El caso normal: el título no está en la base porque nadie lo ha abierto
      // todavía. Es un 404, no un 500: la petición era correcta y el título no.
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
