/**
 * La lámina del reproductor.
 *
 * El sistema entero se sostiene en que un hueco vacío es una lámina y no un
 * gris; el reproductor era la única superficie que no lo cumplía. Aquí se pinta
 * la portada del proveedor cuando llega y, si no llega o falla, el mismo campo
 * de degradado de las portadas con la inicial del título y el episodio en mono.
 *
 * La portada pasa por `Cover`, que ya resuelve el caso de la imagen que falla:
 * con una imagen válida manda la imagen; sin ella, el dibujo. La lámina se retira
 * en cuanto hay reproducción, así que el primer fotograma siempre tiene algo.
 *
 * Es decoración: no se anuncia (`aria-hidden`) y no recibe el puntero, así que
 * el clic sigue siendo del video.
 */

import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'

const CAMPOS = ['a', 'b', 'c', 'd', 'e', 'f'] as const
type Campo = (typeof CAMPOS)[number]

/** El campo que le toca a un título. Determinista y sin estado. */
export function campoDe(title: string | undefined): Campo {
  let suma = 0

  for (const letra of title ?? '') suma += letra.codePointAt(0) ?? 0

  return CAMPOS[suma % CAMPOS.length] ?? 'a'
}

export interface PlayerPlateProps {
  /** La portada del proveedor, servida por el proxy, si la hay. */
  readonly poster: string | undefined
  /** El nombre del título, si ya llegó. */
  readonly title: string | undefined
  /** Cómo se llama el episodio que se está viendo. */
  readonly episode: string | undefined
}

export function PlayerPlate(props: PlayerPlateProps): ReactNode {
  const inicial = Array.from(props.title?.trim() ?? '')[0]?.toUpperCase()

  return (
    <div className="player__plate" data-campo={campoDe(props.title)} aria-hidden="true">
      <Cover
        {...(props.poster === undefined ? {} : { src: props.poster })}
        className="player__plate-cover"
        prioridad
      >
        {inicial === undefined ? null : <span className="player__plate-letter">{inicial}</span>}
      </Cover>
      <span className="player__plate-veil" />
      {props.episode === undefined ? null : (
        <span className="player__plate-label">{props.episode}</span>
      )}
    </div>
  )
}
