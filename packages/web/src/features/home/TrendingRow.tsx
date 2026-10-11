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
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface TrendingRowProps {
  readonly items: readonly AnimeSummary[]
}

export function TrendingRow(props: TrendingRowProps): ReactNode {
  return (
    <section className="section">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.trending')}
        meta={t(DEFAULT_LOCALE, 'home.trending.meta')}
      />

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.trending.empty')}</p>
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
