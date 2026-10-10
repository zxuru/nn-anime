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
}

export function Grid(props: GridProps): ReactNode {
  return (
    <ul className="grid" aria-label={props.label}>
      {props.children}
    </ul>
  )
}

export function GridItem(props: { readonly children: ReactNode }): ReactNode {
  return <li className="grid__item">{props.children}</li>
}
