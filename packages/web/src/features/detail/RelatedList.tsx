/**
 * Los hermanos de saga de la ficha.
 *
 * La lista la calcula el servidor sobre lo que la base ya conoce: no hay
 * petición al proveedor por abrir una ficha. Cuando no hay ninguno, la sección
 * **se explica** en vez de desaparecer, que es la regla que ya sigue la home:
 * una sección que no está no dice si es que no hay o si es que no se pudo.
 *
 * Cada fila es un enlace de verdad —`<a href>`, con la navegación sin recarga
 * encima—, así que se abre en otra pestaña y se recorre con el teclado. La
 * portada se pide al proxy y, si el proveedor no declaró una dirección usable,
 * el hueco se pinta como hueco en lugar de pedir algo que no puede existir.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { isSafeUrl } from '../../lib/safe-url'
import { buildPath, Link } from '../../router'

export interface RelatedListProps {
  readonly items: readonly AnimeSummary[]
}

/** El año, o nada: un título sin año no se inventa uno. */
function meta(item: AnimeSummary): string {
  if (item.year === undefined) return ''

  return t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
}

export function RelatedList(props: RelatedListProps): ReactNode {
  if (props.items.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.related.none')}</p>
  }

  return (
    <ul className="related">
      {props.items.map((item) => {
        const año = meta(item)

        return (
          <li key={`${item.ref.providerId}:${item.ref.value}`}>
            <Link
              className="related__item"
              to={buildPath('detail', {
                providerId: item.ref.providerId,
                ref: item.ref.value,
              })}
              title={item.title}
            >
              {isSafeUrl(item.coverUrl) ? (
                <Cover
                  providerId={item.ref.providerId}
                  ref={item.ref.value}
                  className="related__cover"
                />
              ) : (
                <span className="related__cover" aria-hidden="true" />
              )}
              <span>
                <span className="related__title">{item.title}</span>
                {año === '' ? null : <span className="related__meta">{año}</span>}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
