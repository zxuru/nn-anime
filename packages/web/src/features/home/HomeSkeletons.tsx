/**
 * Los esqueletos de la primera carga de la home.
 *
 * Antes había una frase —«Cargando tu inicio…»— en el sitio del contenido: la
 * página decía que estaba trabajando y no enseñaba de qué. Tres bandas con la
 * misma rejilla que las filas hacen que el hueco sea el que va a ocupar lo que
 * llega, y la frase no se pierde: se queda para quien usa un lector de pantalla,
 * porque el esqueleto es decoración.
 */

import type { ReactNode } from 'react'

/**
 * Las bandas, con nombre y no por índice.
 *
 * Son decorativas y su orden no significa nada, así que la tentación es
 * `key={indice}`. Biome lo rechaza y tiene razón: una clave por índice ata la
 * identidad del nodo a su posición, y el día que estas bandas lleven algo dentro
 * —un texto, un número— la posición será justo lo que cambia.
 */
const BANDAS = ['primera', 'segunda', 'tercera'] as const

/** Cuántas bandas se pintan. Tres llenan la primera pantalla sin mentir. */
export const ESQUELETOS = BANDAS.length

export interface HomeSkeletonsProps {
  readonly label: string
}

export function HomeSkeletons(props: HomeSkeletonsProps): ReactNode {
  return (
    <div className="home__esqueletos" aria-busy="true">
      {/* Absoluto, así que no ocupa celda de la rejilla: el hueco es para las
          bandas. */}
      <p className="solo-lectores">{props.label}</p>
      {BANDAS.map((banda) => (
        <span key={banda} className="skeleton" aria-hidden="true" />
      ))}
    </div>
  )
}
