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
  /**
   * La referencia local de la portada: el servidor la resuelve contra su caché.
   *
   * Es la forma de siempre —la portada de un proveedor— y `src` la sustituye
   * cuando la imagen no sale de una referencia local, como la de AniList, que se
   * pide por su id.
   */
  readonly providerId?: string | undefined
  readonly ref?: string | undefined
  /** Una ruta de imagen ya compuesta. Gana sobre la referencia. */
  readonly src?: string | undefined
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

/** La ruta de la portada de esta pieza, o nada si no hay de dónde sacarla. */
export function coverSrc(props: CoverProps): string | undefined {
  if (props.src !== undefined) return props.src
  if (props.providerId === undefined || props.ref === undefined) return undefined

  return coverPath(props.providerId, props.ref)
}

export function Cover(props: CoverProps): ReactNode {
  const [fallo, setFallo] = useState(false)
  const ruta = coverSrc(props)

  if (fallo || ruta === undefined) {
    return (
      <span className={props.className ?? 'card__cover'} aria-hidden="true">
        {props.children}
      </span>
    )
  }

  return (
    <img
      className={props.className ?? 'card__cover'}
      src={ruta}
      alt=""
      loading="lazy"
      onError={() => setFallo(true)}
    />
  )
}
