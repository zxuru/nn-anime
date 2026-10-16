/**
 * Los esqueletos de la primera carga de la home.
 *
 * El esqueleto tiene **la métrica exacta del mosaico** —mismas columnas, mismo
 * hueco, misma proporción de pieza—, así que cuando llega el catálogo nada salta de
 * sitio: lo que se ve antes y lo que se ve después ocupa el mismo hueco.
 *
 * Está en gris plano y **sin latido**: un bucle infinito de brillo sería ruido, y
 * el diseño sólo admite un bucle, el de la cinta. La frase que antes ocupaba el
 * sitio del contenido no se pierde: se queda para quien usa un lector de pantalla,
 * porque el esqueleto es decoración.
 */

import type { ReactNode } from 'react'

/**
 * Cuántas celdas se pintan.
 *
 * Doce: dos filas de seis en el mosaico ancho y tres de cuatro en el de cuatro
 * columnas, que es lo que llena la primera pantalla de una home que todavía no
 * tiene nada. Antes eran siete y de tres tamaños distintos —el reparto por peso que
 * ya no existe—, con el nombre de cada una escrito a mano. Ahora son iguales, así
 * que la clave es su puesto.
 */
export const ESQUELETOS = 12

const CELDAS = Array.from({ length: ESQUELETOS }, (_, indice) => `esqueleto-${indice + 1}`)

export interface HomeSkeletonsProps {
  readonly label: string
}

export function HomeSkeletons(props: HomeSkeletonsProps): ReactNode {
  return (
    <>
      {/* Fuera de la rejilla no hace falta: el hueco es para las celdas. */}
      <p className="solo-lectores">{props.label}</p>
      <div className="esqueleto" aria-busy="true">
        {CELDAS.map((nombre) => (
          <span key={nombre} className="esq" aria-hidden="true" />
        ))}
      </div>
    </>
  )
}
