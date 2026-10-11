/**
 * La tarjeta de una fila.
 *
 * Portada arriba y **franja de pie** abajo, con el título y lo que se sepa del
 * título: el número de episodio, los minutos que quedan, el motivo de la
 * recomendación. La franja es lo que hace que la rejilla se lea como una lista y
 * no como un muro de imágenes.
 *
 * Tres cosas opcionales y ninguna inventada: si no hay pie, no hay franja; si no
 * hay número, no hay número. Un hueco con un guion es peor que un hueco.
 */

import type { ReactNode } from 'react'
import { Link } from '../router'
import { Cover } from './Cover'

export interface PosterCardProps {
  readonly providerId: string
  readonly ref: string
  readonly title: string
  /** A dónde lleva la tarjeta. */
  readonly to: string
  /** El texto del pie: el motivo, el episodio, lo que sea. */
  readonly caption?: string | undefined
  /** La etiqueta de la esquina, como «EP 3» o «HOY». */
  readonly badge?: string | undefined
  /** La insignia grande de la esquina, para el top: 1, 2, 3… */
  readonly number?: number | undefined
  /** De 0 a 100. Si viene, se pinta la barra. */
  readonly progress?: number | undefined
  readonly progressLabel?: string | undefined
}

export function PosterCard(props: PosterCardProps): ReactNode {
  return (
    <article className="poster">
      <Link to={props.to} className="poster__link" title={props.title}>
        <span className="poster__frame">
          <Cover providerId={props.providerId} ref={props.ref} className="poster__cover" />
          {/*
            El número va **dentro del marco y antes del título**: en el diseño
            ocupa la esquina de la portada, enorme y sin relleno, y el pie se lee
            por debajo. Estaba fuera y sobre el pie, y tapaba el título.
          */}
          {props.number === undefined ? null : (
            <span className="poster__number" aria-hidden="true">
              {props.number}
            </span>
          )}
          {props.badge === undefined ? null : <span className="tag">{props.badge}</span>}
          {props.progress === undefined ? null : (
            <progress
              className="poster__progress"
              value={props.progress}
              max={100}
              aria-label={props.progressLabel ?? props.title}
            />
          )}
        </span>

        <span className="poster__caption">
          <span className="poster__title">{props.title}</span>
          {props.caption === undefined ? null : (
            <span className="poster__meta">{props.caption}</span>
          )}
        </span>
      </Link>
    </article>
  )
}
