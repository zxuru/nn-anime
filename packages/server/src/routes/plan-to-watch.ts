/**
 * Rutas de «quiero ver»: `GET /api/plan-to-watch` y `POST /api/plan-to-watch`.
 *
 * El contrato es el de los favoritos y el de la marca de visto, copiado a
 * propósito: un solo `POST` con `value` —que dice en qué estado queda la obra— en
 * lugar de un `POST` para marcar y un `DELETE` para desmarcar, 204 al dejarla en el
 * estado pedido, 404 si el título no está en la base y 400 si el cuerpo no valida.
 * Tres formas de hacer lo mismo en la misma aplicación son tres formas de
 * equivocarse.
 *
 * **La lectura sí filtra por adultos**, al contrario que la de la marca de visto:
 * la lista alimenta una sección del Perfil que enseña tarjetas, y las tres listas
 * del Perfil se filtran igual. El estado puro —«¿esta obra está pendiente?»— lo
 * contesta el botón de la ficha, que lee lo que tenga delante sin esconder nada.
 */

import {
  errorResponseSchema,
  planToWatchRequestSchema,
  planToWatchResponseSchema,
} from '@nn-anime/core'
import type { Hono } from 'hono'
import { sinMarcadas } from '../adultos'
import type { ServerContainer } from '../container'
import { adultContentOf } from './settings'

export interface PlanToWatchRouteOptions {
  readonly container: ServerContainer
}

export function registerPlanToWatchRoutes(app: Hono, options: PlanToWatchRouteOptions): void {
  app.get('/api/plan-to-watch', async (c) => {
    const conAdultos = await adultContentOf(options.container.store)
    const pendientes = await options.container.store.listPlanToWatch()

    // La fecha de la marca no viaja: la usa el motor para desempatar y la interfaz
    // no la pinta. El schema es estricto, así que se arma el resumen a mano.
    const items = (
      await sinMarcadas(
        options.container.store,
        pendientes,
        conAdultos,
        (pendiente) => pendiente.ref,
      )
    ).map(({ createdAt: _createdAt, ...resumen }) => resumen)

    return c.json(planToWatchResponseSchema.parse({ items }))
  })

  app.post('/api/plan-to-watch', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = planToWatchRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    try {
      await options.container.store.setPlanToWatch(parsed.data.ref, parsed.data.value)
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
