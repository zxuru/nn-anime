/**
 * Pantalla de inicio.
 *
 * Cuatro filas: continuar viendo, favoritos, tendencias y recomendaciones. Cada
 * una se explica cuando está vacía en vez de esconderse: una fila que desaparece
 * sin más deja al usuario sin saber si la función existe.
 *
 * La consulta del buscador entra al panel de recomendaciones para que la home
 * reaccione a lo que se está buscando.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Panel } from '../recommendations/Panel'
import { ContinueRow } from './ContinueRow'
import { FavoritesRow } from './FavoritesRow'
import { TrendingRow } from './TrendingRow'
import { useHomeRows } from './useHomeRows'

export interface HomePageProps {
  readonly query?: string | undefined
}

export function HomePage(props: HomePageProps): ReactNode {
  const filas = useHomeRows()

  return (
    <section className="home">
      <h1>{t(DEFAULT_LOCALE, 'home.title')}</h1>

      {filas.error === undefined ? null : <p className="search__error">{filas.error}</p>}

      {filas.loading ? (
        <p className="empty" aria-busy="true">
          {t(DEFAULT_LOCALE, 'home.loading')}
        </p>
      ) : (
        <>
          <ContinueRow items={filas.continueWatching} />
          <FavoritesRow items={filas.favorites} />
          <TrendingRow items={filas.trending} />
        </>
      )}

      <Panel {...(props.query === undefined ? {} : { query: props.query })} />
    </section>
  )
}
