/**
 * Datos de la pantalla de detalle.
 *
 * Tres peticiones en paralelo —detalle, episodios y capacidades del proveedor—
 * porque ninguna necesita a las otras: en serie, la pantalla tardaría la suma de
 * las tres latencias sin ninguna razón.
 *
 * Las capacidades vienen de `/api/providers` y no del detalle: son del proveedor,
 * no del título, y el selector sub/dub se deshabilita según lo que ese proveedor
 * diga saber hacer. Un plugin que no dobla no debe ofrecer un botón de doblaje
 * que va a fallar.
 *
 * La interfaz valida cada respuesta con el schema compartido de `core`: si el
 * server cambia una forma, falla aquí y no tres componentes más abajo con un
 * campo en `undefined`.
 */

import {
  animeResponseSchema,
  episodesResponseSchema,
  providersResponseSchema,
} from '@nn-anime/core/api'
import type { AnimeDetail, Episode, ProviderCapabilities, ProviderRef } from '@nn-anime/core/models'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'

export type DetailState = 'loading' | 'ready' | 'error'

export interface DetailData {
  readonly detail: AnimeDetail | undefined
  readonly episodes: readonly Episode[]
  readonly capabilities: ProviderCapabilities | undefined
  readonly state: DetailState
  readonly error: string | undefined
  readonly reload: () => void
}

/** Los modos que el proveedor dice poder servir, en el orden en que se ofrecen. */
export function modesFor(capabilities: ProviderCapabilities | undefined): readonly PlayMode[] {
  if (capabilities === undefined) return []

  return PLAY_MODES.filter((modo) => capabilities[modo])
}

/**
 * El modo con el que se abre el reproductor.
 *
 * Manda el elegido a mano, siempre que el proveedor lo ofrezca; si no —o si aún
 * no se ha elegido— el primero disponible. Sin la comprobación, una preferencia
 * guardada de un proveedor que dejó de doblar abriría el reproductor en un modo
 * que va a fallar.
 */
export function chosenMode(
  available: readonly PlayMode[],
  preferred: PlayMode | undefined,
): PlayMode | undefined {
  if (preferred !== undefined && available.includes(preferred)) return preferred

  return available[0]
}

/** Duración legible, o nada si el proveedor no la dice. */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined

  const minutos = Math.round(seconds / 60)

  return minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`
}

export function useDetail(providerId: string, ref: string): DetailData {
  const [detail, setDetail] = useState<AnimeDetail | undefined>(undefined)
  const [episodes, setEpisodes] = useState<readonly Episode[]>([])
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | undefined>(undefined)
  const [state, setState] = useState<DetailState>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  /**
   * La carga, en una función que se puede volver a llamar.
   *
   * Con un contador de intentos, el efecto tendría una dependencia que no usa y
   * el linter lo señala con razón. Así el reintento ejecuta exactamente lo mismo
   * que el primer intento, y la petición anterior se aborta al empezar la nueva.
   */
  const load = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const opciones = { signal: controller.signal }

    setState('loading')
    setError(undefined)

    void Promise.all([
      apiGet(
        `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}`,
        animeResponseSchema,
        opciones,
      ),
      apiGet(
        `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/episodes`,
        episodesResponseSchema,
        opciones,
      ),
      apiGet('/api/providers', providersResponseSchema, opciones),
    ]).then(
      ([detalle, lista, proveedores]) => {
        if (controller.signal.aborted) return

        setDetail(detalle)
        setEpisodes(lista.episodes)
        setCapabilities(
          proveedores.providers.find((provider) => provider.id === providerId)?.capabilities,
        )
        setState('ready')
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return

        setError(cause instanceof Error ? cause.message : String(cause))
        setState('error')
      },
    )
  }, [providerId, ref])

  useEffect(() => {
    load()

    return () => controllerRef.current?.abort()
  }, [load])

  return { detail, episodes, capabilities, state, error, reload: load }
}

export interface FavoriteState {
  readonly value: boolean
  readonly busy: boolean
  readonly toggle: () => void
}

/**
 * Favorito con estado inmediato.
 *
 * Se pinta el cambio antes de que el servidor conteste y se revierte si falla:
 * un botón que espera a la red para cambiar de color se siente roto. Si la
 * petición falla, el estado vuelve a lo que había, que es la verdad.
 */
export function useFavorite(ref: ProviderRef, initial = false): FavoriteState {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)

  const toggle = useCallback(() => {
    const siguiente = !value
    setValue(siguiente)
    setBusy(true)

    void apiPost('/api/favorites', { ref, value: siguiente }).then(
      () => setBusy(false),
      () => {
        setValue(!siguiente)
        setBusy(false)
      },
    )
  }, [ref, value])

  return { value, busy, toggle }
}
