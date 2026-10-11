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
}

export function Cover(props: CoverProps): ReactNode {
  const [fallo, setFallo] = useState(false)

  if (fallo) return <span className={props.className ?? 'card__cover'} aria-hidden="true" />

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
