/**
 * Botón de favorito.
 *
 * Es un `<button>` con `aria-pressed`, no un enlace ni un `div` con `onClick`:
 * un lector de pantalla tiene que poder decir si el título está en favoritos, y
 * eso es exactamente lo que significa `aria-pressed`. El estado cambia al
 * instante y se revierte si el servidor falla, así que el botón nunca miente
 * durante más de lo que tarda la petición.
 *
 * La estrella **se rellena** cuando el título está guardado: el color solo no
 * basta —hay quien no distingue el acento del gris—, y el relleno dice el estado
 * sin depender del tono. Es una estrella y no un corazón porque los textos de la
 * aplicación ya la nombran así («la estrella está en la ficha»). El nombre
 * accesible lo lleva el `aria-label`, que es además el texto visible en
 * escritorio: en una pantalla estrecha el botón se queda con el dibujo y el
 * rótulo se recorta, no se borra.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

export interface FavoriteButtonProps {
  readonly value: boolean
  readonly busy?: boolean
  readonly onToggle: () => void
}

export function FavoriteButton(props: FavoriteButtonProps): ReactNode {
  const etiqueta = t(DEFAULT_LOCALE, props.value ? 'detail.favorite.remove' : 'detail.favorite.add')

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
      <Star
        size={18}
        strokeWidth={props.value ? 2.5 : 2}
        // `currentColor` y no un color propio: el dibujo hereda la tinta del
        // botón, que cambia de tema y de estado con él.
        fill={props.value ? 'currentColor' : 'none'}
        aria-hidden="true"
        focusable="false"
      />
      <span className="button__texto">{etiqueta}</span>
    </button>
  )
}
