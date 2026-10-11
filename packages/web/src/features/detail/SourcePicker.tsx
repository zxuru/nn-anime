/**
 * Las otras fuentes que tienen esta misma obra.
 *
 * Es el «También en» que la búsqueda ya usa desde T66, en la ficha: la obra **no
 * se fusiona** —cada fuente tiene su referencia y sus episodios— y el enlace lleva
 * a la ficha de la otra, que es donde se elige. Sin otras fuentes la sección no se
 * pinta: un título que sólo está en un sitio no tiene nada que elegir, y un hueco
 * vacío lo único que dice es que algo falta.
 *
 * El servidor ya excluye la fuente que se está viendo; el filtro se repite aquí
 * porque es esta pantalla la que sabe cuál es, y una lista con la fuente de delante
 * sería un enlace a la misma ficha que se está leyendo.
 *
 * El nombre visible es el del proveedor y no su id: `jkanime` es un identificador,
 * y lo que el usuario reconoce es el nombre que la fuente declara.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Link } from '../../router'

export interface SourcePickerProps {
  /** Las otras fuentes, tal y como las devolvió `/sources`. */
  readonly items: readonly AnimeSummary[]
  /** El proveedor de la ficha, que no es una alternativa a sí misma. */
  readonly current: string
  /** El nombre declarado por cada proveedor, si se conoce. Si no, se usa su id. */
  readonly providerLabels: ReadonlyMap<string, string>
}

export function SourcePicker(props: SourcePickerProps): ReactNode {
  const otras = props.items.filter((item) => item.ref.providerId !== props.current)

  if (otras.length === 0) return null

  return (
    <section>
      <h2>{t(DEFAULT_LOCALE, 'detail.sources')}</h2>
      {/*
        La misma fila de botones que los modos: es la otra pregunta que se contesta
        en esta pantalla —dónde verlo, no cómo— y compartir la forma evita que el
        dedo aprenda dos lenguajes para lo mismo.
      */}
      <ul className="modes">
        {otras.map((item) => {
          const nombre = props.providerLabels.get(item.ref.providerId) ?? item.ref.providerId

          return (
            <li className="mode" key={`${item.ref.providerId}:${item.ref.value}`}>
              <Link
                className="button"
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                title={t(DEFAULT_LOCALE, 'detail.sourcesItem', {
                  title: item.title,
                  provider: nombre,
                })}
              >
                {nombre}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
