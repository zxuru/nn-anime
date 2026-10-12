/**
 * Los dibujos del reproductor.
 *
 * Son SVG en línea y no una biblioteca de iconos: el proyecto no tiene
 * dependencias de interfaz —el paquete web se compone a mano— y un juego de seis
 * iconos no justifica la primera. Van sin relleno propio y con la clase que les
 * da el color: así el mismo dibujo sirve para el mando apagado y para el activo.
 *
 * Todos llevan `aria-hidden`: el nombre lo pone el botón que los contiene, y un
 * dibujo con nombre propio haría que el lector de pantalla leyera dos veces el
 * mismo mando.
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
