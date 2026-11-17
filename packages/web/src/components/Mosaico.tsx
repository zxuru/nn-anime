/**
 * El mosaico de una sección.
 *
 * Una rejilla de seis columnas —cuatro, tres, dos o una según el ancho de la
 * ventana— en la que cada pieza ocupa una. **No sabe cuántas piezas lleva**: antes
 * declaraba `--mosaico-piezas` con el número de hijos y la hoja abría tantas
 * pistas como dijera, así que el tamaño del cartel dependía de cuántos títulos
 * devolvió la fuente. Una fila de cuatro medía 264×396 y una de siete 171×256 en
 * la misma pantalla, y el sistema decía que todas las piezas pesan lo mismo.
 *
 * Ahora el número de pistas es del punto de corte y no del contenido: una fila
 * corta acaba antes y deja el aire a la derecha, que es como se lee una página de
 * revista.
 */

import type { ReactNode } from 'react'

export interface MosaicoProps {
  readonly children: ReactNode
  readonly className?: string | undefined
}

export function Mosaico(props: MosaicoProps): ReactNode {
  const clase = props.className === undefined ? 'mosaico' : `mosaico ${props.className}`

  return <div className={clase}>{props.children}</div>
}
