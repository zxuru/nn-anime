/**
 * La barra de progreso: qué posición pinta y qué hace el puntero sobre ella.
 *
 * La posición que se pinta **no es siempre la del elemento**. Mientras se arrastra
 * manda el dedo: sin eso, la barra es un campo controlado por el estado del
 * reproductor y el pulgar vuelve a su sitio entre dos avisos del elemento —el
 * `timeupdate` llega cuatro veces por segundo—, así que se ve temblar y cuesta
 * soltarlo donde se quiere. Al soltar, manda el video.
 *
 * Y el globo con el segundo bajo el puntero es estado y no CSS porque el texto
 * cambia con la posición; se apaga al salir de la barra para no tapar el video.
 */

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useState } from 'react'

/**
 * La duración que entiende la barra.
 *
 * Cero mientras el elemento no la sabe —o si dice `NaN`—: un `input` de rango con
 * un máximo que no es número se queda sin carril, y el carril es lo que se pinta.
 */
export function duracionDeLaBarra(durationS: number): number {
  return Number.isFinite(durationS) && durationS > 0 ? durationS : 0
}

/**
 * La posición que se pinta, sin pasarse de la duración conocida.
 *
 * El arrastre gana a la posición del elemento, y el tope existe porque el
 * `currentTime` puede quedar por delante de una duración que el elemento acaba de
 * corregir: la barra se saldría de su carril.
 */
export function posicionEnLaBarra(
  arrastre: number | undefined,
  positionS: number,
  duracion: number,
): number {
  return Math.min(arrastre ?? positionS, duracion)
}

export interface BarraDelReproductor {
  readonly duracion: number
  /** La que se pinta: la del arrastre mientras dura, la del video después. */
  readonly posicion: number
  /** El segundo bajo el puntero, si está sobre la barra. */
  readonly sobreBarra: number | undefined
  /** El arrastre: el dedo manda y el salto se pide en el acto. */
  readonly arrastrar: (segundos: number) => void
  /** Se soltó: vuelve a mandar el video. */
  readonly soltar: () => void
  /** El globo con el segundo que hay bajo el puntero. */
  readonly moverPuntero: (evento: ReactPointerEvent<HTMLDivElement>) => void
  readonly salir: () => void
}

export interface BarraOpciones {
  readonly positionS: number
  readonly durationS: number
  readonly seekTo: (segundos: number) => void
}

export function usePlayerBarra(opciones: BarraOpciones): BarraDelReproductor {
  const [arrastre, setArrastre] = useState<number | undefined>(undefined)
  const [sobreBarra, setSobreBarra] = useState<number | undefined>(undefined)

  const duracion = duracionDeLaBarra(opciones.durationS)
  const posicion = posicionEnLaBarra(arrastre, opciones.positionS, duracion)

  const arrastrar = useCallback(
    (segundos: number) => {
      setArrastre(segundos)
      opciones.seekTo(segundos)
    },
    [opciones.seekTo],
  )
  const soltar = useCallback(() => setArrastre(undefined), [])
  const salir = useCallback(() => setSobreBarra(undefined), [])

  const moverPuntero = useCallback(
    (evento: ReactPointerEvent<HTMLDivElement>) => {
      if (duracion <= 0) return

      const caja = evento.currentTarget.getBoundingClientRect()
      if (caja.width <= 0) return

      const proporcion = Math.min(Math.max((evento.clientX - caja.left) / caja.width, 0), 1)
      setSobreBarra(proporcion * duracion)
    },
    [duracion],
  )

  return { duracion, posicion, sobreBarra, arrastrar, soltar, moverPuntero, salir }
}
