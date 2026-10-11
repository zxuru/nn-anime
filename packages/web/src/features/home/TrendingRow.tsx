/**
 * Fila de tendencias.
 *
 * Sólo aparece si algún proveedor activo dice ofrecer tendencias, y si no, se
 * explica en vez de esconderse: «ningún proveedor activo ofrece tendencias» es
 * información, y una fila que desaparece sin más deja al usuario sin saber si la
 * función existe.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { coverPath } from '../search/ResultCard'

export interface TrendingRowProps {
  readonly items: readonly AnimeSummary[]
}

export function TrendingRow(props: TrendingRowProps): ReactNode {
  return (
    <section className="row">
      <h2>{t(DEFAULT_LOCALE, 'home.trending')}</h2>

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.trending.empty')}</p>
      ) : (
        <ul className="row__list">
          {props.items.map((item) => (
            <li className="card" key={`${item.ref.providerId}:${item.ref.value}`}>
              <Link
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                className="card"
                title={item.title}
              >
                <Cover providerId={item.ref.providerId} ref={item.ref.value} />
                <span className="card__title">{item.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
