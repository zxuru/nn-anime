/**
 * Botón de «quiero ver».
 *
 * Tercer hermano del de favoritos y el de visto, y con su mismo contrato: un
 * `<button>` con `aria-pressed`, estado inmediato y reversión si el servidor falla.
 * El nombre accesible dice el estado en el que está y **no menciona episodios**: la
 * marca es de la obra, y vale igual para una película.
 *
 * Es **independiente** de las otras dos: pulsarlo no cambia el favorito ni la marca
 * de visto. Por eso son tres botones y no un mando con tres estados: son tres
 * listas del usuario, no tres valores de lo mismo.
 *
 * El dibujo es el marcador, que se rellena cuando la obra está apuntada: es el
 * mismo que encabeza la sección «Quiero ver» del Perfil.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { Bookmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface PlanToWatchButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function PlanToWatchButton(props: PlanToWatchButtonProps): ReactNode {
  const etiqueta = t(
    DEFAULT_LOCALE,
    props.value ? 'detail.planToWatch.remove' : 'detail.planToWatch.add',
  )

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
      <Bookmark
        size={18}
        strokeWidth={props.value ? 2.5 : 2}
        fill={props.value ? 'currentColor' : 'none'}
        aria-hidden="true"
        focusable="false"
      />
      <span className="button__texto">{etiqueta}</span>
    </button>
  )
}
