/**
 * Los esqueletos de la primera carga de la home.
 *
 * El esqueleto tiene **la métrica exacta del mosaico** —mismas columnas, mismas
 * filas, mismo hueco—, así que cuando llega el catálogo nada salta de sitio: lo que
 * se ve antes y lo que se ve después ocupan el mismo hueco.
 *
 * Está en gris plano y **sin latido**: un bucle infinito de brillo sería ruido, y
 * el diseño sólo admite un bucle, el de la cinta. La frase que antes ocupaba el
 * sitio del contenido no se pierde: se queda para quien usa un lector de pantalla,
 * porque el esqueleto es decoración.
 */

import type { ReactNode } from 'react'

/**
 * Las celdas, con nombre y no por índice.
 *
 * Son decorativas y su orden no significa nada, así que la tentación es
 * `key={indice}`. Biome lo rechaza y tiene razón: una clave por índice ata la
 * identidad del nodo a su posición, y el día que estas celdas lleven algo dentro
 * —un texto, un número— la posición será justo lo que cambia.
 */
const CELDAS = [
  { nombre: 'primera', clase: 'esq esq--b' },
  { nombre: 'segunda', clase: 'esq esq--b' },
  { nombre: 'tercera', clase: 'esq esq--b' },
  { nombre: 'cuarta', clase: 'esq esq--w' },
  { nombre: 'quinta', clase: 'esq esq--s' },
  { nombre: 'sexta', clase: 'esq esq--s' },
  { nombre: 'septima', clase: 'esq esq--s' },
] as const

/** Cuántas celdas se pintan: un tramo entero, el que llena la primera pantalla. */
export const ESQUELETOS = CELDAS.length

export interface HomeSkeletonsProps {
  readonly label: string
}

export function HomeSkeletons(props: HomeSkeletonsProps): ReactNode {
  return (
    <>
      {/* Fuera de la rejilla no hace falta: el hueco es para las celdas. */}
      <p className="solo-lectores">{props.label}</p>
      <div className="esqueleto" aria-busy="true">
        {CELDAS.map((celda) => (
          <span key={celda.nombre} className={celda.clase} aria-hidden="true" />
        ))}
      </div>
    </>
  )
}
