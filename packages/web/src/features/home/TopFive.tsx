/**
 * El top de la semana.
 *
 * Los cinco primeros del ranking, con su número grande al lado y **el motivo en
 * el pie**: es la fila que enseña por qué el motor recomienda lo que recomienda,
 * y sin el motivo sería una lista más. Los números pares llevan el número a la
 * izquierda y los impares a la derecha, como el diseño de referencia.
 */

import type { RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface TopFiveProps {
  readonly items: readonly RecommendationResponse[]
  /** Sin historial, el titular lo dice: no es «tu top», es el del catálogo. */
  readonly coldStart: boolean
}

export function TopFive(props: TopFiveProps): ReactNode {
  const cinco = props.items.slice(0, 5)

  return (
    <section className="section section--top">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.top')}
        meta={t(DEFAULT_LOCALE, props.coldStart ? 'home.top.meta.cold' : 'home.top.meta')}
      />

      {cinco.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'reco.empty')}</p>
      ) : (
        <ul className="row__list">
          {cinco.map((item, indice) => (
            <li key={`${item.ref.providerId}:${item.ref.value}`}>
              <PosterCard
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                number={indice + 1}
                caption={item.reason.text}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
