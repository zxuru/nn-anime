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
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface PlanToWatchButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function PlanToWatchButton(props: PlanToWatchButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="button"
      aria-pressed={props.value}
      {...(props.busy === true ? { disabled: true } : {})}
      onClick={props.onToggle}
    >
      {props.value
        ? t(DEFAULT_LOCALE, 'detail.planToWatch.remove')
        : t(DEFAULT_LOCALE, 'detail.planToWatch.add')}
    </button>
  )
}
