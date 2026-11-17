/**
 * Las celdas de un esqueleto con la forma de una pieza.
 *
 * Un esqueleto vale lo que vale su medida: si el hueco no mide lo mismo que lo que
 * va a llegar, el contenido entra de golpe y el esqueleto sólo añade ruido. Estas
 * celdas son `.esq` dentro del `.mosaico`, así que heredan sus pistas, su hueco y
 * la proporción 2:3 de la pieza; cuando el contenido llega, ocupa el mismo sitio.
 *
 * Vive aquí y no en cada pantalla porque lo usan la fila que carga de la home, el
 * Perfil y el Historial: tres copias de la misma lista de claves es cómo una de
 * ellas se queda con cinco celdas.
 */

import type { ReactNode } from 'react'
import { Mosaico } from './Mosaico'

/** Las claves de las celdas. Son nombres y no el índice: no hay estado que guardar. */
const CELDAS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'] as const

export interface EsqueletoMosaicoProps {
  /** Cuántas celdas. Por defecto, una fila completa del mosaico. */
  readonly celdas?: number
  /** Clases del mosaico, cuando la fila real las lleva (`mosaico--carrusel`). */
  readonly className?: string | undefined
}

export function EsqueletoMosaico(props: EsqueletoMosaicoProps): ReactNode {
  const celdas = props.celdas ?? CELDAS.length

  return (
    <Mosaico {...(props.className === undefined ? {} : { className: props.className })}>
      {CELDAS.slice(0, celdas).map((celda) => (
        <span key={celda} className="esq" aria-hidden="true" />
      ))}
    </Mosaico>
  )
}
