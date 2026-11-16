/**
 * El aviso de que algo falló, con su reintento.
 *
 * El reintento reanuda en el mismo segundo: no recarga la página ni vuelve a
 * empezar el episodio. Sólo se ofrece cuando hay algo que reintentar —red o
 * media—, porque un botón que no hace nada es peor que no tenerlo: un navegador
 * que no sabe reproducir HLS o una fuente que no existe no se arreglan repitiendo.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface PlayerErrorNoticeProps {
  readonly error: string
  readonly retryable: boolean
  readonly onRetry: () => void
}

export function PlayerErrorNotice(props: PlayerErrorNoticeProps): ReactNode {
  return (
    <div className="player__error">
      <p className="search__error">{t(DEFAULT_LOCALE, 'player.error', { message: props.error })}</p>
      {props.retryable ? (
        <button type="button" className="button player__retry" onClick={props.onRetry}>
          {t(DEFAULT_LOCALE, 'player.retry')}
        </button>
      ) : null}
    </div>
  )
}
