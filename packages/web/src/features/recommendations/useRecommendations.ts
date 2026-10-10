/**
 * Datos del panel de recomendaciones.
 *
 * El panel se refresca con lo que el usuario busca, y ahí hay dos decisiones que
 * se ven en el código:
 *
 * 1. **Retardo de 400 ms.** Cada tecla no puede ser una petición: escribir
 *    «mecha» serían cinco, y cuatro de ellas ya no sirven cuando llega la
 *    respuesta. El retardo es del spec.
 * 2. **Se cancela la petición anterior.** Sin eso, la respuesta de «mec» puede
 *    llegar **después** de la de «mecha» y pintar resultados viejos encima de los
 *    nuevos. Es el fallo clásico de un buscador con retardo, y se arregla
 *    abortando, no ordenando por tiempo de llegada.
 */

import type { RecommendationsResponse } from '@nn-anime/core/api'
import { recommendationsResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '../../api/client'
import { createScheduler } from './scheduler'

/** Retardo antes de pedir, del spec. */
export const DEBOUNCE_MS = 400

export type PanelState = 'loading' | 'ready' | 'error'

export interface Recommendations {
  readonly state: PanelState
  readonly data: RecommendationsResponse | undefined
  readonly error: string | undefined
  readonly reload: () => void
  readonly showComponents: boolean
  readonly toggleComponents: () => void
}

export interface UseRecommendationsOptions {
  /** Se refresca cuando cambia: es la consulta que se está escribiendo. */
  readonly query?: string | undefined
  readonly limit?: number
  /** Retardo inyectable: una prueba no espera 400 ms. */
  readonly debounceMs?: number
}

export function recommendationsPath(query: string | undefined, limit: number): string {
  const parametros = new URLSearchParams({ limit: String(limit) })
  if (query !== undefined && query.trim() !== '') parametros.set('q', query.trim())

  return `/api/recommendations?${parametros.toString()}`
}

export function useRecommendations(options: UseRecommendationsOptions = {}): Recommendations {
  const [data, setData] = useState<RecommendationsResponse | undefined>(undefined)
  const [state, setState] = useState<PanelState>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [showComponents, setShowComponents] = useState(false)
  const [intento, setIntento] = useState(0)
  // El planificador se crea una vez y se reutiliza: si se creara en cada
  // efecto, no habría nada que cancelar entre una clave y la siguiente.
  const planificador = useRef<ReturnType<typeof createScheduler> | undefined>(undefined)
  const retardo = options.debounceMs ?? DEBOUNCE_MS

  const reload = useCallback(() => {
    setState('loading')
    setError(undefined)
    setIntento((valor) => valor + 1)
  }, [])

  useEffect(() => {
    const plan = createScheduler({
      delayMs: retardo,
      load: async (clave, signal) => {
        try {
          const salida = await apiGet(clave, recommendationsResponseSchema, { signal })
          if (signal.aborted) return

          setData(salida)
          setState('ready')
        } catch (cause) {
          if (signal.aborted) return

          setError(cause instanceof Error ? cause.message : String(cause))
          setState('error')
        }
      },
    })
    planificador.current = plan
    plan.schedule(recommendationsPath(options.query, options.limit ?? 10))

    return () => {
      plan.cancel()
      planificador.current = undefined
    }
  }, [options.query, options.limit, retardo, intento])

  return {
    state,
    data,
    error,
    reload,
    showComponents,
    toggleComponents: () => setShowComponents((valor) => !valor),
  }
}
