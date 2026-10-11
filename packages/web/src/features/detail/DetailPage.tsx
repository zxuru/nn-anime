/**
 * Pantalla de detalle.
 *
 * Tres estados y ninguno se disimula: mientras carga se ve un esqueleto con la
 * forma de la ficha —no un «cargando» que salta cuando llega el contenido—, si
 * falla se dice qué falló y se ofrece reintentar, y si el título no está se dice
 * eso y no «error». Un reintento que no existe obliga a recargar la página, que
 * es justo lo que el spec prohíbe.
 *
 * **Ningún dato del proveedor se inserta como HTML.** La sinopsis es texto de
 * fuera y se pinta como texto: `dangerouslySetInnerHTML` con datos de un
 * proveedor es la única línea que convierte un sitio ajeno en un XSS en el
 * navegador del usuario, y el contrato de la interfaz lo prohíbe.
 *
 * El selector de modo **elige de verdad**: el modo marcado es el que viaja con
 * cada episodio hasta el reproductor. Antes eran dos botones que sólo decían qué
 * sabe hacer el proveedor y la lista de episodios no llevaba a ninguna parte, así
 * que la ficha entera era un callejón sin salida.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeDetail } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { isSafeUrl } from '../../lib/safe-url'
import { PLAY_MODES, type PlayMode } from '../player/watch-route'
import { EpisodeList } from './EpisodeList'
import { FavoriteButton } from './FavoriteButton'
import { chosenMode, modesFor, useDetail, useFavorite } from './useDetail'

/** La clave de traducción del estado, escrita una a una. */
const STATUS_KEYS = {
  airing: 'detail.status.airing',
  finished: 'detail.status.finished',
  upcoming: 'detail.status.upcoming',
  unknown: 'detail.status.unknown',
} as const

export interface DetailPageProps {
  readonly providerId: string
  readonly ref: string
}

function Meta(props: { readonly detail: AnimeDetail }): ReactNode {
  const { detail } = props
  const estado = STATUS_KEYS[detail.status ?? 'unknown']

  return (
    <p className="detail__meta">
      {t(DEFAULT_LOCALE, 'detail.meta', {
        year: detail.year ?? '—',
        status: t(DEFAULT_LOCALE, estado),
      })}
    </p>
  )
}

function Skeletons(): ReactNode {
  return (
    <section aria-busy="true">
      <p className="empty">{t(DEFAULT_LOCALE, 'detail.loading')}</p>
      <span className="skeleton" aria-hidden="true" />
    </section>
  )
}

export function DetailPage(props: DetailPageProps): ReactNode {
  const { detail, episodes, capabilities, state, error, reload } = useDetail(
    props.providerId,
    props.ref,
  )
  const favorite = useFavorite({ providerId: props.providerId, value: props.ref }, false)
  /**
   * El modo elegido a mano.
   *
   * Empieza sin elegir porque las capacidades llegan por red: en el primer render
   * no se sabe cuáles hay. Sin elección manda el primero disponible, y una
   * elección que el proveedor no ofrece —porque cambió de plugin a mitad de la
   * visita— se ignora en vez de abrir el reproductor en un modo que va a fallar.
   */
  const [preferido, setPreferido] = useState<PlayMode | undefined>(undefined)

  if (state === 'loading') return <Skeletons />

  if (state === 'error') {
    return (
      <section>
        <p className="search__error">
          {t(DEFAULT_LOCALE, 'detail.error', { message: error ?? '' })}
        </p>
        <button type="button" className="button" onClick={reload}>
          {t(DEFAULT_LOCALE, 'detail.retry')}
        </button>
      </section>
    )
  }

  if (detail === undefined) {
    return (
      <section>
        <p className="empty">{t(DEFAULT_LOCALE, 'detail.notFound')}</p>
      </section>
    )
  }

  const modos = modesFor(capabilities)
  const modo = chosenMode(modos, preferido)

  return (
    <article className="detail">
      {/* La portada sale del proxy, y sólo si el proveedor declaró una dirección
          que se puede usar: un `javascript:` ahí no se convierte en atributo. */}
      {detail.coverUrl !== undefined && !isSafeUrl(detail.coverUrl) ? (
        <span className="detail__cover card__cover--vacia" aria-hidden="true" />
      ) : (
        <Cover providerId={props.providerId} ref={props.ref} className="detail__cover" />
      )}

      <div className="detail__body">
        <h1>{detail.title}</h1>
        {detail.titleAlt === undefined ? null : <p className="card__meta">{detail.titleAlt}</p>}
        <Meta detail={detail} />

        <div className="detail__actions">
          <FavoriteButton value={favorite.value} busy={favorite.busy} onToggle={favorite.toggle} />
        </div>

        <section>
          <h2>{t(DEFAULT_LOCALE, 'detail.modes')}</h2>
          <ul className="modes">
            {PLAY_MODES.map((candidato) => {
              const disponible = modos.includes(candidato)
              const clave = candidato === 'sub' ? 'detail.mode.sub' : 'detail.mode.dub'

              return (
                <li className="mode" key={candidato}>
                  <button
                    type="button"
                    className="button"
                    // El marcado es el modo que se va a reproducir, y se dice con
                    // `aria-pressed` —lo que ya lee el resto de la interfaz— y no
                    // sólo con el color.
                    aria-pressed={modo === candidato}
                    disabled={!disponible}
                    onClick={() => setPreferido(candidato)}
                  >
                    {t(DEFAULT_LOCALE, clave)}
                  </button>
                  {disponible ? null : (
                    <span className="card__meta">
                      {t(DEFAULT_LOCALE, 'detail.modeUnavailable', {
                        mode: t(DEFAULT_LOCALE, clave),
                      })}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {detail.synopsis === undefined ? null : (
          <section>
            <h2>{t(DEFAULT_LOCALE, 'detail.synopsis')}</h2>
            {/* Texto, nunca HTML: la sinopsis viene de fuera. */}
            <p>{detail.synopsis}</p>
          </section>
        )}

        <section>
          <h2>{t(DEFAULT_LOCALE, 'detail.genres')}</h2>
          <p>{detail.genres.join(' · ')}</p>
        </section>

        <section>
          <h2>{t(DEFAULT_LOCALE, 'detail.studios')}</h2>
          <p>{detail.studios.join(' · ')}</p>
        </section>

        <section>
          <h2>{t(DEFAULT_LOCALE, 'detail.episodes')}</h2>
          <EpisodeList episodes={episodes} mode={modo} />
        </section>
      </div>
    </article>
  )
}
