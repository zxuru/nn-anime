/**
 * El clic y el doble clic sobre la imagen, y la referencia del `<video>`.
 *
 * El navegador no dice «esto era un clic» hasta que pasa la ventana del doble
 * clic: manda `click`, `click` y luego `dblclick`. Sin una espera corta, el clic
 * sencillo y el doble son el mismo gesto para nosotros, y el que lleva las de
 * perder es el que más se usa —pausar—, que se sentiría tarde.
 *
 * El doble gesto es la convención de todos los reproductores y aquí es además lo
 * que deja quitar los botones de ±10 s en un teléfono: el borde izquierdo
 * retrocede, el derecho adelanta. La pantalla completa se queda en el centro y
 * sólo con ratón: en táctil, el doble toque en medio es hacer zum y lo resuelve el
 * navegador.
 *
 * El elemento vive aquí en estado y no sólo en la referencia de `usePlayer`
 * porque el modo compatible necesita **mirarlo** —el fotograma— y pintarlo: el
 * pintado arranca cuando el `<canvas>` ya está montado, y eso pasa por un render.
 */

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CLICK_DELAY_MS, type PlayerAction } from './controls'

/** Zona de los bordes del video, en tanto por uno, donde el doble toque salta. */
const ZONA_SALTO = 0.3

/** Lo que hace un doble gesto sobre un punto del video. */
export type GestoDoble = 'atras' | 'adelante' | 'pantalla-completa'

/**
 * Qué hace el doble gesto en un punto del video, en tanto por uno de su ancho.
 *
 * Se decide con el punto y no con el elemento para poder medirlo sin navegador:
 * es la regla que reparte los tres gestos y la que dice dónde acaba la zona de
 * salto.
 */
export function gestoDelDobleClic(relativo: number): GestoDoble {
  if (relativo <= ZONA_SALTO) return 'atras'
  if (relativo >= 1 - ZONA_SALTO) return 'adelante'

  return 'pantalla-completa'
}

/**
 * ¿El dispositivo tiene puntero fino?
 *
 * El doble clic para la pantalla completa sólo tiene sentido con ratón: en una
 * pantalla táctil, el doble toque es hacer zum, y el navegador lo resuelve él.
 * Se pregunta en el momento del gesto y no al montar: el mismo navegador cambia
 * de respuesta cuando se le enchufa un ratón.
 */
export function punteroFino(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true
}

export interface GestosDelVideo {
  /** El elemento, cuando React ya lo montó. */
  readonly elemento: HTMLVideoElement | null
  /** La referencia que se le da al `<video>`. */
  readonly refVideo: (nodo: HTMLVideoElement | null) => void
  readonly alClic: () => void
  readonly alDobleClic: (evento: ReactPointerEvent<HTMLVideoElement>) => void
}

export interface GestosOpciones {
  /** La referencia que guarda `usePlayer`: el medio es suyo. */
  readonly videoRef: (elemento: HTMLVideoElement | null) => void
  /** El aviso para quien monta el reproductor —la sala—, si lo hay. */
  readonly onVideoElement: ((elemento: HTMLVideoElement | null) => void) | undefined
  readonly act: (accion: PlayerAction) => void
}

export function usePlayerGestos(opciones: GestosOpciones): GestosDelVideo {
  const { videoRef, act } = opciones
  const [elemento, setElemento] = useState<HTMLVideoElement | null>(null)

  /**
   * El aviso del elemento, en una referencia.
   *
   * Si quien monta el reproductor pasa una función nueva en cada render, el
   * `ref` cambiaría de identidad y React lo volvería a llamar con `null` y con
   * el elemento en cada vuelta —desmontando y montando la referencia del video—.
   * Con la referencia, el callback del ref es estable y el aviso siempre es el
   * último.
   */
  const avisoElemento = useRef(opciones.onVideoElement)
  avisoElemento.current = opciones.onVideoElement

  const refVideo = useCallback(
    (nodo: HTMLVideoElement | null) => {
      videoRef(nodo)
      setElemento(nodo)
      avisoElemento.current?.(nodo)
    },
    [videoRef],
  )

  const clicPendiente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelarClic = useCallback(() => {
    if (clicPendiente.current === undefined) return

    clearTimeout(clicPendiente.current)
    clicPendiente.current = undefined
  }, [])
  // Un temporizador vivo después del desmontaje pausaría un video que ya no está.
  useEffect(() => cancelarClic, [cancelarClic])

  const alClic = useCallback(() => {
    cancelarClic()
    clicPendiente.current = setTimeout(() => {
      clicPendiente.current = undefined
      act('toggle')
    }, CLICK_DELAY_MS)
  }, [act, cancelarClic])

  const alDobleClic = useCallback(
    (evento: ReactPointerEvent<HTMLVideoElement>) => {
      cancelarClic()

      const caja = evento.currentTarget.getBoundingClientRect()
      const relativo = caja.width <= 0 ? 0.5 : (evento.clientX - caja.left) / caja.width

      switch (gestoDelDobleClic(relativo)) {
        case 'atras':
          act('back')

          return
        case 'adelante':
          act('forward')

          return
        case 'pantalla-completa':
          if (!punteroFino()) return

          act('fullscreen')

          return
      }
    },
    [act, cancelarClic],
  )

  return { elemento, refVideo, alClic, alDobleClic }
}
