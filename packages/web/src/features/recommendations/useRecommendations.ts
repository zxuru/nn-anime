/**
 * Datos del motor de recomendaciones.
 *
 * Lo consume la vitrina —el tramo «Recomendado para ti»— y se refresca con lo
 * que el usuario busca, y ahí hay dos decisiones que se ven en el código:
 *
 * 1. **Retardo de 400 ms.** Cada tecla no puede ser una petición: escribir
 *    «mecha» serían cinco, y cuatro de ellas ya no sirven cuando llega la
 *    respuesta. El retardo es del spec.
 * 2. **Se cancela la petición anterior.** Sin eso, la respuesta de «mec» puede
 *    llegar **después** de la de «mecha» y pintar resultados viejos encima de los
 *    nuevos. Es el fallo clásico de un buscador con retardo, y se arregla
 *    abortando, no ordenando por tiempo de llegada.
 * 3. **Lo que se enseña va atado a su ruta.** Cambiar de `?tipo=` o de consulta
 *    dejaba en pantalla las recomendaciones de la anterior hasta que llegaba la
 *    nueva respuesta —o para siempre, si fallaba—. Guardar la ruta con los datos
 *    hace que el cambio enseñe el estado de carga de la ruta nueva.
 */

import type { RecommendationsResponse } from '@rona/core/api'
import { recommendationsResponseSchema } from '@rona/core/api'
import type { MediaHalf } from '@rona/core/media'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'
import { createScheduler } from './scheduler'

/** Retardo antes de pedir, del spec. */
export const DEBOUNCE_MS = 400

/**
 * El retardo que toca según haya consulta o no.
 *
 * Con consulta, los 400 ms del spec: es lo que colapsa las teclas de una
 * búsqueda y cancela lo que quedó viejo. **Sin consulta —la vitrina— no hay nada
 * que colapsar**, y el retardo sólo retrasaba la marquesina: el destacado salía
 * primero con lo que hubiera en el feed y se sustituía por la recomendación
 * cuando ya se estaba mirando. Medido en T195, eso costaba una segunda cadena de
 * detalle (ficha, episodios y enriquecimiento del título de reserva) y un salto
 * de maquetación de 0,039 que el CLS contaba entero.
 *
 * Un retardo explícito manda sobre la regla: es el que inyectan las pruebas.
 */
export function retardoDeConsulta(
  query: string | undefined,
  debounceMs: number | undefined,
): number {
  if (debounceMs !== undefined) return debounceMs
  if (query === undefined || query.trim() === '') return 0

  return DEBOUNCE_MS
}

export type PanelState = 'loading' | 'ready' | 'error'

export interface Recommendations {
  readonly state: PanelState
  readonly data: RecommendationsResponse | undefined
  readonly error: Fallo | undefined
  readonly reload: () => void
}

export interface UseRecommendationsOptions {
  /** Se refresca cuando cambia: es la consulta que se está escribiendo. */
  readonly query?: string | undefined
  readonly limit?: number
  /** La mitad que se mira: el motor filtra sus candidatos antes de puntuar. */
  readonly media?: MediaHalf | undefined
  /** Retardo inyectable: una prueba no espera 400 ms. */
  readonly debounceMs?: number
}

export function recommendationsPath(
  query: string | undefined,
  limit: number,
  media: MediaHalf | undefined = undefined,
): string {
  const parametros = new URLSearchParams({ limit: String(limit) })
  if (query !== undefined && query.trim() !== '') parametros.set('q', query.trim())
  if (media !== undefined) parametros.set('media', media)

  return `/api/recommendations?${parametros.toString()}`
}

/** Lo que se sabe de una ruta de recomendaciones, con la ruta a la que pertenece. */
export interface RecommendationsStore {
  readonly ruta: string
  readonly state: PanelState
  readonly data: RecommendationsResponse | undefined
  readonly error: Fallo | undefined
}

/**
 * Lo que se puede enseñar de esta ruta.
 *
 * Si lo guardado es de otra —otro `?tipo=`, otra consulta—, no se hereda: la
 * ruta nueva empieza en «cargando» con la lista vacía. Es la transición A→B, y
 * es una función pura para poder medirla sin un DOM.
 */
export function recommendationsVisible(
  guardado: RecommendationsStore,
  ruta: string,
): Pick<RecommendationsStore, 'state' | 'data' | 'error'> {
  if (guardado.ruta === ruta) {
    return { state: guardado.state, data: guardado.data, error: guardado.error }
  }

  return { state: 'loading', data: undefined, error: undefined }
}

export function useRecommendations(options: UseRecommendationsOptions = {}): Recommendations {
  const planificador = useRef<ReturnType<typeof createScheduler> | undefined>(undefined)
  const retardo = retardoDeConsulta(options.query, options.debounceMs)
  const ruta = recommendationsPath(options.query, options.limit ?? 10, options.media)
  const [guardado, setGuardado] = useState<RecommendationsStore>(() => ({
    ruta,
    state: 'loading',
    data: undefined,
    error: undefined,
  }))

  /**
   * Volver a pedir lo mismo.
   *
   * Vuelve a programar sobre el planificador que ya existe en vez de forzar un
   * efecto nuevo: el planificador cancela lo pendiente y lo que esté en vuelo, así
   * que reintentar no duplica la petición, y el efecto no necesita una dependencia
   * que no lee.
   */
  const reload = useCallback(() => {
    setGuardado({ ruta, state: 'loading', data: undefined, error: undefined })
    planificador.current?.schedule(ruta)
  }, [ruta])

  useEffect(() => {
    const plan = createScheduler({
      delayMs: retardo,
      load: async (clave, signal) => {
        try {
          const salida = await apiGet(clave, recommendationsResponseSchema, { signal })
          if (signal.aborted) return

          setGuardado({ ruta: clave, state: 'ready', data: salida, error: undefined })
        } catch (cause) {
          if (signal.aborted) return

          setGuardado({
            ruta: clave,
            state: 'error',
            data: undefined,
            error: describirFallo(cause),
          })
        }
      },
    })
    planificador.current = plan
    plan.schedule(ruta)

    return () => {
      plan.cancel()
      planificador.current = undefined
    }
  }, [ruta, retardo])

  return {
    ...recommendationsVisible(guardado, ruta),
    reload,
  }
}
