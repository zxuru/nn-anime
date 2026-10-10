/**
 * Resultados de la búsqueda, o su ausencia explicada.
 *
 * El estado vacío dice **por qué** está vacío: no es lo mismo una consulta sin
 * coincidencias que una pantalla en la que todavía no se ha buscado nada. Un
 * «no hay resultados» genérico obliga al usuario a adivinar cuál de las dos
 * cosas está mirando.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { SearchResult } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { ResultCard } from './ResultCard'

export interface ResultGridProps {
  readonly results: readonly SearchResult[]
  /** La consulta que produjo estos resultados, para el texto del estado vacío. */
  readonly query: string
  readonly providerLabels?: ReadonlyMap<string, string>
}

export function ResultGrid(props: ResultGridProps): ReactNode {
  if (props.results.length === 0) {
    return (
      <p className="empty">
        {props.query === ''
          ? t(DEFAULT_LOCALE, 'search.emptyNoQuery')
          : t(DEFAULT_LOCALE, 'search.empty', { query: props.query })}
      </p>
    )
  }

  return (
    <Grid label={t(DEFAULT_LOCALE, 'search.results')}>
      {props.results.map((result) => (
        <GridItem key={`${result.ref.providerId}:${result.ref.value}`}>
          <ResultCard
            result={result}
            {...(props.providerLabels?.get(result.ref.providerId) === undefined
              ? {}
              : { providerLabel: props.providerLabels.get(result.ref.providerId) })}
          />
        </GridItem>
      ))}
    </Grid>
  )
}
