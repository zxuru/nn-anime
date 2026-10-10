/**
 * Fila «continuar viendo».
 *
 * Cada tarjeta lleva su barra de progreso y el tiempo donde se dejó. El enlace va
 * a la pantalla de reproducción **sin reanudar sola**: quien decide seguir donde
 * lo dejó es el reproductor, y sólo cuando se le da a reproducir. Reanudar al
 * entrar es lo que hace que alguien vea el final de un episodio sin querer.
 */

import type { ContinueWatchingItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'
import { coverPath } from '../search/ResultCard'
import { continuePath, progressPercent, resumeLabel } from './rows'

export interface ContinueRowProps {
  readonly items: readonly ContinueWatchingItem[]
}

export function ContinueRow(props: ContinueRowProps): ReactNode {
  return (
    <section className="row">
      <h2>{t(DEFAULT_LOCALE, 'home.continue')}</h2>

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.continue.empty')}</p>
      ) : (
        <ul className="row__list">
          {props.items.map((item) => (
            <li className="card" key={`${item.animeRef.providerId}:${item.episodeRef.value}`}>
              <Link to={continuePath(item)} className="card" title={item.title}>
                <img
                  className="card__cover"
                  src={coverPath(item.animeRef.providerId, item.animeRef.value)}
                  alt=""
                  loading="lazy"
                />
                <span className="card__title">{item.title}</span>
                <span className="card__meta">
                  {t(DEFAULT_LOCALE, 'home.resume', { time: resumeLabel(item) })}
                </span>
              </Link>
              <progress
                className="row__progress"
                value={progressPercent(item)}
                max={100}
                aria-label={t(DEFAULT_LOCALE, 'home.resume', { time: resumeLabel(item) })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
