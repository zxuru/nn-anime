/**
 * Los dibujos del reproductor.
 *
 * Son SVG en línea y no una biblioteca de iconos: el proyecto no tiene
 * dependencias de interfaz —el paquete web se compone a mano— y un juego de ocho
 * dibujos no justifica la primera. Van sin color propio y con `fill: currentcolor`
 * desde la hoja: así el mismo dibujo sirve para el mando apagado y para el activo
 * sin duplicarlo.
 *
 * Todos llevan `aria-hidden`: el nombre lo pone el botón que los contiene, y un
 * dibujo con nombre propio haría que el lector de pantalla leyera dos veces el
 * mismo mando.
 *
 * Las formas son bloques rectos —triángulos, barras y esquinas— porque es la
 * lengua visual de la interfaz: radios cero y aristas duras. Un icono de trazo
 * curvo se leería como de otra aplicación.
 */

import type { ReactNode } from 'react'

function Glifo(props: { readonly className: string; readonly d: string }): ReactNode {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={props.d} />
    </svg>
  )
}

/** El triángulo de reproducir. */
export function IconoReproducir(props: { readonly className?: string }): ReactNode {
  return <Glifo className={props.className ?? 'player__icon'} d="M6 3.5 21 12 6 20.5Z" />
}

/** Las dos barras de la pausa. */
export function IconoPausar(props: { readonly className?: string }): ReactNode {
  return <Glifo className={props.className ?? 'player__icon'} d="M6 4h4v16H6Zm8 0h4v16h-4Z" />
}

/** Dos triángulos hacia atrás: el salto de diez segundos. */
export function IconoAtras(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo className={props.className ?? 'player__icon'} d="M12 5 2 12l10 7Zm10 0-10 7 10 7Z" />
  )
}

/** Los mismos dos triángulos, espejados: el salto hacia adelante. */
export function IconoAdelante(props: { readonly className?: string }): ReactNode {
  return <Glifo className={props.className ?? 'player__icon'} d="M2 5l10 7-10 7Zm10 0 10 7-10 7Z" />
}

/** El altavoz, con dos ondas. */
export function IconoVolumen(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo
      className={props.className ?? 'player__icon'}
      d="M3 9h4l5-5v16l-5-5H3Zm11.5-.5 4 3.5-4 3.5Zm5-2.5 4 6-4 6Z"
    />
  )
}

/** El altavoz tachado: el sonido está apagado. */
export function IconoSilencio(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo
      className={props.className ?? 'player__icon'}
      d="M3 9h4l5-5v16l-5-5H3Zm11.6.4L16 8l2 2 2-2 1.4 1.4-2 2 2 2L20 14.8l-2-2-2 2-1.4-1.4 2-2Z"
    />
  )
}

/** Las cuatro esquinas hacia fuera: entrar en pantalla completa. */
export function IconoPantallaCompleta(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo
      className={props.className ?? 'player__icon'}
      d="M3 3h7v3H6v4H3Zm11 0h7v7h-3V6h-4ZM3 14h3v4h4v3H3Zm15 0h3v7h-7v-3h4Z"
    />
  )
}

/** Las cuatro esquinas hacia dentro: salir de pantalla completa. */
export function IconoSalirPantallaCompleta(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo
      className={props.className ?? 'player__icon'}
      d="M3 10h7V3H7v4H3Zm11 0h7V7h-4V3h-3ZM3 14h4v4h3v3H3Zm11 0h7v7h-7v-3h4Z"
    />
  )
}

/**
 * Los mandos: tres barras con su tirador.
 *
 * Es el dibujo de «ajustes» y no un engranaje: un engranaje con radios cero son
 * ocho trapecios que a 20 px no se leen, y estas tres barras dicen lo mismo
 * —cosas que se regulan— sin depender del detalle.
 */
export function IconoAjustes(props: { readonly className?: string }): ReactNode {
  return (
    <Glifo
      className={props.className ?? 'player__icon'}
      d="M3 5h18v2H3Zm0 6h18v2H3Zm0 6h18v2H3Zm3.5-8h3v4h-3Zm7 6h3v4h-3Z"
    />
  )
}
