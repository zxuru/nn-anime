/**
 * Ruta `/api/search`: búsqueda incremental por SSE.
 *
 * El cuerpo de cada evento es el schema compartido de `core`, validado antes de
 * escribirlo. Un evento que la interfaz no sepa leer no es un detalle de
 * presentación: la interfaz lo descarta y el usuario ve una búsqueda que no
 * termina de llegar.
 *
 * La cancelación es la parte que se olvida: si el cliente corta la conexión
 * —porque cierra la pestaña o cambia de consulta— hay que abortar las peticiones
 * a los proveedores. Sin eso, cada búsqueda abandonada deja trabajo vivo contra
 * sitios de terceros, que es justo lo que el spec prohíbe.
 */

import { errorResponseSchema, searchEventSchema, searchQuerySchema } from '@nn-anime/core'
import type { Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { searchAll } from '../search/aggregate'

export interface SearchRouteOptions {
  readonly providers: readonly Provider[]
  /** Tiempo límite por proveedor. Se acorta en los tests. */
  readonly timeoutMs?: number
}

/** Los proveedores que entran en la búsqueda, según el filtro de la consulta. */
export function selectedProviders(
  providers: readonly Provider[],
  wanted: readonly string[],
): readonly Provider[] {
  if (wanted.length === 0) return providers

  return providers.filter((provider) => wanted.includes(provider.id))
}

export function registerSearchRoute(app: Hono, options: SearchRouteOptions): void {
  app.get('/api/search', (c) => {
    const parsed = searchQuerySchema.safeParse({
      q: c.req.query('q') ?? '',
      provider: c.req.queries('provider') ?? [],
    })

    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `consulta inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const selected = selectedProviders(options.providers, parsed.data.provider)
    const timeoutMs = options.timeoutMs
    // La señal del cliente: `fetch` la aborta al cerrar la conexión.
    const disconnected = c.req.raw.signal

    return streamSSE(c, async (stream) => {
      for await (const event of searchAll(selected, parsed.data.q, {
        signal: disconnected,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })) {
        // Escribir con el cliente ya ido es un error de escritura, no un evento
        // que nadie vaya a leer.
        if (disconnected.aborted) break

        const payload = searchEventSchema.parse(event)
        await stream.writeSSE({ event: payload.type, data: JSON.stringify(payload) })
      }
    })
  })
}
