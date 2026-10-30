/**
 * Botón de «ya visto».
 *
 * Es el hermano del de favoritos y con su mismo contrato: un `<button>` con
 * `aria-pressed`, estado inmediato y reversión si el servidor falla. El nombre
 * accesible dice el estado en el que está —como el de favoritos— y **no menciona
 * episodios**: la marca es de la obra, y vale igual para una película.
 *
 * El dibujo es el círculo con la marca de visto: es el mismo que lleva la sección
 * «Ya vistos» del Perfil, y así el botón y la lista hablan el mismo idioma.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface WatchedButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function WatchedButton(props: WatchedButtonProps): ReactNode {
  const etiqueta = t(DEFAULT_LOCALE, props.value ? 'detail.watched.remove' : 'detail.watched.add')

  return (
    <button
      type="button"
      className="button button--icono"
      aria-label={etiqueta}
      title={etiqueta}
      aria-pressed={props.value}
      {...(props.busy === true ? { disabled: true } : {})}
      onClick={props.onToggle}
    >
      <CircleCheck
        size={18}
        strokeWidth={props.value ? 2.5 : 2}
        aria-hidden="true"
        focusable="false"
      />
      <span className="button__texto">{etiqueta}</span>
    </button>
  )
}
