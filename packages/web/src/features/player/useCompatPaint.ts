/**
 * El modo compatible: la sonda y el bucle, atados al `<video>`.
 *
 * El porqué está en `compat-paint.ts`; aquí sólo está el DOM. La sonda corre una
 * vez por fuente —al tener el primer fotograma y otra vez al empezar a
 * reproducir, que es cuando el usuario mira— y el bucle se para solo cuando el
 * elemento no da fotogramas nuevos, porque es el elemento quien avisa.
 *
 * El modo tiene dos manos: la automática, que es la sonda, y la del botón. La del
 * botón gana: una sonda que sólo mira un fotograma puede no ver el fallo, y quien
 * lo está sufriendo no tiene por qué esperar a que la sonda se convenza.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { frameHasImage, PROBE_SIDE, probeDecision, startCompatPainter } from './compat-paint'

export interface CompatPaintOptions {
  /** El elemento, cuando React ya lo montó. */
  readonly video: HTMLVideoElement | null
  /** La fuente: cambiar de episodio o de modo vuelve a sondear. */
  readonly url: string
}

export interface CompatPaint {
  /** Si los fotogramas los pinta este programa. */
  readonly pintando: boolean
  readonly alternar: () => void
  readonly canvasRef: (nodo: HTMLCanvasElement | null) => void
}

/**
 * Dibuja el fotograma actual en un canvas del tamaño de la sonda y dice si lo
 * que se lee tiene imagen.
 *
 * `undefined` es «no se pudo leer» y no «no hay imagen»: leer los píxeles de un
 * canvas manchado por una fuente de otro origen lanza, y confundir eso con un
 * cuadro negro encendería el modo por un motivo que no es.
 *
 * `software` pide el canvas por CPU, que es lo que hace que el mismo fotograma
 * se lea por los dos caminos y se puedan comparar.
 */
function readFrame(video: HTMLVideoElement, software: boolean): boolean | undefined {
  const ancho = Math.max(1, Math.min(video.videoWidth, PROBE_SIDE))
  const alto = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * ancho))
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto

  const contexto = software
    ? lienzo.getContext('2d', { willReadFrequently: true })
    : lienzo.getContext('2d')

  if (contexto === null) return undefined

  try {
    contexto.drawImage(video, 0, 0, ancho, alto)

    return frameHasImage(contexto.getImageData(0, 0, ancho, alto).data)
  } catch {
    // Sin píxeles que leer no se decide nada: mejor no tocar el reproductor.
    return undefined
  }
}

/** ¿La GPU del navegador no pinta el fotograma y la CPU sí? */
function gpuDoesNotPaint(video: HTMLVideoElement): boolean {
  if (video.videoWidth === 0 || video.videoHeight === 0) return false

  const gpu = readFrame(video, false)
  const cpu = readFrame(video, true)

  if (gpu === undefined || cpu === undefined) return false

  return probeDecision({ gpu, cpu })
}

/** El siguiente fotograma del elemento, por donde el navegador lo dé. */
function requestFrame(video: HTMLVideoElement, callback: () => void): number {
  if (typeof video.requestVideoFrameCallback === 'function') {
    return video.requestVideoFrameCallback(() => callback())
  }

  return requestAnimationFrame(callback)
}

function cancelFrame(video: HTMLVideoElement, handle: number): void {
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.cancelVideoFrameCallback(handle)

    return
  }

  cancelAnimationFrame(handle)
}

export function useCompatPaint(options: CompatPaintOptions): CompatPaint {
  const { video, url } = options
  const [automatico, setAutomatico] = useState(false)
  const [manual, setManual] = useState<boolean | undefined>(undefined)
  const [lienzo, setLienzo] = useState<HTMLCanvasElement | null>(null)

  const pintando = manual ?? automatico

  const canvasRef = useCallback((nodo: HTMLCanvasElement | null) => {
    setLienzo(nodo)
  }, [])

  const alternar = useCallback(() => {
    setManual((previo) => !(previo ?? automatico))
  }, [automatico])

  /**
   * La última fuente sondeada.
   *
   * Es lo que hace que la sonda corra **una vez por fuente** y no en cada vuelta
   * del efecto: el elemento cambia de identidad al montar, y volver a sondear el
   * mismo episodio sería trabajo repetido.
   */
  const sondeada = useRef<string | undefined>(undefined)

  useEffect(() => {
    // Cada fuente empieza de cero: el modo automático es de esta reproducción, y
    // arrastrarlo al episodio siguiente encendería la CPU sin motivo. Se compara
    // con la última sondeada porque el elemento cambia de identidad al montar y
    // el mismo episodio no se sondea dos veces.
    if (sondeada.current !== url) {
      sondeada.current = url
      setAutomatico(false)
    }

    if (video === null) return

    let vivo = true
    const sondear = (): void => {
      if (!vivo) return
      if (gpuDoesNotPaint(video)) setAutomatico(true)
    }

    // `loadeddata` es el primer fotograma dentro del elemento y `playing`, la
    // reproducción de verdad. Se sondan los dos —la sonda no cuesta nada— porque
    // un fotograma negro al cargar apagaría la decisión para siempre.
    video.addEventListener('loadeddata', sondear)
    video.addEventListener('playing', sondear)

    return () => {
      vivo = false
      video.removeEventListener('loadeddata', sondear)
      video.removeEventListener('playing', sondear)
    }
  }, [video, url])

  useEffect(() => {
    if (!pintando || video === null || lienzo === null) return

    // `willReadFrequently` pide el canvas rasterizado por CPU, que es todo el
    // arreglo: el lienzo acaba en el compositor como textura corriente, sin la
    // conversión YUV en la GPU que deja el cuadro negro.
    const contexto = lienzo.getContext('2d', { willReadFrequently: true })
    if (contexto === null) return

    return startCompatPainter({
      videoWidth: () => video.videoWidth,
      videoHeight: () => video.videoHeight,
      resize: (ancho, alto) => {
        lienzo.width = ancho
        lienzo.height = alto
      },
      paint: () => contexto.drawImage(video, 0, 0, lienzo.width, lienzo.height),
      requestFrame: (callback) => requestFrame(video, callback),
      cancelFrame: (handle) => cancelFrame(video, handle),
    })
  }, [pintando, video, lienzo])

  return { pintando, alternar, canvasRef }
}
