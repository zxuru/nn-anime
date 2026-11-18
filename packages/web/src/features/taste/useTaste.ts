/**
 * Lectura y escritura del perfil de gustos desde la interfaz.
 *
 * Tres lecturas y una escritura, todas contra la API y validadas con su schema.
 * La encuesta y el aviso del inicio comparten `useTaste`: el cliente HTTP ya
 * deduplica la lectura, así que dos componentes que la piden a la vez no hacen
 * dos peticiones.
 */

import type { MediaHalf } from '@rona/core/media'
import type {
  TasteResponse,
  TasteRowsResponse,
  TasteSurveyRequest,
  TasteTitlesResponse,
} from '@rona/core/taste'
import {
  tasteResponseSchema,
  tasteRowsResponseSchema,
  tasteTitlesResponseSchema,
} from '@rona/core/taste'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPostJson } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

export type TasteState = 'loading' | 'ready' | 'error'

export interface TasteData {
  readonly state: TasteState
  readonly data: TasteResponse | undefined
  readonly error: Fallo | undefined
  readonly reload: () => void
  readonly save: (answers: TasteSurveyRequest) => Promise<TasteResponse>
}

/** El camino de la lectura del perfil. Sin caché: es del usuario y cambia. */
export const TASTE_PATH = '/api/taste'

export function useTaste(): TasteData {
  const [data, setData] = useState<TasteResponse | undefined>(undefined)
  const [state, setState] = useState<TasteState>('loading')
  const [error, setError] = useState<Fallo | undefined>(undefined)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  const load = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setState('loading')
    setError(undefined)

    void apiGet(TASTE_PATH, tasteResponseSchema, { signal: controller.signal }).then(
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

  const save = useCallback(async (answers: TasteSurveyRequest): Promise<TasteResponse> => {
    const cuerpo = await apiPostJson(TASTE_PATH, answers, tasteResponseSchema)
    setData(cuerpo)
    setState('ready')
    setError(undefined)

    return cuerpo
  }, [])

  return { state, data, error, reload: load, save }
}

export interface TasteTitles {
  readonly items: TasteTitlesResponse['items']
  readonly loading: boolean
}

/** Los títulos del paso 2. Sin ellos la encuesta sigue siendo contestable. */
export function useTasteTitles(): TasteTitles {
  const [items, setItems] = useState<TasteTitlesResponse['items']>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    void apiGet('/api/taste/titles', tasteTitlesResponseSchema, {
      signal: controller.signal,
    }).then(
      (cuerpo) => {
        if (controller.signal.aborted) return

        setItems(cuerpo.items)
        setLoading(false)
      },
      () => {
        if (controller.signal.aborted) return

        // Un catálogo todavía vacío no es un fallo de la encuesta: el paso se
        // queda sin tarjetas y se puede seguir.
        setLoading(false)
      },
    )

    return () => controller.abort()
  }, [])

  return { items, loading }
}

/** La ruta de las filas del inicio, con la mitad que se está mirando. */
export function tasteRowsPath(media: MediaHalf | undefined): string {
  return media === undefined ? '/api/taste/rows' : `/api/taste/rows?media=${media}`
}

export interface TasteRows {
  readonly rows: TasteRowsResponse['rows']
  readonly loading: boolean
}

/**
 * Las filas «Porque te gusta…».
 *
 * Se leen aparte de las recomendaciones porque cambian por otra cosa: el motor
 * ordena una lista, esto agrupa por un género declarado. Si falla, no se pinta
 * ninguna fila y la home conserva las suyas.
 */
export function useTasteRows(media: MediaHalf | undefined): TasteRows {
  const [rows, setRows] = useState<TasteRowsResponse['rows']>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    setLoading(true)
    void apiGet(tasteRowsPath(media), tasteRowsResponseSchema, {
      signal: controller.signal,
    }).then(
      (cuerpo) => {
        if (controller.signal.aborted) return

        setRows(cuerpo.rows)
        setLoading(false)
      },
      () => {
        if (controller.signal.aborted) return

        setRows([])
        setLoading(false)
      },
    )

    return () => controller.abort()
  }, [media])

  return { rows, loading }
}
