/**
 * Botón de «ya visto».
 *
 * Es el hermano del de favoritos y con su mismo contrato: un `<button>` con
 * `aria-pressed`, estado inmediato y reversión si el servidor falla. El nombre
 * accesible dice el estado en el que está —como el de favoritos— y **no menciona
 * episodios**: la marca es de la obra, y vale igual para una película.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface WatchedButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function WatchedButton(props: WatchedButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="button"
      aria-pressed={props.value}
      {...(props.busy === true ? { disabled: true } : {})}
      onClick={props.onToggle}
    >
      {props.value
        ? t(DEFAULT_LOCALE, 'detail.watched.remove')
        : t(DEFAULT_LOCALE, 'detail.watched.add')}
    </button>
  )
}
