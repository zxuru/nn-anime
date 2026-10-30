/**
 * Un dibujo de lucide con su texto al lado, y el texto acortado donde no cabe.
 *
 * Es el único sitio donde un icono y su etiqueta se juntan: quien lo usa no
 * escribe un `<svg>` ni decide el tamaño, y así el juego entero mide lo mismo y
 * se apaga igual. El tamaño base es de 18 px —el de la casa— y el grosor de
 * trazo también: 2, con el 2,5 del estado activo puesto por la hoja sobre
 * `[aria-current="page"]`, que es donde se sabe qué destino está encendido.
 *
 * **El nombre accesible lo lleva el texto, no el dibujo.** El `<svg>` va con
 * `aria-hidden`: el botón o el enlace que lo contiene ya tiene su nombre —el
 * texto visible o su `aria-label`— y un dibujo con nombre propio haría que el
 * lector de pantalla dijera dos veces el mismo mando.
 *
 * El `title` no es decoración: en escritorio es lo que deja leer la etiqueta
 * completa cuando el texto se ha acortado, sin abrir nada.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** El tamaño del juego entero. Uno solo: el icono no escala con el texto. */
export const ICON_SIZE = 18

export interface IconLabelProps {
  /** El dibujo de lucide, importado por nombre para que el bundler lo recorte. */
  readonly icon: LucideIcon
  /** El texto completo. Es también el nombre accesible cuando no hay `short`. */
  readonly label: string
  /** La versión corta, la que se lee en una pantalla estrecha. */
  readonly short?: string | undefined
  /** El tamaño del dibujo. Por defecto, el de la casa. */
  readonly size?: number | undefined
  /**
   * Si en móvil se queda sólo el dibujo.
   *
   * El texto **no** desaparece del documento: se recorta a un píxel, que es lo
   * que conserva el nombre accesible y el `title`.
   */
  readonly iconOnlyOnMobile?: boolean | undefined
}

export function IconLabel(props: IconLabelProps): ReactNode {
  const { icon: Icono, label, short } = props

  const clases = ['icon-label']
  // El acortado sólo cambia el texto donde hay dos versiones. Sin `short`, la
  // etiqueta completa sigue a la vista: esconderla dejaría el mando sin nombre.
  if (short !== undefined) clases.push('icon-label--con-corto')
  if (props.iconOnlyOnMobile === true) clases.push('icon-label--solo-movil')

  return (
    <span className={clases.join(' ')} title={label}>
      <Icono size={props.size ?? ICON_SIZE} strokeWidth={2} aria-hidden="true" focusable="false" />
      <span className="icon-label__texto">
        <span className="icon-label__largo">{label}</span>
        {short === undefined ? null : <span className="icon-label__corto">{short}</span>}
      </span>
    </span>
  )
}
