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
import type { AnimeSummary, ProviderRef } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Cover } from '../../components/Cover'
import { t } from '../../i18n'
import { isSafeUrl } from '../../lib/safe-url'
import { buildPath, Link } from '../../router'

export interface RelatedListProps {
  readonly items: readonly AnimeSummary[]
  /**
   * La entrega que se está viendo, si está en la lista.
   *
   * Sale **marcada y sin enlace**: es donde ya se está, y un enlace a la misma
   * ficha que se está leyendo es un enlace que no lleva a ninguna parte. La marca
   * es la palabra, no sólo el color, como en el resto de la interfaz.
   */
  readonly current?: ProviderRef | undefined
  /** La insignia de la fila, cuando el grupo tiene algo que decir de ella. */
  readonly badge?: ((item: AnimeSummary) => string | undefined) | undefined
}

/** El año, o nada: un título sin año no se inventa uno. */
function meta(item: AnimeSummary): string {
  if (item.year === undefined) return ''

  return t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
}

/** La misma referencia: proveedor **y** valor, nunca sólo uno de los dos. */
function esLaActual(item: AnimeSummary, current: ProviderRef | undefined): boolean {
  return (
    current !== undefined &&
    item.ref.providerId === current.providerId &&
    item.ref.value === current.value
  )
}

export function RelatedList(props: RelatedListProps): ReactNode {
  if (props.items.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.related.none')}</p>
  }

  return (
    <ul className="related">
      {props.items.map((item) => {
        const año = meta(item)
        const insignia = props.badge?.(item)
        const actual = esLaActual(item, props.current)

        // El contenido es el mismo para la fila actual y para las demás: lo único
        // que cambia es si va dentro de un enlace.
        const contenido = (
          <>
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
              {insignia === undefined ? null : <span className="badge">{insignia}</span>}
              {actual ? (
                // La palabra, no sólo el color: el estado tiene que leerse también
                // sin distinguir colores.
                <span className="badge badge--visto">
                  {t(DEFAULT_LOCALE, 'detail.related.current')}
                </span>
              ) : null}
            </span>
          </>
        )

        return (
          <li key={`${item.ref.providerId}:${item.ref.value}`}>
            {actual ? (
              // La fila actual no es un enlace: lleva a la ficha que ya se está
              // leyendo. Se pinta el mismo contenido y el mismo hueco de portada,
              // para que la columna no baile.
              <span className="related__item related__item--actual" aria-current="page">
                {contenido}
              </span>
            ) : (
              <Link
                className="related__item"
                to={buildPath('detail', {
                  providerId: item.ref.providerId,
                  ref: item.ref.value,
                })}
                title={item.title}
              >
                {contenido}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
