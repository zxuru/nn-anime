/**
 * Fila «continuar viendo».
 *
 * Cada tarjeta lleva su barra de progreso y, en el pie, el episodio y los minutos
 * que quedan: es la información que hace falta para decidir si se retoma ahora o
 * no. El enlace va a la pantalla de reproducción **sin reanudar sola**: quien
 * decide seguir donde lo dejó es el reproductor, y sólo cuando se le da a
 * reproducir. Reanudar al entrar es lo que hace que alguien vea el final de un
 * episodio sin querer.
 */

import type { ContinueWatchingItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { PosterCard } from '../../components/PosterCard'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { continuePath, progressPercent, remainingLabel, resumeLabel } from './rows'

export interface ContinueRowProps {
  readonly items: readonly ContinueWatchingItem[]
}

export function ContinueRow(props: ContinueRowProps): ReactNode {
  return (
    <section className="section">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.continue')}
        meta={t(DEFAULT_LOCALE, 'home.continue.meta')}
      />

      {props.items.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.continue.empty')}</p>
      ) : (
        <ul className="row__list">
          {props.items.map((item) => {
            const restante = remainingLabel(item)

            return (
              <li key={`${item.animeRef.providerId}:${item.episodeRef.value}`}>
                <PosterCard
                  providerId={item.animeRef.providerId}
                  ref={item.animeRef.value}
                  title={item.title}
                  to={continuePath(item)}
                  badge={t(DEFAULT_LOCALE, 'home.episode', { number: item.episodeNumber })}
                  caption={
                    restante === undefined
                      ? resumeLabel(item)
                      : t(DEFAULT_LOCALE, 'home.remaining', { time: restante })
                  }
                  progress={progressPercent(item)}
                  progressLabel={t(DEFAULT_LOCALE, 'home.resume', { time: resumeLabel(item) })}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
