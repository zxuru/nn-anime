/**
 * El bloque de un esqueleto.
 *
 * Una caja con la forma y el tamaño que va a ocupar el contenido real. Es
 * decoración —`aria-hidden`— y por eso no lleva texto: lo que se anuncia por un
 * lector de pantalla es el estado de la pantalla, no cada bloque.
 *
 * El color y el movimiento los pone `.skeleton`; aquí sólo van la medida y el
 * radio, que son lo que cada hueco necesita para que la ficha no cambie de forma
 * al llegar los datos.
 */

import type { ReactNode } from 'react'

export interface SkeletonProps {
  /** Ancho. Por defecto, todo el disponible. */
  readonly w?: number | string | undefined
  /** Alto. Es obligatorio: un esqueleto sin alto no reserva nada. */
  readonly h: number | string
  /** Radio de las esquinas. Seis píxeles por defecto. */
  readonly r?: number | undefined
  /** Clases extra, para las variantes que la hoja necesita colocar. */
  readonly className?: string | undefined
}

export function Skeleton(props: SkeletonProps): ReactNode {
  const clase = props.className === undefined ? 'skeleton' : `skeleton ${props.className}`

  return (
    <div
      className={clase}
      style={{ width: props.w ?? '100%', height: props.h, borderRadius: props.r ?? 6 }}
      aria-hidden="true"
    />
  )
}
