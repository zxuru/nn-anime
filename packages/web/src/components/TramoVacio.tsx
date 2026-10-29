/**
 * Un tramo sin nada que enseñar, dicho en una línea.
 *
 * Un vacío no es una pieza: con la forma de un cartel ocupaba el mismo alto que
 * los títulos que sí existen, y una home sin datos se leía como una aplicación
 * rota durante media pantalla. Va como renglón dentro del tramo —titular y
 * cuerpo, separados por el primer punto de la frase—, que explica lo que falta
 * sin pedir el sitio de lo que no falta.
 */

import type { ReactNode } from 'react'

export interface TramoVacioProps {
  /** El texto del catálogo: el primer punto separa el titular del cuerpo. */
  readonly texto: string
}

/**
 * El corte entre lo que titula y lo que explica.
 *
 * Los textos del catálogo vienen en una frase —«Nada a medias. Lo que empieces
 * aparecerá aquí.»— y el primer punto es el corte natural entre el titular y el
 * cuerpo. Una frase sin punto se queda con el titular y sin cuerpo: un renglón con
 * un guion de relleno es peor que un renglón.
 */
export function tituloYCuerpo(texto: string): { readonly title: string; readonly body?: string } {
  const corte = texto.indexOf('. ')

  if (corte === -1) return { title: texto }

  return { title: texto.slice(0, corte), body: texto.slice(corte + 2) }
}

export function TramoVacio(props: TramoVacioProps): ReactNode {
  const { title, body } = tituloYCuerpo(props.texto)

  return (
    <p className="tramo-vacio">
      <span className="tramo-vacio__titulo">{title}</span>
      {body === undefined ? null : <span className="tramo-vacio__cuerpo">{body}</span>}
    </p>
  )
}
