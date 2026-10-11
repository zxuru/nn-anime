/**
 * Datos de la pantalla de detalle.
 *
 * Cinco peticiones en paralelo —detalle, episodios, relacionados, vistos y
 * capacidades del proveedor— porque ninguna necesita a las otras: en serie, la
 * pantalla tardaría la suma de las cinco latencias sin ninguna razón.
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
  favoritesResponseSchema,
  providersResponseSchema,
  relatedResponseSchema,
  watchedResponseSchema,
} from '@nn-anime/core/api'
import type {
  AnimeDetail,
  AnimeSummary,
  Episode,
  ProviderCapabilities,
  ProviderRef,
} from '@nn-anime/core/models'
import type { WatchedEpisodePayload } from '@nn-anime/core/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'

export type DetailState = 'loading' | 'ready' | 'error'

export interface DetailData {
  readonly detail: AnimeDetail | undefined
  readonly episodes: readonly Episode[]
  /**
   * Los hermanos de saga, de lo que la base ya conoce.
   *
   * Es una lista y no un resultado: la petición sólo puede fallar si falla el
   * servidor entero, y en ese caso la ficha ya está en estado de error. Sin
   * relacionados la lista viene vacía y la sección se explica.
   */
  readonly related: readonly AnimeSummary[]
  /**
   * Qué episodios ya se vieron y por dónde iba cada uno.
   *
   * Es por número de episodio, no por par episodio y modo: verlo en subtitulado
   * es haberlo visto, y marcarlo dos veces partiría en dos la misma fila.
   */
  readonly watched: readonly WatchedEpisodePayload[]
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

/**
 * La proporción vista, en tanto por ciento entero.
 *
 * Redondea y no trunca: al 99,6 % la barra debe verse llena, y truncar dejaría
 * un hueco de un píxel que parece un fallo de pintado.
 */
export function watchedPercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0

  return Math.min(Math.round(ratio * 100), 100)
}

export function useDetail(providerId: string, ref: string): DetailData {
  const [detail, setDetail] = useState<AnimeDetail | undefined>(undefined)
  const [episodes, setEpisodes] = useState<readonly Episode[]>([])
  const [related, setRelated] = useState<readonly AnimeSummary[]>([])
  const [watched, setWatched] = useState<readonly WatchedEpisodePayload[]>([])
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
      apiGet(
        `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/related`,
        relatedResponseSchema,
        opciones,
      ),
      apiGet(
        `/api/anime/${encodeURIComponent(providerId)}/${encodeURIComponent(ref)}/watched`,
        watchedResponseSchema,
        opciones,
      ),
      apiGet('/api/providers', providersResponseSchema, opciones),
    ]).then(
      ([detalle, lista, hermanos, vistos, proveedores]) => {
        if (controller.signal.aborted) return

        setDetail(detalle)
        setEpisodes(lista.episodes)
        setRelated(hermanos.items)
        setWatched(vistos.episodes)
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

  return { detail, episodes, related, watched, capabilities, state, error, reload: load }
}

export interface FavoriteState {
  readonly value: boolean
  readonly busy: boolean
  readonly toggle: () => void
}

/**
 * Si el título está entre los favoritos.
 *
 * Se compara la referencia entera —proveedor y valor— y no sólo el valor: dos
 * proveedores pueden usar el mismo identificador para títulos distintos, y
 * mirar sólo uno de los dos marcaría como guardado algo que no lo está.
 */
export function isFavorite(favorites: readonly AnimeSummary[], ref: ProviderRef): boolean {
  return favorites.some(
    (item) => item.ref.providerId === ref.providerId && item.ref.value === ref.value,
  )
}

/**
 * Favorito con estado inmediato.
 *
 * Se pinta el cambio antes de que el servidor conteste y se revierte si falla:
 * un botón que espera a la red para cambiar de color se siente roto. Si la
 * petición falla, el estado vuelve a lo que había, que es la verdad.
 *
 * **El estado inicial se lee del servidor.** Antes empezaba siempre en «no
 * está»: en el cartel de destacado y en la ficha, un título ya guardado salía
 * sin marcar y el botón mentía hasta que se pulsaba dos veces. La lista se pide
 * **sin señal** a propósito: el cliente deduplica las lecturas por ruta, y con
 * una señal propia cada botón montado pediría la suya.
 */
export function useFavorite(ref: ProviderRef): FavoriteState {
  const [value, setValue] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * Si la persona ya pulsó.
   *
   * Una lista que llegue después no puede pisar lo que se acaba de decidir, y la
   * que se leyó antes del alta es vieja por definición.
   */
  const tocado = useRef(false)
  const providerId = ref.providerId
  const referencia = ref.value

  useEffect(() => {
    let vivo = true

    void apiGet('/api/favorites', favoritesResponseSchema).then(
      (lista) => {
        if (!vivo || tocado.current) return

        setValue(isFavorite(lista.favorites, { providerId, value: referencia }))
      },
      // Sin la lista no se afirma nada: el botón se queda en «no está» y quien lo
      // pulse sigue pudiendo guardar el título. Un favorito que no se pudo leer no
      // es motivo para dejar la pantalla sin botón.
      () => undefined,
    )

    return () => {
      vivo = false
    }
  }, [providerId, referencia])

  const toggle = useCallback(() => {
    tocado.current = true
    const siguiente = !value
    setValue(siguiente)
    setBusy(true)

    void apiPost('/api/favorites', {
      ref: { providerId, value: referencia },
      value: siguiente,
    }).then(
      () => setBusy(false),
      () => {
        setValue(!siguiente)
        setBusy(false)
      },
    )
  }, [providerId, referencia, value])

  return { value, busy, toggle }
}
