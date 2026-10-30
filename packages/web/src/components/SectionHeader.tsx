/**
 * La nota de una sección.
 *
 * Es el titular de una fila, y en la vitrina vive **al margen**: en la canaleta
 * izquierda del mosaico, pegajosa, de modo que sigue a la vista mientras se
 * recorre el tramo. Es lo que hace que el mosaico se lea como una revista y no
 * como una cuadrícula suelta.
 *
 * El texto llega ya traducido y no como clave: este componente no sabe de filas,
 * sólo de titulares. El dibujo es opcional y decorativo —`aria-hidden`—: el
 * titular ya dice de qué va el tramo, y un dibujo con nombre propio lo repetiría.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SectionHeaderProps {
  readonly title: string
  /** La etiqueta de debajo del titular. Sin ella, sólo el titular. */
  readonly meta?: string | undefined
  /** La cuenta del tramo, arriba del todo. Sin ella, no se pinta. */
  readonly cuenta?: string | undefined
  /** El dibujo del tramo, si lo tiene. */
  readonly icon?: LucideIcon | undefined
}

export function SectionHeader(props: SectionHeaderProps): ReactNode {
  const Icono = props.icon

  return (
    <header className="seccion__nota">
      <h2 className="nota__titulo">
        {Icono === undefined ? null : (
          <Icono
            className="nota__icono"
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          />
        )}
        <span className="nota__texto">{props.title}</span>
      </h2>
      {props.meta === undefined ? null : <p className="nota__meta">{props.meta}</p>}
      {props.cuenta === undefined ? null : <p className="nota__cuenta">{props.cuenta}</p>}
    </header>
  )
}
