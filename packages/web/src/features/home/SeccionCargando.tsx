/**
 * El esqueleto de una fila de la home.
 *
 * Tiene **la métrica exacta del mosaico** —mismas columnas, mismo hueco, misma
 * proporción de pieza—, así que cuando llega el contenido nada salta de sitio: lo
 * que se ve antes y lo que se ve después ocupa el mismo hueco.
 *
 * Antes esto era un bloque único de doce celdas que sólo se pintaba mientras
 * cargaba el motor de recomendaciones. Las filas seguían pintando su mensaje de
 * vacío mientras sus ocho lecturas estaban en vuelo, y la home se leía como una
 * aplicación sin datos. Ahora cada fila decide: con `cargando`, enseña su rejilla
 * de esqueletos; sin él, enseña lo que llegó o su vacío. La frase que explica la
 * espera vive una sola vez en la pantalla, para el lector de pantalla.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { SectionHeader } from '../../components/SectionHeader'

/** Cuántas celdas pinta una fila: una pantalla de seis columnas. */
export const ESQUELETOS_POR_FILA = 6

/**
 * Las claves de las celdas.
 *
 * Son nombres fijos y no el índice del bucle: el índice como `key` es lo que
 * Biome rechaza, y aquí no hay estado que conservar por celda, así que el nombre
 * estable es lo correcto.
 */
const CELDAS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'] as const

export interface SeccionCargandoProps {
  /** El titular de la sección, ya traducido: es el mismo que el de la fila real. */
  readonly title: string
  /** La etiqueta de la sección, ya traducida. */
  readonly meta?: string | undefined
  /** Cuántas celdas. Por defecto, una fila completa del mosaico. */
  readonly celdas?: number
  /** El dibujo del tramo: el mismo que llevará la fila cuando cargue. */
  readonly icon?: LucideIcon | undefined
}

export function SeccionCargando(props: SeccionCargandoProps): ReactNode {
  const celdas = props.celdas ?? ESQUELETOS_POR_FILA

  return (
    <section className="seccion" aria-busy="true">
      <SectionHeader
        title={props.title}
        {...(props.meta === undefined ? {} : { meta: props.meta })}
        {...(props.icon === undefined ? {} : { icon: props.icon })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {CELDAS.slice(0, celdas).map((celda) => (
            <span key={celda} className="esq" aria-hidden="true" />
          ))}
        </Mosaico>
      </div>
    </section>
  )
}
