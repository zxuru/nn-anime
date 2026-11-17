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

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { Skeleton } from '../../components/Skeleton'
import { t } from '../../i18n'
import { Link } from '../../router'
import { searchPath } from '../search/SearchPage'
import { cuentaDeTitulos } from './tramo'

/**
 * Los anchos del esqueleto de la banda, en tanto por ciento del ancho disponible.
 *
 * Cuatro palabras de largo distinto: la banda real también las tiene, y cuatro
 * barras iguales se leerían como una tabla. No son medidas: la altura, que es lo
 * que decide si el tramo salta, sale del token de la palabra.
 */
const ANCHOS_DEL_ESQUELETO = ['26%', '19%', '22%', '16%'] as const

export interface GenreCount {
  /** El nombre del género, como lo publica el catálogo. */
  readonly name: string
  /** Cuántos títulos del catálogo lo llevan. */
  readonly count: number
}

export interface GenreRowProps {
  readonly genres: readonly GenreCount[]
  /** Si el motor sigue buscando los géneros del catálogo. */
  readonly cargando?: boolean | undefined
}

/** Las etiquetas ordenadas por cuántas veces salen. */
export function topGenres(tags: readonly (readonly string[])[], limit: number): readonly string[] {
  return generosConCuenta(tags, limit).map((genero) => genero.name)
}

export function GenreRow(props: GenreRowProps): ReactNode {
  if (props.cargando === true) {
    /*
     * Una banda de palabras, no un muro de carteles.
     *
     * El esqueleto era el de un tramo de carteles —seis piezas 2:3— y lo que llega
     * es una banda de palabras grandes, con otro alto: el tramo cambiaba de forma al
     * cargar y todo lo de abajo se movía. Aquí el hueco tiene el alto de la palabra
     * y la misma banda, así que cuando llegan los géneros sólo cambia el texto.
     */
    return (
      <section className="seccion" aria-busy="true">
        <SectionHeader
          title={t(DEFAULT_LOCALE, 'home.genres')}
          meta={t(DEFAULT_LOCALE, 'home.genres.meta')}
        />

        <div className="seccion__cuerpo">
          <p className="solo-lectores" role="status">
            {t(DEFAULT_LOCALE, 'home.genres.loading')}
          </p>
          <div className="generos">
            {ANCHOS_DEL_ESQUELETO.map((ancho) => (
              <Skeleton
                key={ancho}
                h="calc(var(--genero-nombre) * var(--genero-linea))"
                w={ancho}
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

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
