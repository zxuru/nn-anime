/**
 * Fila de favoritos.
 *
 * El estado vacío dice **dónde** se marca un favorito: «todavía no has marcado
 * ninguno» sin más deja al usuario buscando el botón por toda la aplicación. Un
 * estado vacío útil es el que enseña el camino.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { coverPath } from '../search/ResultCard'

export interface FavoritesRowProps {
  readonly items: readonly AnimeSummary[]
}

export function FavoritesRow(props: FavoritesRowProps): ReactNode {
  return (
    <section className="row">
      <h2>{t(DEFAULT_LOCALE, 'home.favorites')}</h2>

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.favorites.empty')}</p>
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
