/**
 * La cinta de la marquesina.
 *
 * Una línea que corre pegada al borde inferior de la marquesina, con lo que hay
 * ahora mismo. En el diseño de referencia son los estrenos del día; aquí es **lo
 * más visto**, porque los estrenos necesitan una fecha de emisión por episodio que
 * los proveedores no dan. Se pone lo que sí se sabe, y si no hay nada, la cinta no
 * se pinta.
 *
 * El rótulo va **fuera** del carro: es el que dice de qué va la línea y no puede
 * irse con ella. El carro corre dentro de una pista con recorte, para que la cinta
 * no ensanche la página.
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
import { Fragment, type ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

export interface TickerProps {
  readonly items: readonly AnimeSummary[]
}

export function Ticker(props: TickerProps): ReactNode {
  if (props.items.length === 0) return null

  return (
    <aside className="cinta" aria-label={t(DEFAULT_LOCALE, 'home.ticker')}>
      <p className="cinta__rotulo">{t(DEFAULT_LOCALE, 'home.ticker')}</p>

      <div className="cinta__pista">
        <div className="cinta__carro">
          {props.items.map((entrada) => (
            <Fragment key={`${entrada.ref.providerId}:${entrada.ref.value}`}>
              <Link
                to={`/anime/${encodeURIComponent(entrada.ref.providerId)}/${encodeURIComponent(entrada.ref.value)}`}
                className="cinta__item"
              >
                {entrada.title}
              </Link>
              <span className="cinta__punto" aria-hidden="true" />
            </Fragment>
          ))}

          {/* La copia que cierra el bucle: no es un enlace ni se anuncia, porque
              es la misma información otra vez. */}
          {props.items.map((entrada) => (
            <Fragment key={`copia:${entrada.ref.providerId}:${entrada.ref.value}`}>
              <span className="cinta__item" aria-hidden="true">
                {entrada.title}
              </span>
              <span className="cinta__punto" aria-hidden="true" />
            </Fragment>
          ))}
        </div>
      </div>
    </aside>
  )
}
