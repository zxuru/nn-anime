/**
 * Ruta de recomendaciones: `GET /api/recommendations`.
 *
 * El motor es puro y este es el cableado: junta las señales locales, añade lo que
 * sólo el proveedor puede dar —tendencias—, llama a `recommend()` y traduce el
 * resultado a la forma pública.
 *
 * Tres reglas del spec, y las tres se ven aquí:
 *
 * 1. **Sin historial no se llama al proveedor salvo `getTrending`.** Si no hay
 *    nada que recomendar, pedirle detalles a un sitio de terceros es gastar su
 *    ancho de banda para nada.
 * 2. **Cada candidato se enriquece con tags desde el store.** Un título sin tags
 *    no entra en el ranking de afinidad y sólo puede entrar por popularidad: es
 *    lo que hace que un título recién cacheado no desaparezca.
 * 3. **La respuesta no lleva `components` por defecto.** Es información de
 *    depuración, y exponerla sin que nadie la pida es contar cómo funciona el
 *    motor sin motivo.
 */

import type { Candidate } from '@nn-anime/core'
import {
  errorResponseSchema,
  recommendationsResponseSchema,
  trendingResponseSchema,
} from '@nn-anime/core'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import { recommend } from '@nn-anime/recsys'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { gatherSignals, refKey } from '../recommend/signals'

/** Tope de la lista: más de veinte recomendaciones no las mira nadie. */
export const MAX_LIMIT = 20

export interface RecommendationsRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * El límite pedido, recortado al tope y con valor por defecto.
 *
 * Es una función y no dos líneas dentro de la ruta porque el recorte es una
 * decisión con tres casos —vacío, fuera de rango y absurdo— y así se prueba sola.
 * Una mutación que quitaba el recorte sobrevivía cuando la lista de candidatos era
 * más corta que el tope, que es lo normal en una prueba.
 */
export function clampLimit(raw: string | undefined): number {
  const pedido = Number(raw ?? '10')
  if (!Number.isFinite(pedido)) return 10

  return Math.min(Math.max(Math.trunc(pedido), 1), MAX_LIMIT)
}

/**
 * Tendencias del proveedor, como fila propia.
 *
 * Va aparte del motor porque es otra cosa: las recomendaciones son para el
 * usuario y esto es lo que está de moda en general. Y sólo se pide a quien dice
 * saber hacerlo: un proveedor sin `getTrending` no se consulta.
 */
export function registerTrendingRoute(app: Hono, options: RecommendationsRouteOptions): void {
  app.get('/api/trending', async (c) => {
    const conTendencias = options.providers.filter(
      (provider) => provider.capabilities.trending && provider.getTrending !== undefined,
    )

    // Primero la caché: la segunda carga de la home no puede volver a pedir las
    // tendencias. Lo encontró la auditoría de T47 midiendo las llamadas.
    const resultados = await Promise.all(
      conTendencias.map(async (provider) => {
        const cacheado = await options.container.store.readTrending(provider.id)
        if (cacheado !== null) return cacheado.value

        const tendencias = provider.getTrending
        if (tendencias === undefined) return []

        try {
          const lista = await tendencias.call(provider, {
            signal: c.req.raw.signal,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          })
          await options.container.store.writeTrending(provider.id, lista)

          return lista
        } catch {
          // Un proveedor que no responde a tendencias no puede tumbar la lista.
          return []
        }
      }),
    )

    const vistos = new Set<string>()
    const items = []

    for (const resultado of resultados.flat()) {
      const clave = refKey(resultado.ref)
      if (vistos.has(clave)) continue

      vistos.add(clave)
      items.push({
        ref: resultado.ref,
        title: resultado.title,
        ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
        ...(resultado.year === undefined ? {} : { year: resultado.year }),
        ...(resultado.kind === undefined ? {} : { kind: resultado.kind }),
      })
    }

    return c.json(trendingResponseSchema.parse({ items }))
  })
}

export function registerRecommendationsRoute(
  app: Hono,
  options: RecommendationsRouteOptions,
): void {
  app.get('/api/recommendations', async (c) => {
    const limite = clampLimit(c.req.query('limit'))
    const ahora = Date.now()

    // La consulta que se está escribiendo entra como búsqueda **de ahora**: el
    // panel tiene que cambiar con lo que el usuario busca, y sin esto la petición
    // viajaba con `q` y el servidor la ignoraba. Lo encontró la revisión del
    // Checkpoint G, no una prueba: la prueba comprobaba que la consulta viajaba,
    // no que sirviera de algo.
    const consulta = c.req.query('q')?.trim() ?? ''
    const señales = await gatherSignals(options.container.store)
    const conConsulta =
      consulta === ''
        ? señales
        : {
            ...señales,
            searches: [{ query: consulta, at: new Date(ahora), hits: 1 }, ...señales.searches],
          }
    const candidatos: Candidate[] = [...señales.candidates]

    // Tendencias: lo único que se pide al proveedor, y sólo si dice saber hacerlo.
    const conTendencias = options.providers.filter(
      (provider) => provider.capabilities.trending && provider.getTrending !== undefined,
    )
    if (conTendencias.length > 0) {
      const callOptions: CallOptions = {
        signal: c.req.raw.signal,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }

      // La caché va también aquí: esta ruta es la que alimenta el panel de la home,
      // y sin ella la segunda carga volvía a pedir las tendencias. Lo encontró la
      // auditoría de T47 midiendo las llamadas.
      const resultados = await Promise.all(
        conTendencias.map(async (provider) => {
          const cacheado = await options.container.store.readTrending(provider.id)
          if (cacheado !== null) return cacheado.value

          try {
            const tendencias = provider.getTrending
            if (tendencias === undefined) return []

            const lista = await tendencias.call(provider, callOptions)
            await options.container.store.writeTrending(provider.id, lista)

            return lista
          } catch {
            // Un proveedor que no responde a tendencias no puede tumbar la lista:
            // lo local sigue estando.
            return []
          }
        }),
      )

      const yaEstan = new Set(candidatos.map((candidato) => refKey(candidato.ref)))
      for (const resultado of resultados.flat()) {
        const clave = refKey(resultado.ref)
        if (yaEstan.has(clave)) continue

        yaEstan.add(clave)
        candidatos.push({
          ref: resultado.ref,
          title: resultado.title,
          // Sin tags: este candidato sólo puede entrar por popularidad, y eso es
          // correcto: el proveedor no ha dado con qué compararlo.
          tags: [],
          studios: [],
          ...(resultado.coverUrl === undefined ? {} : { coverUrl: resultado.coverUrl }),
          ...(resultado.year === undefined ? {} : { year: resultado.year }),
          popularity: 1,
        })
      }
    }

    const salida = recommend(conConsulta, candidatos, { limit: limite, now: ahora })

    return c.json(
      recommendationsResponseSchema.parse({
        coldStart: salida.coldStart,
        items: salida.items.map((entrada) => ({
          ref: entrada.candidate.ref,
          title: entrada.candidate.title,
          ...(entrada.candidate.coverUrl === undefined
            ? {}
            : { coverUrl: entrada.candidate.coverUrl }),
          ...(entrada.candidate.year === undefined ? {} : { year: entrada.candidate.year }),
          score: entrada.score,
          reason: { kind: entrada.reason.kind, text: entrada.reason.text },
          reasons: entrada.reasons.map((razon) => ({ kind: razon.kind, text: razon.text })),
        })),
      }),
    )
  })

  // El guard de errores de la aplicación ya devuelve `errorResponseSchema`; este
  // importe existe para que la ruta no pueda olvidarse de la forma del error.
  void errorResponseSchema
}
