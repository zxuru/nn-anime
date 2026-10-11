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
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface FavoritesRowProps {
  readonly items: readonly AnimeSummary[]
}

export function FavoritesRow(props: FavoritesRowProps): ReactNode {
  return (
    <section className="section">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.favorites')}
        meta={t(DEFAULT_LOCALE, 'home.favorites.meta')}
      />

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.favorites.empty')}</p>
      ) : (
        <ul className="row__list">
          {props.items.map((item) => (
            <li key={`${item.ref.providerId}:${item.ref.value}`}>
              <PosterCard
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                caption={item.year === undefined ? undefined : String(item.year)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
