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
 *
 * La marca de visto es del **episodio**, no del par episodio y modo: verlo en
 * subtitulado es haberlo visto. Un episodio a medias lleva su barra con la
 * proporción que calculó el servidor, y uno del que no se sabe la duración no
 * lleva ni barra ni marca: inventar el dato sería peor que no decirlo.
 */

import type { WatchedEpisodePayload } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { Episode } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'
import { type PlayMode, watchPath } from '../player/watch-route'
import { formatDuration, watchedPercent } from './useDetail'

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
  /** Lo que ya se vio de este título, por número de episodio. */
  readonly watched?: readonly WatchedEpisodePayload[]
}

/** Lo que se pinta en la fila por haberlo visto: terminado, a medias o nada. */
type Marca = { readonly tipo: 'visto' } | { readonly tipo: 'progreso'; readonly percent: number }

/**
 * La marca de una fila.
 *
 * Sin duración no hay proporción, y sin proporción no se marca nada: un
 * episodio abierto y cerrado en el segundo uno no está «a medias» de nada.
 */
function marcaDe(visto: WatchedEpisodePayload | undefined): Marca | undefined {
  if (visto === undefined) return undefined
  if (visto.finished) return { tipo: 'visto' }
  if (visto.durationS <= 0) return undefined

  return { tipo: 'progreso', percent: watchedPercent(visto.ratio) }
}

export function EpisodeList(props: EpisodeListProps): ReactNode {
  if (props.episodes.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.noEpisodes')}</p>
  }

  const vistos = new Map((props.watched ?? []).map((fila) => [fila.number, fila]))

  return (
    <ol className="episodes">
      {props.episodes.map((episode) => {
        const duracion = formatDuration(episode.durationS)
        const marca = marcaDe(vistos.get(episode.number))

        return (
          <li key={`${episode.ref.providerId}:${episode.ref.value}`}>
            <Link
              className={marca?.tipo === 'visto' ? 'episode episode--visto' : 'episode'}
              to={watchPath(episode.ref.providerId, episode.ref.value, {
                ...(props.mode === undefined ? {} : { mode: props.mode }),
                // El título viaja con el enlace: la lista lo trae en cada
                // episodio, y sin él el reproductor tenía que adivinarlo de la
                // referencia y con jkanime adivinaba mal.
                anime: episode.animeRef.value,
              })}
            >
              <span className="episode__number">
                {t(DEFAULT_LOCALE, 'detail.episode', { number: episode.number })}
              </span>
              {episode.title === undefined ? null : (
                <span className="episode__title">{episode.title}</span>
              )}
              {marca?.tipo === 'progreso' ? (
                <progress
                  className="episode__progress"
                  value={marca.percent}
                  max={100}
                  aria-label={t(DEFAULT_LOCALE, 'detail.episode.progress', {
                    percent: marca.percent,
                  })}
                />
              ) : null}
              {duracion === undefined ? null : <span className="episode__time">{duracion}</span>}
              {marca?.tipo === 'visto' ? (
                // La palabra, no sólo el color: el estado tiene que leerse también
                // sin distinguir colores.
                <span className="badge badge--visto">
                  {t(DEFAULT_LOCALE, 'detail.episode.watched')}
                </span>
              ) : null}
              <span className="badge">{t(DEFAULT_LOCALE, MODE_KEYS[episode.mode])}</span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
