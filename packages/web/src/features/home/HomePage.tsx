/**
 * Pantalla de inicio.
 *
 * Sigue el orden del diseño de referencia: cinta de lo que hay ahora, cartel de
 * destacado, **el top de la fuente**, continuar viendo, favoritos, novedades,
 * último añadido y géneros.
 *
 * Lo que el diseño trae y aquí no está, porque no hay datos para ello: la
 * **parrilla semanal** de estrenos y la fila de **episodios nuevos**. Las dos
 * necesitan una fecha de emisión por episodio, y los proveedores no la dan. Se
 * pone lo que sí se sabe en vez de inventar fechas.
 *
 * Cada fila se explica cuando está vacía en vez de esconderse: una fila que
 * desaparece sin más deja al usuario sin saber si la función existe.
 */

import type { FeedItem, RecommendationResponse } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Panel } from '../recommendations/Panel'
import { useRecommendations } from '../recommendations/useRecommendations'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { FeaturedHero, type FeaturedItem } from './FeaturedHero'
import { FeedRow } from './FeedRow'
import { GenreRow, topGenres } from './GenreRow'
import { RecentRow } from './RecentRow'
import { Ticker } from './Ticker'
import { TopRow } from './TopRow'
import { type HomeRows, useHomeRows } from './useHomeRows'

export interface HomePageProps {
  readonly query?: string | undefined
}

/** Cuántos géneros se enseñan en la lista grande. */
export const GENRE_LIMIT = 10

/**
 * Un resumen como destacado de reserva.
 *
 * Ni el feed ni la caché traen tags —el vector lo tiene la ficha, no el listado—,
 * así que el cartel se queda con lo que sí sabe: referencia, título y año. El
 * resto lo pone el detalle cuando llega.
 */
export function comoDestacado(item: AnimeSummary | undefined): FeaturedItem | undefined {
  if (item === undefined) return undefined

  return {
    ref: item.ref,
    title: item.title,
    tags: [],
    ...(item.year === undefined ? {} : { year: item.year }),
  }
}

/**
 * El destacado, con sus reservas en orden: el motor, lo que publica la fuente y
 * lo último que la aplicación conoce.
 *
 * Es una función y no dos `??` dentro del componente para poder probar las tres
 * ramas: un `renderToString` de la home no ejecuta efectos, así que ahí no se ve.
 */
export function featuredOf(
  recomendaciones: readonly RecommendationResponse[],
  feed: readonly FeedItem[],
  recientes: readonly AnimeSummary[],
): FeaturedItem | undefined {
  return recomendaciones[0] ?? comoDestacado(feed[0]) ?? comoDestacado(recientes[0])
}

/**
 * Cuántos minutos hace de una fecha.
 *
 * Hacia abajo y sin negativos: un reloj que va un poco por detrás —o una fecha que
 * llegó del futuro— no puede pintar «hace -1 min».
 */
export function minutosDesde(desde: Date | undefined, ahora: Date): number {
  if (desde === undefined) return 0

  return Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000))
}

/**
 * Qué clave de i18n toca.
 *
 * Los primeros segundos son «ahora mismo» y no «hace 0 min»: el cero no se dice.
 */
export function marcaDeRefresco(minutos: number): 'home.refreshedNow' | 'home.refreshed' {
  return minutos === 0 ? 'home.refreshedNow' : 'home.refreshed'
}

/**
 * El texto de la marca de refresco, o nada.
 *
 * Es una función y no un ternario dentro del JSX porque la decisión tiene tres
 * ramas —no hay relectura todavía, hay una en curso, hay minutos— y un
 * `renderToString` de la home no ejecuta efectos: dentro del componente no se
 * podría medir ninguna.
 */
export function textoDeRefresco(
  filas: Pick<HomeRows, 'refrescando' | 'refreshedAt' | 'relecturas'>,
  ahora: Date,
): string | undefined {
  if (filas.relecturas === 0) return undefined
  if (filas.refrescando) return t(DEFAULT_LOCALE, 'home.refreshing')

  const minutos = minutosDesde(filas.refreshedAt, ahora)

  return t(DEFAULT_LOCALE, marcaDeRefresco(minutos), { minutes: minutos })
}

export function HomePage(props: HomePageProps): ReactNode {
  const filas = useHomeRows()
  const recomendaciones = useRecommendations({
    ...(props.query === undefined ? {} : { query: props.query }),
  })

  const items = recomendaciones.data?.items ?? []
  // El destacado tiene tres reservas, en este orden: el motor, lo que publica la
  // fuente y lo último que la aplicación conoce. Sin ellas, una instalación nueva
  // con un proveedor sin tendencias se quedaba con un titular y nada más.
  const destacado = featuredOf(items, filas.feed, filas.recent)
  const generos = topGenres(
    items.map((item) => item.tags),
    GENRE_LIMIT,
  )
  const refresco = textoDeRefresco(filas, new Date())

  return (
    <section className="home">
      <Ticker items={filas.trending} />

      {filas.error === undefined ? null : <p className="search__error">{filas.error}</p>}

      {/*
        La marca del refresco. Sólo sale después de la primera relectura: al abrir,
        «actualizado ahora mismo» es el estado normal de la página y decirlo no
        informa de nada. Es `role="status"` para que se anuncie sin robar el foco.
      */}
      {refresco === undefined ? null : (
        <p className="home__refresco" role="status">
          {refresco}
        </p>
      )}

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

      {/*
        «Continuar viendo» va la primera, antes que el top y que las novedades.
        Es la única fila que pide una acción concreta —retomar lo que se dejó a
        medias— y lo demás es descubrir: quien entra a seguir un episodio no
        debería bajarlo a buscar entre las recomendaciones.
      */}
      <ContinueRow items={filas.continueWatching} />

      {/* El top es el de la fuente —su orden y su puesto— y no el ranking del
          motor: el motor ya tiene su sitio, el destacado y el panel de abajo. */}
      <TopRow items={filas.trending} />

      <FeedRow items={filas.feed} />
      <RecentRow items={filas.recent} />

      <FavoritesRow items={filas.favorites} />

      <GenreRow genres={generos} />

      {/*
        El panel con el detalle del score sigue existiendo, pero como lo que es:
        una herramienta para entender el motor, no la fila principal. Desde que el
        top es el de la fuente, **aquí** es donde se leen las razones de cada
        recomendación: quitar la fila de motivos sin dejarlos en otro sitio habría
        dejado al motor recomendando sin explicarse.
      */}
      <details className="panel__details">
        <summary className="section__meta">{t(DEFAULT_LOCALE, 'home.explain')}</summary>
        <Panel {...(props.query === undefined ? {} : { query: props.query })} />
      </details>
    </section>
  )
}
