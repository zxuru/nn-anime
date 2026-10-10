/**
 * Estado del reproductor y carga de `hls.js`.
 *
 * `hls.js` se carga **con importación dinámica**: son unos 300 KB que sólo hacen
 * falta cuando alguien reproduce algo en HLS. Importarlo arriba engordaría la
 * búsqueda —la pantalla que todo el mundo usa— para servir a la que se usa de
 * vez en cuando.
 *
 * El estado que se publica es pequeño a propósito: si suena, por dónde va,
 * cuánto dura y qué falló. Todo lo demás lo sabe el elemento `<video>`, y
 * copiarlo aquí sería tener dos verdades.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { needsHls, type PlayerAction, SEEK_STEP_S, seekBy, volumeBy } from './controls'

export interface PlayerState {
  readonly playing: boolean
  readonly positionS: number
  readonly durationS: number
  readonly volume: number
  readonly muted: boolean
  readonly error: string | undefined
  readonly loading: boolean
}

export interface PlayerHandle {
  readonly state: PlayerState
  readonly videoRef: (elemento: HTMLVideoElement | null) => void
  readonly act: (action: PlayerAction) => void
  readonly seekTo: (seconds: number) => void
  readonly toggle: () => void
}

/** Carga `hls.js` y conecta el elemento. Devuelve cómo destruirlo. */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
): Promise<{ destroy: () => void } | { error: string }> {
  try {
    const { default: Hls } = await import('hls.js')

    if (!Hls.isSupported()) {
      // Safari reproduce HLS sin ayuda; si tampoco puede, se dice.
      if (video.canPlayType('application/vnd.apple.mpegurl') === '') {
        return { error: 'este navegador no puede reproducir HLS' }
      }

      video.src = url

      return { destroy: () => video.removeAttribute('src') }
    }

    const hls = new Hls({ enableWorker: true })

    hls.loadSource(url)
    hls.attachMedia(video)

    return { destroy: () => hls.destroy() }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function usePlayer(source: { readonly url: string; readonly kind: string }): PlayerHandle {
  const [state, setState] = useState<PlayerState>({
    playing: false,
    positionS: 0,
    durationS: 0,
    volume: 1,
    muted: false,
    error: undefined,
    loading: true,
  })

  const elemento = useRef<HTMLVideoElement | null>(null)
  const hls = useRef<{ destroy: () => void } | undefined>(undefined)

  const videoRef = useCallback((nuevo: HTMLVideoElement | null) => {
    elemento.current = nuevo
  }, [])

  useEffect(() => {
    const video = elemento.current
    if (video === null) return

    let vivo = true

    if (needsHls(source.kind)) {
      void attachHls(video, source.url).then((resultado) => {
        if (!vivo) {
          if ('destroy' in resultado) resultado.destroy()

          return
        }

        if ('error' in resultado) {
          setState((previo) => ({ ...previo, error: resultado.error, loading: false }))

          return
        }

        hls.current = resultado
        setState((previo) => ({ ...previo, loading: false }))
      })
    } else {
      video.src = source.url
      setState((previo) => ({ ...previo, loading: false }))
    }

    const alTiempo = (): void => setState((previo) => ({ ...previo, positionS: video.currentTime }))
    const alDuracion = (): void => setState((previo) => ({ ...previo, durationS: video.duration }))
    const alReproducir = (): void => setState((previo) => ({ ...previo, playing: true }))
    const alPausar = (): void => setState((previo) => ({ ...previo, playing: false }))
    const alError = (): void =>
      setState((previo) => ({ ...previo, error: 'no se pudo cargar el video', loading: false }))

    video.addEventListener('timeupdate', alTiempo)
    video.addEventListener('loadedmetadata', alDuracion)
    video.addEventListener('durationchange', alDuracion)
    video.addEventListener('play', alReproducir)
    video.addEventListener('pause', alPausar)
    video.addEventListener('error', alError)

    return () => {
      vivo = false
      video.removeEventListener('timeupdate', alTiempo)
      video.removeEventListener('loadedmetadata', alDuracion)
      video.removeEventListener('durationchange', alDuracion)
      video.removeEventListener('play', alReproducir)
      video.removeEventListener('pause', alPausar)
      video.removeEventListener('error', alError)

      hls.current?.destroy()
      hls.current = undefined
    }
  }, [source.kind, source.url])

  const act = useCallback((action: PlayerAction) => {
    const video = elemento.current
    if (video === null) return

    switch (action) {
      case 'toggle':
        if (video.paused) void video.play()
        else video.pause()

        return
      case 'forward':
        video.currentTime = seekBy(video.currentTime, SEEK_STEP_S, video.duration)

        return
      case 'back':
        video.currentTime = seekBy(video.currentTime, -SEEK_STEP_S, video.duration)

        return
      case 'volume-up':
        video.volume = volumeBy(video.volume, 0.1)
        setState((previo) => ({ ...previo, volume: video.volume }))

        return
      case 'volume-down':
        video.volume = volumeBy(video.volume, -0.1)
        setState((previo) => ({ ...previo, volume: video.volume }))

        return
      case 'mute':
        video.muted = !video.muted
        setState((previo) => ({ ...previo, muted: video.muted }))

        return
      case 'fullscreen':
        void video.requestFullscreen?.()

        return
    }
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const video = elemento.current
    if (video === null) return

    video.currentTime = seekBy(seconds, 0, video.duration)
  }, [])

  const toggle = useCallback(() => act('toggle'), [act])

  return { state, videoRef, act, seekTo, toggle }
}
