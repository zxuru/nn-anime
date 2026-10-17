/**
 * Datos del Perfil y de su Historial.
 *
 * Los dos viven aquí porque son **la misma familia de lecturas**: el Perfil es una
 * respuesta agregada y el Historial es su cuarta sección paginada, así que comparten
 * el contrato —`watchHistoryResponseSchema` es el mismo en los dos— y separarlos en
 * dos archivos daría dos imports del mismo schema y ninguna ventaja.
 *
 * El Perfil se pide **entero y de una vez**: el servidor compone las cuatro listas en
 * una sola respuesta y la interfaz sólo la valida. Con cuatro peticiones en paralelo,
 * una que fallara dejaría tres secciones pintadas y un hueco que nadie explica; aquí,
 * o está el Perfil o está en error y se puede reintentar.
 */

import type { ProfileResponse, WatchHistoryResponse } from '@nn-anime/core/api'
import { profileResponseSchema, watchHistoryResponseSchema } from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

export type ProfileState = 'loading' | 'ready' | 'error'

export interface ProfileData {
  readonly state: ProfileState
  readonly data: ProfileResponse | undefined
  /** El fallo, ya clasificado: la pantalla dice qué pasó, no el mensaje del cliente. */
  readonly error: Fallo | undefined
  readonly reload: () => void
}

/**
 * La ruta de una página del Historial.
 *
 * `page` va **siempre**, también la primera: el servidor trata la ausencia como la 1,
 * pero una lectura sin página y otra con `?page=1` son dos claves distintas en la
 * caché del cliente, y la pantalla que trocea en páginas nunca debería pedir una
 * lista sin decir cuál. Es la misma decisión que la lista de episodios.
 */
export function historyPath(page: number): string {
  return `/api/watch/history?page=${page}`
}

/** La página pedida en la dirección, base 1. Lo que no se entiende es la 1. */
export function pageOfPath(path: string): number {
  const crudo = new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? ''
  const numero = Number(crudo)

  return Number.isInteger(numero) && numero >= 1 ? numero : 1
}

export function useProfile(): ProfileData {
  const [data, setData] = useState<ProfileResponse | undefined>(undefined)
  const [state, setState] = useState<ProfileState>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  /**
   * La carga, en una función que se puede volver a llamar.
   *
   * El reintento ejecuta exactamente lo mismo que el primer intento —no un contador
   * de intentos, que añadiría una dependencia que el efecto no usa— y la petición
   * anterior se aborta al empezar la nueva.
   */
  const load = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setState('loading')
    setError(undefined)

    void apiGet('/api/profile', profileResponseSchema, { signal: controller.signal }).then(
      (cuerpo) => {
        if (controller.signal.aborted) return

        setData(cuerpo)
        setState('ready')
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return

        setError(describirFallo(cause))
        setState('error')
      },
    )
  }, [])

  useEffect(() => {
    load()

    return () => controllerRef.current?.abort()
  }, [load])

  return { state, data, error, reload: load }
}

export type HistoryState = 'loading' | 'ready' | 'error'

export interface HistoryPageData {
  readonly state: HistoryState
  readonly data: WatchHistoryResponse | undefined
  readonly error: Fallo | undefined
  readonly reload: () => void
}

/**
 * Una página del Historial, que cambia cuando cambia la página de la dirección.
 *
 * La página es un parámetro y no un estado interno del gancho: vive en la dirección
 * para que se pueda recargar y compartir, y para que el botón de atrás del navegador
 * vuelva a la página anterior en vez de salir de la pantalla. Es lo mismo que hace la
 * búsqueda con `?q=`.
 */
export function useHistoryPage(page: number): HistoryPageData {
  const [data, setData] = useState<WatchHistoryResponse | undefined>(undefined)
  const [state, setState] = useState<HistoryState>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  const load = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setState('loading')
    setError(undefined)

    void apiGet(historyPath(page), watchHistoryResponseSchema, { signal: controller.signal }).then(
      (cuerpo) => {
        if (controller.signal.aborted) return

        setData(cuerpo)
        setState('ready')
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return

        setError(describirFallo(cause))
        setState('error')
      },
    )
  }, [page])

  useEffect(() => {
    load()

    return () => controllerRef.current?.abort()
  }, [load])

  return { state, data, error, reload: load }
}
