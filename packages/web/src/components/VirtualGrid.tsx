/**
 * Rejilla que sólo pinta lo que se ve.
 *
 * Con sesenta elementos, pintarlos todos no se nota. Con doscientos, la página
 * tarda en responder al primer desplazamiento, y con mil, no responde. La regla
 * es simple: por debajo del umbral se pinta todo —una lista corta no necesita
 * nada de esto— y por encima se corta.
 *
 * **Se corta, no se virtualiza de verdad.** Una virtualización completa necesita
 * medir el hueco de cada elemento, escuchar el desplazamiento y reservar el alto
 * total para que la barra no salte; eso es un componente con estado, medidas y
 * pruebas de navegador. Lo que hay aquí es la mitad del problema resuelto: se
 * pintan los primeros N y se dice cuántos quedan, con un botón para ver más. Es
 * honesto, no miente sobre lo que hay, y no finge ser lo que no es.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../i18n'

/** A partir de aquí se corta. */
export const VIRTUAL_THRESHOLD = 60

export interface VirtualGridProps<T> {
  readonly items: readonly T[]
  readonly render: (item: T) => ReactNode
  readonly keyOf: (item: T) => string
  /** Cuántos se pintan cuando se pasa del umbral. */
  readonly limit?: number
  readonly className?: string | undefined
}

/** Cuántos elementos se pintan de una lista larga. */
export function visibleCount(total: number, threshold: number = VIRTUAL_THRESHOLD): number {
  return total <= threshold ? total : threshold
}

export function VirtualGrid<T>(props: VirtualGridProps<T>): ReactNode {
  const visibles = visibleCount(props.items.length, props.limit ?? VIRTUAL_THRESHOLD)
  const mostrados = props.items.slice(0, visibles)
  const restantes = props.items.length - mostrados.length

  return (
    <>
      <ul className={props.className ?? 'grid'}>
        {mostrados.map((item) => (
          <li key={props.keyOf(item)}>{props.render(item)}</li>
        ))}
      </ul>

      {restantes <= 0 ? null : (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'home.more', { count: restantes })}</p>
      )}
    </>
  )
}
