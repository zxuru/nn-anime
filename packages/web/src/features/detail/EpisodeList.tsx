/**
 * Lista de episodios.
 *
 * Es una lista ordenada y no una rejilla: el número importa y el orden importa,
 * y `<ol>` dice las dos cosas sin ayuda. Cada episodio muestra su modo, porque
 * un título puede tener el 3 en subtitulado y el 4 doblado, y elegir sin saberlo
 * es la forma más rápida de que la reproducción falle.
 *
 * **Cada fila es un enlace al reproductor**, no una fila que parece pulsable: el
 * episodio es la acción de la pantalla, y un `<li>` con `onClick` no se puede
 * abrir en otra pestaña, ni copiar, ni recorrer con el teclado sin inventar nada.
 * El modo elegido en la ficha viaja en la dirección.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'
import { type PlayMode, watchPath } from '../player/watch-route'
import { formatDuration } from './useDetail'

/**
 * Las claves del catálogo, escritas una a una.
 *
 * Una clave compuesta con el modo —`detail.mode.${modo}`— funcionaría igual en
 * tiempo de ejecución y escondería las claves al buscador de textos sin usar:
 * acabarían borradas del catálogo por parecer huérfanas.
 */
const MODE_KEYS = {
  sub: 'detail.mode.sub',
  dub: 'detail.mode.dub',
  raw: 'detail.mode.raw',
} as const

export interface EpisodeListProps {
  readonly episodes: readonly Episode[]
  /** El modo con el que se abre el reproductor. Sin él, el que elija el reproductor. */
  readonly mode?: PlayMode
}

export function EpisodeList(props: EpisodeListProps): ReactNode {
  if (props.episodes.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.noEpisodes')}</p>
  }

  return (
    <ol className="episodes">
      {props.episodes.map((episode) => {
        const duracion = formatDuration(episode.durationS)

        return (
          <li key={`${episode.ref.providerId}:${episode.ref.value}`}>
            <Link
              className="episode"
              to={watchPath(episode.ref.providerId, episode.ref.value, props.mode)}
            >
              <span className="episode__number">
                {t(DEFAULT_LOCALE, 'detail.episode', { number: episode.number })}
              </span>
              {episode.title === undefined ? null : (
                <span className="episode__title">{episode.title}</span>
              )}
              {duracion === undefined ? null : <span className="episode__time">{duracion}</span>}
              <span className="badge">{t(DEFAULT_LOCALE, MODE_KEYS[episode.mode])}</span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
