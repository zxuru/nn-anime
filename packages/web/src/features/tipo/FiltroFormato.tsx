/**
 * El filtro de formato: `Todo` · `Series` · `Películas`.
 *
 * Es el **único** eje que queda desde T372: la aplicación sirve anime y películas
 * de anime, así que la familia de contenido desapareció. Por eso puede llevar su
 * rótulo visible, medir lo que mide un mando y quedarse pegado bajo la cabecera:
 * antes competía con la píldora de familia que vivía arriba y se leía como una
 * fila suelta.
 *
 * Son enlaces con `aria-current`: el formato vive en la dirección (`?formato=`),
 * se puede abrir en otra pestaña y el botón de atrás deshace el cambio. Sin
 * `formato=` la opción activa es «Todo».
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { MediaFormat } from '@rona/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link, usePath } from '../../router'
import { ANCLAS } from '../guia/guia'
import { formatoFromPath, pathConFormato } from './tipo'

/** Las tres opciones, en el orden en que se enseñan. */
const OPCIONES: readonly (MediaFormat | undefined)[] = [undefined, 'series', 'movie']

/** Las tres claves, escritas una por una: el catálogo se lee así. */
const CLAVE: Readonly<Record<'all' | 'series' | 'movie', string>> = {
  all: 'media.format.all',
  series: 'media.format.series',
  movie: 'media.format.movie',
}

function claveDeFormato(formato: MediaFormat | undefined): string {
  return CLAVE[formato ?? 'all']
}

export function FiltroFormato(): ReactNode {
  const path = usePath()
  const actual = formatoFromPath(path)

  return (
    <div className="formato" data-tour={ANCLAS.tipo}>
      <span className="formato__rotulo" id="formato-rotulo">
        {t(DEFAULT_LOCALE, 'media.format.label')}
      </span>
      <nav className="formato__opciones" aria-labelledby="formato-rotulo">
        {OPCIONES.map((opcion) => (
          <Link
            key={opcion ?? 'all'}
            to={pathConFormato(path, opcion)}
            className="formato__opcion"
            ariaCurrent={opcion === actual ? 'page' : undefined}
          >
            {t(DEFAULT_LOCALE, claveDeFormato(opcion))}
          </Link>
        ))}
      </nav>
    </div>
  )
}
