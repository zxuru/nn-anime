/**
 * La ruta que recibe la foto del visionado y la convierte en presencia.
 *
 * El reproductor manda referencias y números, **nunca el título**: lo resuelve
 * este servidor desde su caché y lo cruza con la marca de adultos. Así una
 * página comprometida no puede escribir el texto que se publica en Discord, y un
 * título marcado no sale aunque el ajuste esté en «completo».
 *
 * Responde 204 siempre que la petición sea válida —aunque el ajuste esté
 * apagado—: el reproductor no tiene que saber si Discord está abierto o si el
 * usuario lo apagó, y un error ahí sólo añadiría ruido a la reproducción.
 */

import { errorResponseSchema, presenceUpdateSchema } from '@rona/core'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { discordPresenceOf } from './settings'

export interface PresenceRouteOptions {
  readonly container: Pick<ServerContainer, 'store' | 'presence'>
  /** En modo servidor no hay una identidad por usuario: no se publica nada. */
  readonly locked?: boolean | undefined
}

export function registerPresenceRoutes(app: Hono, options: PresenceRouteOptions): void {
  app.put('/api/presence', async (c) => {
    if (options.locked === true) return c.body(null, 204)

    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = presenceUpdateSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const mode = await discordPresenceOf(options.container.store)

    if (mode === 'off') {
      options.container.presence.clear()
      return c.body(null, 204)
    }

    const { animeRef, episodeNumber, positionS, durationS, paused } = parsed.data
    const [anime, marcadas] = await Promise.all([
      options.container.store.readAnime(animeRef),
      options.container.store.listAdultRefs([animeRef]),
    ])

    // La marca manda sobre el título y sobre el modo: si la obra está marcada,
    // `title` llega nulo y el constructor de la actividad publica el texto
    // genérico aunque el ajuste sea «completo».
    const title = marcadas.length > 0 ? null : (anime?.value.title ?? null)

    options.container.presence.update({
      mode,
      title,
      episodeNumber,
      positionS,
      durationS,
      paused,
    })

    return c.body(null, 204)
  })

  app.delete('/api/presence', (c) => {
    options.container.presence.clear()

    return c.body(null, 204)
  })
}
