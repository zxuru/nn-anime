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
import { cuentaDeTitulos } from './tramo'

export interface GenreCount {
  /** El nombre del género, como lo publica el catálogo. */
  readonly name: string
  /** Cuántos títulos del catálogo lo llevan. */
  readonly count: number
}

export interface GenreRowProps {
  readonly genres: readonly GenreCount[]
}

/** Las etiquetas ordenadas por cuántas veces salen. */
export function topGenres(tags: readonly (readonly string[])[], limit: number): readonly string[] {
  return generosConCuenta(tags, limit).map((genero) => genero.name)
}

export function GenreRow(props: GenreRowProps): ReactNode {
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.genres')}
        meta={t(DEFAULT_LOCALE, 'home.genres.meta')}
        {...(props.genres.length === 0
          ? {}
          : {
              cuenta:
                props.genres.length === 1
                  ? t(DEFAULT_LOCALE, 'home.genres.countOne')
                  : t(DEFAULT_LOCALE, 'home.genres.count', { count: props.genres.length }),
            })}
      />

      <div className="seccion__cuerpo">
        {props.genres.length === 0 ? (
          <p className="aviso-vacio">{t(DEFAULT_LOCALE, 'home.genres.empty')}</p>
        ) : (
          <div className="generos">
            {props.genres.map((genero) => (
              <Link key={genero.name} to={searchPath(genero.name)} className="genero">
                {genero.name}
                <span className="genero__cuenta" aria-hidden="true">
                  {genero.count}
                </span>
                <span className="solo-lectores">{cuentaDeTitulos(genero.count)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Los géneros con su recuento, ordenados por los que más salen.
 *
 * El recuento es el número de títulos del catálogo que llevan ese género, y va en
 * voladizo sobre la palabra: es la información que hace que la banda sirva para
 * algo más que para leer. Se cuenta sobre los mismos tags que ordena el motor.
 */
export function generosConCuenta(
  tags: readonly (readonly string[])[],
  limit: number,
): readonly GenreCount[] {
  const cuenta = new Map<string, number>()

  for (const lista of tags) {
    for (const tag of lista) cuenta.set(tag, (cuenta.get(tag) ?? 0) + 1)
  }

  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}
