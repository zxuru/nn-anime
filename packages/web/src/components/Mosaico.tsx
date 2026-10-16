/**
 * El mosaico de una sección.
 *
 * Una rejilla de seis columnas donde cada pieza declara cuántas ocupa. No decide
 * nada: el peso de cada pieza lo pone la sección, porque el peso es lo que dice
 * de qué va la fila —una recomendación pesa más que una novedad— y eso lo sabe
 * quien tiene los datos, no la rejilla.
 */

import type { ReactNode } from 'react'

export interface MosaicoProps {
  readonly children: ReactNode
}

export function Mosaico(props: MosaicoProps): ReactNode {
  return <div className="mosaico">{props.children}</div>
}
