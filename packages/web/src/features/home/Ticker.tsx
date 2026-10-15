/**
 * La cinta de la marquesina.
 *
 * Una línea que corre con lo que hay ahora mismo. En el diseño de referencia son
 * los estrenos del día; aquí es **lo más visto**, porque los estrenos necesitan
 * una fecha de emisión por episodio que los proveedores no dan. Se pone lo que sí
 * se sabe, y si no hay nada, la cinta no se pinta.
 *
 * La lista va **dos veces**: la segunda copia cierra el bucle —el carro se
 * desplaza la mitad de su ancho y la segunda mitad ocupa el hueco de la primera—
 * y va fuera del orden de tabulación y del árbol de accesibilidad, porque es la
 * misma información otra vez. Sin esa copia, la cinta salta al empezar de nuevo.
 *
 * Se detiene con el puntero encima o con el foco dentro, que es lo que deja
 * leerla; con movimiento reducido no se mueve nada.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

export interface TickerProps {
  readonly items: readonly AnimeSummary[]
}

export function Ticker(props: TickerProps): ReactNode {
  if (props.items.length === 0) return null

  const enlace = (entrada: AnimeSummary): ReactNode => (
    <Link
      key={`lista:${entrada.ref.providerId}:${entrada.ref.value}`}
      to={`/anime/${encodeURIComponent(entrada.ref.providerId)}/${encodeURIComponent(entrada.ref.value)}`}
      className="cinta__item"
    >
      {entrada.title}
    </Link>
  )

  return (
    <aside className="cinta" aria-label={t(DEFAULT_LOCALE, 'home.ticker')}>
      <div className="cinta__carro">
        <span className="cinta__rotulo">{t(DEFAULT_LOCALE, 'home.ticker')}</span>
        {props.items.map((entrada) => enlace(entrada))}
        {/* La copia que cierra el bucle: no es un enlace ni se anuncia, porque es
            la misma información otra vez. */}
        {props.items.map((entrada) => (
          <span
            key={`copia:${entrada.ref.providerId}:${entrada.ref.value}`}
            className="cinta__item"
            aria-hidden="true"
          >
            {entrada.title}
          </span>
        ))}
      </div>
    </aside>
  )
}
