/**
 * La razón de una recomendación.
 *
 * Se enseña **una**: la de más peso, que es la que de verdad movió la decisión.
 * Las demás van en el `title` del elemento, donde se pueden leer pasando el
 * puntero, porque un panel con tres frases por tarjeta no se lee.
 *
 * El texto viene del motor, ya escrito: la interfaz no lo compone. Si lo
 * compusiera, habría dos sitios que deciden cómo se explica una recomendación y
 * acabarían diciendo cosas distintas.
 */

import type { ReactNode } from 'react'

export interface ReasonBadgeProps {
  readonly text: string
  /** Las demás razones, para el `title`. */
  readonly others?: readonly string[] | undefined
}

export function ReasonBadge(props: ReasonBadgeProps): ReactNode {
  const otras = props.others ?? []
  const titulo = [props.text, ...otras].join(' · ')

  return (
    <span className="badge reason" title={titulo}>
      {props.text}
    </span>
  )
}
