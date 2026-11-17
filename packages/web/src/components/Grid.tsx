/**
 * Rejilla de tarjetas.
 *
 * Es una lista y no un montón de `div`: el número de resultados importa, y una
 * lista lo comunica sin que nadie tenga que añadir nada. La rejilla la pone el
 * CSS, así que aquí no hay ninguna decisión de columnas.
 */

import type { ReactNode } from 'react'

export interface GridProps {
  readonly children: ReactNode
  /** Nombre accesible de la lista, para quien navegue con lector de pantalla. */
  readonly label?: string
  /**
   * Si la lista todavía puede crecer.
   *
   * `aria-busy` es lo que distingue «esto es todo» de «esto sigue llegando» para
   * quien navega por la lista sin ver el estado de la pantalla.
   */
  readonly busy?: boolean | undefined
}

export function Grid(props: GridProps): ReactNode {
  return (
    <ul
      className="grid"
      aria-label={props.label}
      {...(props.busy === true ? { 'aria-busy': true } : {})}
    >
      {props.children}
    </ul>
  )
}

export function GridItem(props: { readonly children: ReactNode }): ReactNode {
  return <li className="grid__item">{props.children}</li>
}
