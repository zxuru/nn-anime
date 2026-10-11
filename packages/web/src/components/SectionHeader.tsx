/**
 * El titular de una fila.
 *
 * Grande, en mayúsculas y apretado, con la etiqueta de la derecha en
 * monoespaciada: es lo que separa una fila de la siguiente y lo que dice de qué
 * va la lista —«lo más visto», «retoma donde lo dejaste»— sin gastar un párrafo.
 *
 * La etiqueta de la derecha se pasa como texto ya traducido y no como clave: este
 * componente no sabe de filas, sólo de titulares.
 */

import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  readonly title: string
  /** La etiqueta de la derecha. Sin ella, sólo el titular. */
  readonly meta?: string | undefined
}

export function SectionHeader(props: SectionHeaderProps): ReactNode {
  return (
    <header className="section__head">
      <h2 className="section__title">{props.title}</h2>
      {props.meta === undefined ? null : <p className="section__meta">{props.meta}</p>}
    </header>
  )
}
