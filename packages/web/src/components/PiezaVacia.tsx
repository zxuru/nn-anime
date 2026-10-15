/**
 * Un hueco explicado, con la forma de una pieza.
 *
 * Un vacío no es una caja con un texto: ocupa el hueco que ocuparía una pieza, con
 * el borde rayado en vez del degradado. Así se ve el sitio que falta y se explica
 * sin mover nada de lo que hay alrededor.
 */

import type { ReactNode } from 'react'
import { type PesoPieza, tituloYCuerpo } from './Pieza'

export interface PiezaVaciaProps {
  /** El texto del catálogo: el primer punto separa el titular del cuerpo. */
  readonly texto: string
  readonly peso?: PesoPieza | undefined
}

export function PiezaVacia(props: PiezaVaciaProps): ReactNode {
  const { title, body } = tituloYCuerpo(props.texto)
  const peso = props.peso ?? 'b'

  return (
    <article className={peso === 'b' ? 'pz pz--b pz--fantasma' : 'pz pz--w pz--fantasma'}>
      <div className="pz__pie">
        <h3 className="pz__titulo">{title}</h3>
        {body === undefined ? null : <p className="pz__meta">{body}</p>}
      </div>
    </article>
  )
}
