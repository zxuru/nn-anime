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

/** Una pista que el reproductor puede pintar. */
export interface SafeTrack {
  readonly url: string
  readonly lang: string
  readonly label: string
}

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

/**
 * Carga `hls.js` y conecta el elemento. Devuelve cómo destruirlo.
 *
 * `alFallar` recibe el detalle de un error **fatal** de la biblioteca. Hace
 * falta un oído: hls.js no lanza, avisa, y el elemento no dispara `error` cuando
 * lo que falla es el Media Source. Sin esto, un corte de red o un códec que el
 * navegador no decodifica se quedan en una pantalla negra sin decir nada.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  alFallar?: (detalle: string) => void,
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

    hls.on(Hls.Events.ERROR, (_evento, datos) => {
      // Los no fatales se reintentan por dentro: avisar de ellos sería llenar la
      // pantalla de avisos que se arreglan solos.
      if (datos.fatal) alFallar?.(datos.details)
    })

    hls.loadSource(url)
    hls.attachMedia(video)

    return { destroy: () => hls.destroy() }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export interface UsePlayerOptions {
  readonly url: string
  readonly kind: string
  /** Se llama al empezar a reproducir de verdad. */
  readonly onPlay?: (() => void) | undefined
  readonly onPause?: (() => void) | undefined
  readonly onProgress?: ((positionS: number, durationS: number) => void) | undefined
  /** Segundo en el que empezar. Sirve para reanudar y para cambiar de modo. */
  readonly startAtS?: number | undefined
}

export function usePlayer(source: UsePlayerOptions): PlayerHandle {
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
  /**
   * Los avisos, en referencias y no en las dependencias del efecto.
   *
   * Quien llama pasa funciones nuevas en cada render —`onProgress={(p) => ...}`
   * es lo natural—, y con ellas en las dependencias el efecto se volvía a
   * ejecutar en **cada** actualización de estado: volvía a asignar `video.src`,
   * el navegador recargaba el medio y la reproducción se quedaba en el segundo
   * cero. Lo encontró el e2e del reproductor, que veía `paused: true` y
   * `played.length: 0` después de darle a reproducir.
   */
  const avisos = useRef({
    onPlay: source.onPlay,
    onPause: source.onPause,
    onProgress: source.onProgress,
  })
  avisos.current = {
    onPlay: source.onPlay,
    onPause: source.onPause,
    onProgress: source.onProgress,
  }

  /**
   * El segundo en el que reanudar, en una referencia por el mismo motivo.
   *
   * Es la **posición viva** en el momento en que cambia la fuente —cambiar de
   * subtitulado a doblado tiene que seguir donde iba—, así que quien la pasa la
   * mueve en cada avance. Con ella en las dependencias, cada `timeupdate` volvía
   * a montar el medio y el navegador recargaba el video: se quedaba en el
   * segundo cero, en pausa y con la duración ya conocida. Es exactamente el
   * síntoma de «carga, dice cuánto dura y no reproduce».
   */
  const reanudarEn = useRef(source.startAtS)
  reanudarEn.current = source.startAtS

  const videoRef = useCallback((nuevo: HTMLVideoElement | null) => {
    elemento.current = nuevo
  }, [])

  useEffect(() => {
    const video = elemento.current
    if (video === null) return

    let vivo = true

    if (needsHls(source.kind)) {
      void attachHls(video, source.url, (detalle) => {
        if (!vivo) return

        setState((previo) => ({
          ...previo,
          error: `hls.js se detuvo: ${detalle}`,
          loading: false,
        }))
      }).then((resultado) => {
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

    // La reanudación se decide **una vez por fuente**, cuando el efecto arranca:
    // si se leyera en cada `durationchange`, un cambio de duración a mitad de
    // reproducción volvería a saltar a la posición de reanudación y daría un
    // tirón hacia adelante.
    const destino = reanudarEn.current ?? 0
    let reanudado = false

    const alTiempo = (): void => {
      setState((previo) => ({ ...previo, positionS: video.currentTime }))
      avisos.current.onProgress?.(video.currentTime, video.duration)
    }
    const alDuracion = (): void => {
      setState((previo) => ({ ...previo, durationS: video.duration }))

      // Reanudar: al saber la duración, se salta a donde se dejó. Se hace aquí y
      // no al montar porque el elemento todavía no admite un `currentTime` que no
      // conoce.
      if (!reanudado && destino > 0 && video.currentTime < destino) {
        video.currentTime = destino
        reanudado = true
      }
    }
    const alReproducir = (): void => {
      setState((previo) => ({ ...previo, playing: true }))
      avisos.current.onPlay?.()
    }
    const alPausar = (): void => {
      setState((previo) => ({ ...previo, playing: false }))
      avisos.current.onPause?.()
    }
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
    // Sólo la fuente: los avisos y la posición de reanudación van en referencias
    // y no vuelven a montar el medio. Ver la nota de `avisos` y la de
    // `reanudarEn`.
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
