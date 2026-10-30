/**
 * Los dibujos del reproductor.
 *
 * Son los de lucide, como el resto de la interfaz: desde que la aplicación tiene
 * un juego de iconos, un reproductor con dibujos propios se leía como una pieza
 * de otra aplicación. Los nombres exportados no cambian —`IconoReproducir`,
 * `IconoPausar`…— para que quien los usa no sepa de dónde salen.
 *
 * Todos llevan `aria-hidden`: el nombre lo pone el botón que los contiene, y un
 * dibujo con nombre propio haría que el lector de pantalla leyera dos veces el
 * mismo mando. El color lo hereda del botón; el relleno sólo lo llevan los dos
 * que se leen como silueta —reproducir y pausar—, porque un triángulo de trazo
 * fino a 20 px se confunde con el icono de «avanzar».
 */

import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { ReactNode } from 'react'

/** El tamaño del mando. Uno solo para todo el reproductor. */
const SIZE = 20

export interface GlifoProps {
  readonly className?: string
}

/** El triángulo de reproducir. */
export function IconoReproducir(props: GlifoProps): ReactNode {
  return (
    <Play
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** Las dos barras de la pausa. */
export function IconoPausar(props: GlifoProps): ReactNode {
  return (
    <Pause
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** La vuelta de diez segundos hacia atrás. */
export function IconoAtras(props: GlifoProps): ReactNode {
  return (
    <RotateCcw
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** La vuelta de diez segundos hacia adelante. */
export function IconoAdelante(props: GlifoProps): ReactNode {
  return (
    <RotateCw
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** El altavoz, con sus ondas. */
export function IconoVolumen(props: GlifoProps): ReactNode {
  return (
    <Volume2
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** El altavoz tachado: el sonido está apagado. */
export function IconoSilencio(props: GlifoProps): ReactNode {
  return (
    <VolumeX
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** Las cuatro esquinas hacia fuera: entrar en pantalla completa. */
export function IconoPantallaCompleta(props: GlifoProps): ReactNode {
  return (
    <Maximize
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** Las cuatro esquinas hacia dentro: salir de pantalla completa. */
export function IconoSalirPantallaCompleta(props: GlifoProps): ReactNode {
  return (
    <Minimize
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}

/** Los mandos: el carril con sus dos tiradores. */
export function IconoAjustes(props: GlifoProps): ReactNode {
  return (
    <Settings
      className={props.className ?? 'player__icon'}
      size={SIZE}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    />
  )
}
