/**
 * Los géneros, en grande.
 *
 * Cada género es un enlace a la búsqueda por ese término: es la forma más corta
 * de que la lista sirva para algo. Salen de los títulos que hay en la base —los
 * que el motor usa como características— y no de una lista fija, así que un
 * catálogo sin género «mecha» no lo enseña.
 *
 * Es la banda que cierra la vitrina: palabras grandes en serif, una al lado de
 * otra, con la línea por debajo. Se lee al pasear la vista, no al leer.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { Link } from '../../router'
import { searchPath } from '../search/SearchPage'

export interface GenreRowProps {
  readonly genres: readonly string[]
}

/** Las etiquetas ordenadas por cuántas veces salen. */
export function topGenres(tags: readonly (readonly string[])[], limit: number): readonly string[] {
  const cuenta = new Map<string, number>()

  for (const lista of tags) {
    for (const tag of lista) cuenta.set(tag, (cuenta.get(tag) ?? 0) + 1)
  }

  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

export function GenreRow(props: GenreRowProps): ReactNode {
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.genres')}
        meta={t(DEFAULT_LOCALE, 'home.genres.meta')}
      />

      <div className="seccion__cuerpo">
        {props.genres.length === 0 ? (
          <p className="empty">{t(DEFAULT_LOCALE, 'home.genres.empty')}</p>
        ) : (
          <ul className="generos">
            {props.genres.map((genero) => (
              <li key={genero}>
                <Link to={searchPath(genero)} className="genero">
                  {genero}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
