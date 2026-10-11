/**
 * Pantalla de inicio.
 *
 * Sigue el orden del diseño de referencia: cinta de lo que hay ahora, cartel de
 * destacado, top de la semana, continuar viendo, favoritos, tendencias y géneros.
 *
 * Lo que el diseño trae y aquí no está, porque no hay datos para ello: la
 * **parrilla semanal** de estrenos y la fila de **episodios nuevos**. Las dos
 * necesitan una fecha de emisión por episodio, y los proveedores no la dan. Se
 * pone lo que sí se sabe en vez de inventar fechas.
 *
 * Cada fila se explica cuando está vacía en vez de esconderse: una fila que
 * desaparece sin más deja al usuario sin saber si la función existe.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Panel } from '../recommendations/Panel'
import { useRecommendations } from '../recommendations/useRecommendations'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { FeaturedHero } from './FeaturedHero'
import { GenreRow, topGenres } from './GenreRow'
import { Ticker } from './Ticker'
import { TopFive } from './TopFive'
import { TrendingRow } from './TrendingRow'
import { useHomeRows } from './useHomeRows'

export interface HomePageProps {
  readonly query?: string | undefined
}

/** Cuántos géneros se enseñan en la lista grande. */
export const GENRE_LIMIT = 10

export function HomePage(props: HomePageProps): ReactNode {
  const filas = useHomeRows()
  const recomendaciones = useRecommendations({
    ...(props.query === undefined ? {} : { query: props.query }),
  })

  const items = recomendaciones.data?.items ?? []
  const destacado = items[0]
  const generos = topGenres(
    items.map((item) => item.tags),
    GENRE_LIMIT,
  )

  return (
    <section className="home">
      <Ticker items={filas.trending} />

      {filas.error === undefined ? null : <p className="search__error">{filas.error}</p>}

      {/* Sin destacado —todavía no hay nada que recomendar— el titular de la
          página es el suyo: una pantalla sin `h1` deja al lector de pantalla sin
          saber dónde está. */}
      {destacado === undefined ? (
        <h1 className="hero__title">{t(DEFAULT_LOCALE, 'home.title')}</h1>
      ) : (
        <FeaturedHero item={destacado} />
      )}

      {recomendaciones.state === 'loading' ? (
        <p className="empty" aria-busy="true">
          {t(DEFAULT_LOCALE, 'home.loading')}
        </p>
      ) : null}

      <TopFive items={items} coldStart={recomendaciones.data?.coldStart ?? true} />

      <ContinueRow items={filas.continueWatching} />
      <FavoritesRow items={filas.favorites} />
      <TrendingRow items={filas.trending} />

      <GenreRow genres={generos} />

      {/*
        El panel con el detalle del score sigue existiendo, pero como lo que es:
        una herramienta para entender el motor, no la fila principal. El top de
        arriba ya enseña las razones.
      */}
      <details className="panel__details">
        <summary className="section__meta">{t(DEFAULT_LOCALE, 'home.explain')}</summary>
        <Panel {...(props.query === undefined ? {} : { query: props.query })} />
      </details>
    </section>
  )
}
