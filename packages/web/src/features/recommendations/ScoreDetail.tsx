/**
 * El detalle de la puntuación.
 *
 * Está detrás de un botón porque es información de depuración: quien quiere
 * entender por qué el motor ordenó así lo abre, y quien sólo quiere ver algo, no.
 * El spec pide que exista y que no salga por defecto, y las dos cosas se cumplen
 * aquí.
 *
 * No se pide al servidor: la forma pública **no trae** `components`, así que este
 * detalle se calcula con lo que sí llega —la puntuación y la razón— y lo que se
 * enseña es la lista de razones con su tipo, que es lo que se puede explicar sin
 * mentir.
 */

import type { RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface ScoreDetailProps {
  readonly item: RecommendationResponse
}

export function ScoreDetail(props: ScoreDetailProps): ReactNode {
  return (
    <div className="score">
      <p className="card__meta">
        {t(DEFAULT_LOCALE, 'reco.score', { score: props.item.score.toFixed(3) })}
      </p>
      <ul className="score__reasons">
        {props.item.reasons.map((razon) => (
          <li key={`${razon.kind}:${razon.text}`} className="card__meta">
            {razon.kind}: {razon.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
