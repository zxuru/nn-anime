/**
 * La cinta de arriba.
 *
 * Es la barra naranja del diseño: una línea que corre con lo que hay ahora
 * mismo. En el diseño de referencia son los estrenos del día; aquí es **lo más
 * visto**, porque los estrenos necesitan una fecha de emisión por episodio que
 * los proveedores no dan. Se pone lo que sí se sabe, y si no hay nada, la cinta
 * no se pinta.
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

  return (
    <aside className="ticker" aria-label={t(DEFAULT_LOCALE, 'home.ticker')}>
      <span className="ticker__label">{t(DEFAULT_LOCALE, 'home.ticker')}</span>
      {props.items.map((item) => (
        <Link
          key={`${item.ref.providerId}:${item.ref.value}`}
          to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
          className="ticker__item"
        >
          {item.title}
        </Link>
      ))}
    </aside>
  )
}
