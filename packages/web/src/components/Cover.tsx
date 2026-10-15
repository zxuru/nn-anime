/**
 * La portada de un título.
 *
 * Un `<img>` que apunta a `/api/cover/...` y que, cuando esa portada no llega
 * —sin red, sin proveedor, o con el título recién cacheado— **se convierte en un
 * hueco con el degradado del diseño**. Antes quedaba el icono de imagen rota del
 * navegador, que es lo que se veía en la captura del rediseño: el diseño de
 * referencia llena esos huecos con dos colores en diagonal, y un icono de error
 * no se parece a eso.
 *
 * El estado de fallo es del componente y no del CSS porque el navegador no avisa
 * de otra forma: `:not([src])` no distingue «sin portada» de «portada que falló».
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { coverPath } from '../features/search/ResultCard'
export interface CoverProps {
  readonly providerId: string
  readonly ref: string
  readonly className?: string | undefined
  /**
   * Lo que se dibuja cuando la portada no llega.
   *
   * La vitrina dibuja su propio arte —inicial, cifra, trama— y lo enseña sólo si
   * la portada falla: si llega la de verdad, manda la portada. Va como hijo del
   * campo y no como hermano porque un `<img>` no pinta pseudo-elementos ni dibuja
   * dentro: el navegador, si tiene imagen, no deja hueco para el dibujo.
   */
  readonly children?: ReactNode
}

export function Cover(props: CoverProps): ReactNode {
  const [fallo, setFallo] = useState(false)

  if (fallo) {
    return (
      <span className={props.className ?? 'card__cover'} aria-hidden="true">
        {props.children}
      </span>
    )
  }

  return (
    <img
      className={props.className ?? 'card__cover'}
      src={coverPath(props.providerId, props.ref)}
      alt=""
      loading="lazy"
      onError={() => setFallo(true)}
    />
  )
}
