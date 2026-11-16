/**
 * El botón de saltar intro, ending o resumen, dentro del marco.
 *
 * Va en una pieza propia y no en la fila de mandos por dos razones: los mandos se
 * esconden solos mientras reproduce —y el botón es justo lo que se busca
 * entonces— y el marco es lo que se pone a pantalla completa, así que el botón
 * también se ve ahí.
 *
 * No decide nada: la pantalla sabe qué intervalo está activo y a dónde lleva, y
 * el reproductor le pasa el salto ya resuelto. Sin salto no se pinta nada, que es
 * el caso normal: AniSkip sólo conoce una parte del catálogo.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import type { PlayerSkip } from './player-props'

export interface PlayerSkipButtonProps {
  /** Lo que se ofrece ahora, si hay algo que ofrecer. */
  readonly skip: PlayerSkip | undefined
  /** Salta: mueve el elemento y avisa a la pantalla para apuntar el progreso. */
  readonly onSaltar: () => void
}

export function PlayerSkipButton(props: PlayerSkipButtonProps): ReactNode {
  if (props.skip === undefined) return null

  return (
    <button
      type="button"
      className="player__skip"
      // El atajo no es adorno: dice que `S` dispara lo mismo, y es lo que anuncia
      // el lector de pantalla. El texto de la etiqueta viene de la pantalla
      // —«Saltar intro», «Saltar ending»—, que es la que conoce el tipo.
      aria-keyshortcuts="S"
      onClick={props.onSaltar}
    >
      {t(DEFAULT_LOCALE, props.skip.labelKey)}
    </button>
  )
}
