/**
 * El filtro de formato: `Todo` · `Series` · `Películas`.
 *
 * Está **debajo** del conmutador de familia y se pinta siempre en las tres: es
 * una consulta válida aunque una familia no tenga películas, y esconderlo según
 * los resultados haría que apareciera y desapareciera al cambiar de familia. La
 * lista vacía se explica con el estado de siempre.
 *
 * Son enlaces con `aria-current`, como el conmutador: el formato vive en la
 * dirección (`?formato=`), se puede abrir en otra pestaña y el botón de atrás
 * deshace el cambio. Sin `formato=` la opción activa es «Todo».
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { MediaFormat } from '@rona/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link, usePath } from '../../router'
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
    <nav className="formato" aria-label={t(DEFAULT_LOCALE, 'media.format.switch')}>
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
  )
}
