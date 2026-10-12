/**
 * El selector de audio.
 *
 * Subtitulado o doblado: es una elección que se cambia a menudo —hay títulos con
 * el doblado incompleto— y por eso vive **fuera** del menú de ajustes, en la fila
 * de mandos bajo el reproductor, además de dentro del menú.
 *
 * Son dos botones con `aria-pressed` y no un `<select>`: el estado se ve sin
 * abrir nada, que es lo que hace falta cuando el episodio arranca en el modo
 * equivocado. La etiqueta del grupo —«Audio»— es la que sustituye al «Modo» de
 * antes, que no decía de qué se estaba hablando.
 *
 * Las claves del catálogo van escritas una a una y no compuestas con el modo:
 * una clave construida funciona igual en tiempo de ejecución y esconde las claves
 * al buscador de textos sin usar, que acabaría borrándolas por parecer huérfanas.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { PLAY_MODES, type PlayMode } from './watch-route'

const MODE_KEYS = {
  sub: 'player.mode.sub',
  dub: 'player.mode.dub',
} as const

export interface AudioModeSwitchProps {
  readonly mode: PlayMode
  readonly onMode: (mode: PlayMode) => void
}

export function AudioModeSwitch(props: AudioModeSwitchProps): ReactNode {
  return (
    // Una lista y no un `div` con `role="group"`: el grupo de dos opciones se
    // declara con la lista, que ya tiene su nombre accesible, y no hay que
    // inventarle un rol que después hay que mantener.
    <ul className="audio-switch" aria-label={t(DEFAULT_LOCALE, 'player.audio')}>
      {PLAY_MODES.map((candidato) => (
        <li className="audio-switch__item" key={candidato}>
          <button
            type="button"
            className="audio-switch__option"
            aria-pressed={props.mode === candidato}
            onClick={() => props.onMode(candidato)}
          >
            {t(DEFAULT_LOCALE, MODE_KEYS[candidato])}
          </button>
        </li>
      ))}
    </ul>
  )
}
