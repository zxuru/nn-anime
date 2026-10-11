/**
 * Resultados de la búsqueda, o su ausencia explicada.
 *
 * Una tarjeta por **obra**, no por proveedor: dos fuentes que devuelven el mismo
 * título en el mismo año son la misma ficha, y pintarlas dos veces es contenido
 * repetido. La tarjeta lleva a la primera fuente que respondió; debajo, con
 * «También en», van los demás proveedores como enlaces a **su** ficha, que es lo
 * único que no se puede fusionar: abrir una tarjeta lleva a un sitio concreto.
 *
 * El estado vacío dice **por qué** está vacío: no es lo mismo una consulta sin
 * coincidencias que una pantalla en la que todavía no se ha buscado nada. Un
 * «no hay resultados» genérico obliga al usuario a adivinar cuál de las dos
 * cosas está mirando.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { SearchResult } from '@nn-anime/core/models'
import { Fragment, type ReactNode } from 'react'
import { Grid, GridItem } from '../../components/Grid'
import { t } from '../../i18n'
import { Link } from '../../router'
import { ResultCard } from './ResultCard'
import { alternativas, groupResults } from './useSearchStream'

export interface ResultGridProps {
  readonly results: readonly SearchResult[]
  /** La consulta que produjo estos resultados, para el texto del estado vacío. */
  readonly query: string
  readonly providerLabels?: ReadonlyMap<string, string>
  readonly onPreview?: (result: SearchResult) => void
  readonly onPreviewEnd?: () => void
}

/** La ruta de la ficha de un resultado, con la referencia codificada. */
function detailPath(result: SearchResult): string {
  return `/anime/${encodeURIComponent(result.ref.providerId)}/${encodeURIComponent(result.ref.value)}`
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
      {groupResults(props.results).map((grupo) => {
        // El grupo nunca está vacío: sale de un resultado que existe.
        const primero = grupo.results[0]
        if (primero === undefined) return null

        const etiqueta = props.providerLabels?.get(primero.ref.providerId)
        const otros = alternativas(grupo, primero.ref.providerId)

        return (
          <GridItem key={grupo.key}>
            <ResultCard
              result={primero}
              {...(etiqueta === undefined ? {} : { providerLabel: etiqueta })}
              {...(props.onPreview === undefined
                ? {}
                : { onPreview: () => props.onPreview?.(primero) })}
              {...(props.onPreviewEnd === undefined ? {} : { onPreviewEnd: props.onPreviewEnd })}
            />
            {otros.length === 0 ? null : (
              <p className="card__extra">
                {t(DEFAULT_LOCALE, 'search.alsoIn')}{' '}
                {otros.map((otro, indice) => {
                  const nombre = props.providerLabels?.get(otro.ref.providerId)
                  const visible = nombre ?? otro.ref.providerId

                  return (
                    <Fragment key={`${otro.ref.providerId}:${otro.ref.value}`}>
                      {indice === 0 ? null : ', '}
                      <Link
                        to={detailPath(otro)}
                        title={t(DEFAULT_LOCALE, 'search.alsoInItem', {
                          title: otro.title,
                          provider: visible,
                        })}
                      >
                        {visible}
                      </Link>
                    </Fragment>
                  )
                })}
              </p>
            )}
          </GridItem>
        )
      })}
    </Grid>
  )
}
