/**
 * Panel de recomendaciones.
 *
 * Es distinto según haya historial o no, y lo dice: con historial, cada tarjeta
 * lleva **su razón**; sin historial, el panel explica que está enseñando lo más
 * popular del catálogo, que es lo único honesto que se puede decir cuando no se
 * sabe nada de quien mira.
 *
 * La consulta que se está escribiendo en el buscador entra aquí: el panel se
 * refresca con lo que el usuario busca ahora, no sólo con lo que vio.
 */

import type { RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { Link } from '../../router'
import { coverPath } from '../search/ResultCard'
import { ReasonBadge } from './ReasonBadge'
import { ScoreDetail } from './ScoreDetail'
import { useRecommendations } from './useRecommendations'

export interface PanelProps {
  /** La consulta en curso, si la hay. */
  readonly query?: string | undefined
  readonly limit?: number
  readonly debounceMs?: number
}

function Card(props: {
  readonly item: RecommendationResponse
  readonly showComponents: boolean
}): ReactNode {
  const { item } = props
  const demas = item.reasons.filter((razon) => razon.text !== item.reason.text).map((r) => r.text)

  return (
    <li className="card">
      <Link
        to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
        className="card"
        title={item.title}
      >
        <Cover providerId={item.ref.providerId} ref={item.ref.value} className="card__cover" />
        <span className="card__title">{item.title}</span>
      </Link>
      <ReasonBadge text={item.reason.text} others={demas} />
      {props.showComponents ? <ScoreDetail item={item} /> : null}
    </li>
  )
}

export function Panel(props: PanelProps): ReactNode {
  const { state, data, error, reload, showComponents, toggleComponents } = useRecommendations({
    ...(props.query === undefined ? {} : { query: props.query }),
    ...(props.limit === undefined ? {} : { limit: props.limit }),
    ...(props.debounceMs === undefined ? {} : { debounceMs: props.debounceMs }),
  })

  if (state === 'loading') {
    return (
      <section className="panel" aria-busy="true">
        <h2>{t(DEFAULT_LOCALE, 'reco.title')}</h2>
        <p className="empty">{t(DEFAULT_LOCALE, 'reco.loading')}</p>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <section className="panel">
        <h2>{t(DEFAULT_LOCALE, 'reco.title')}</h2>
        <p className="search__error">{t(DEFAULT_LOCALE, 'reco.error', { message: error ?? '' })}</p>
        <button type="button" className="button" onClick={reload}>
          {t(DEFAULT_LOCALE, 'detail.retry')}
        </button>
      </section>
    )
  }

  const items = data?.items ?? []

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>{t(DEFAULT_LOCALE, 'reco.title')}</h2>
        <button type="button" className="button" onClick={toggleComponents}>
          {showComponents
            ? t(DEFAULT_LOCALE, 'reco.hideScore')
            : t(DEFAULT_LOCALE, 'reco.showScore')}
        </button>
      </header>

      {/* El estado se dice, no se insinúa: sin historial esto es lo más popular
          del catálogo, y con historial es lo que encaja con lo que se ha visto. */}
      <p className="card__meta" aria-live="polite">
        {data?.coldStart === true
          ? t(DEFAULT_LOCALE, 'reco.coldStart')
          : t(DEFAULT_LOCALE, 'reco.personalized')}
      </p>

      {items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'reco.empty')}</p>
      ) : (
        <ul className="grid panel__list">
          {items.map((item) => (
            <Card
              key={`${item.ref.providerId}:${item.ref.value}`}
              item={item}
              showComponents={showComponents}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
