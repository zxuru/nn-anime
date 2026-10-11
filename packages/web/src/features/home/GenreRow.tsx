/**
 * Los géneros, en grande.
 *
 * Cada género es un enlace a la búsqueda por ese término: es la forma más corta
 * de que la lista sirva para algo. Salen de los títulos que hay en la base —los
 * que el motor usa como características— y no de una lista fija, así que un
 * catálogo sin género «mecha» no lo enseña.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
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
    <section className="section">
      <header className="section__head">
        <h2 className="section__title">{t(DEFAULT_LOCALE, 'home.genres')}</h2>
        <p className="section__meta">{t(DEFAULT_LOCALE, 'home.genres.meta')}</p>
      </header>

      {props.genres.length === 0 ? (
        <p className="empty">{t(DEFAULT_LOCALE, 'home.genres.empty')}</p>
      ) : (
        <ul className="genres">
          {props.genres.map((genero) => (
            <li key={genero}>
              <Link to={searchPath(genero)} className="genres__item">
                {genero}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
