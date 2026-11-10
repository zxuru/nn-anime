/**
 * La barra de la sala, encima del reproductor.
 *
 * Dice tres cosas y no más: qué se está viendo juntos, cómo va la
 * sincronización y quién manda. En el invitado la tercera es la que evita la
 * pregunta de por qué no responde el botón de pausa; en el anfitrión, la de por
 * qué su reproductor mueve al resto.
 *
 * El estado de sincronización vive en una región `aria-live="polite"`: cambia
 * solo y despacio —tres tramos, no cada fotograma—, así que se puede anunciar
 * sin convertir la página en un lector que no deja oír nada.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { PartyMedia } from '@nn-anime/core/party'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import type { PartyHandle, PartySync } from './useParty'

const LOCALE = DEFAULT_LOCALE

/** Cómo se llama lo que se ve: el título y su episodio, o «Película». */
export function mediaLabel(media: PartyMedia): string {
  if (media.kind === 'movie') return t(LOCALE, 'party.bar.movie')

  const episodio =
    media.season === undefined
      ? t(LOCALE, 'party.bar.episode', { episode: media.episode ?? 0 })
      : t(LOCALE, 'party.bar.episodeSeason', { season: media.season, episode: media.episode ?? 0 })

  return media.episodeTitle === undefined ? episodio : `${episodio} · ${media.episodeTitle}`
}

/** La frase del tramo de sincronización. */
export function syncLabel(sync: PartySync): string {
  switch (sync) {
    case 'ok':
      return t(LOCALE, 'party.bar.sync.ok')
    case 'adjusting':
      return t(LOCALE, 'party.bar.sync.adjusting')
    case 'drift':
      return t(LOCALE, 'party.bar.sync.drift')
    case 'unknown':
      return t(LOCALE, 'party.bar.sync.unknown')
  }
}

/** La frase del estado de la conexión. */
function connectionLabel(party: PartyHandle): string {
  switch (party.connection) {
    case 'connecting':
      return t(LOCALE, 'party.bar.connecting')
    case 'connected':
      return t(LOCALE, party.phase === 'host' ? 'party.bar.hostReady' : 'party.bar.guestReady')
    case 'error':
      return t(LOCALE, 'party.bar.error')
    case 'closed':
      return t(LOCALE, 'party.bar.closed')
  }
}

export interface PartyBarProps {
  readonly party: PartyHandle
}

export function PartyBar(props: PartyBarProps): ReactNode {
  const { party } = props
  const media = party.hostMedia

  return (
    <div className="party-bar">
      <p className="party-bar__title">
        <span className="party-bar__eyebrow">{t(LOCALE, 'party.bar.title')}</span>
        {media === undefined ? null : (
          <span className="party-bar__media">
            {media.title}
            <span className="party-bar__episode">{mediaLabel(media)}</span>
          </span>
        )}
      </p>

      <p className="party-bar__status">
        {party.phase === 'host' ? (
          // El anfitrión no mide deriva: es la autoridad de la sala.
          <span className="party-bar__pill" data-sync="host" aria-live="polite">
            {connectionLabel(party)}
          </span>
        ) : (
          <>
            {/* Sólo la píldora vive en la región educada: cambia de tramo muy de
                vez en cuando, no con cada fotograma. El desfase en segundos va al
                lado y fuera de `aria-live`, porque un número que cambia dos veces
                por segundo no deja oír nada más. */}
            <span className="party-bar__pill" data-sync={party.sync} aria-live="polite">
              {syncLabel(party.sync)}
            </span>
            <span className="party-bar__drift" aria-hidden="true">
              {t(LOCALE, 'party.bar.drift', { seconds: party.driftS.toFixed(1) })}
            </span>
          </>
        )}
      </p>

      {party.phase !== 'guest' ? null : (
        <p className="party-bar__notice">{t(LOCALE, 'party.bar.hostControls')}</p>
      )}

      {party.error === undefined ? null : (
        <p className="party-bar__error" role="alert">
          {t(LOCALE, party.error)}
        </p>
      )}
    </div>
  )
}
