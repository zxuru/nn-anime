/**
 * Botón de favorito.
 *
 * Es un `<button>` con `aria-pressed`, no un enlace ni un `div` con `onClick`:
 * un lector de pantalla tiene que poder decir si el título está en favoritos, y
 * eso es exactamente lo que significa `aria-pressed`. El estado cambia al
 * instante y se revierte si el servidor falla, así que el botón nunca miente
 * durante más de lo que tarda la petición.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface FavoriteButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function FavoriteButton(props: FavoriteButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="button"
      aria-pressed={props.value}
      {...(props.busy === true ? { disabled: true } : {})}
      onClick={props.onToggle}
    >
      {props.value
        ? t(DEFAULT_LOCALE, 'detail.favorite.remove')
        : t(DEFAULT_LOCALE, 'detail.favorite.add')}
    </button>
  )
}
