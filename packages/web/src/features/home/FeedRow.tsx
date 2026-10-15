/**
 * Fila de novedades: lo que publica la fuente.
 *
 * Es la única fila que puede tener contenido **sin** que el usuario haya buscado
 * nada, y la única con fecha: cuando la trae, se enseña el año del título —que es
 * lo que ya había— y no «hace dos días», que pide un formato relativo y un i18n de
 * fechas que no cambia lo que la fila resuelve.
 *
 * En la vitrina el tramo abre con la pieza más reciente —tres de ancho por dos de
 * alto—, sigue con una de dos de ancho y reparte el resto en celdas: lo último que
 * ha publicado la fuente manda dentro del tramo.
 *
 * El orden lo decide el servidor y la fila **no reordena**: una sola fuente de
 * verdad para las dos pantallas, y ordenar dos veces acaba en dos órdenes.
 *
 * Si el feed está vacío se explica en vez de esconderse: «ningún proveedor activo
 * publica novedades» es información, y una fila que desaparece deja al usuario sin
 * saber si la función existe.
 */

import type { FeedItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { PiezaVacia } from '../../components/PiezaVacia'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'
import { cuentaDeTitulos, pesoDeNovedades } from './tramo'

export interface FeedRowProps {
  readonly items: readonly FeedItem[]
}

export function FeedRow(props: FeedRowProps): ReactNode {
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.feed')}
        meta={t(DEFAULT_LOCALE, 'home.feed.meta')}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <PiezaVacia texto={t(DEFAULT_LOCALE, 'home.feed.empty')} />
          ) : (
            props.items.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                peso={pesoDeNovedades(indice)}
                recurso={recursoDe(indice)}
                year={item.year}
                meta={
                  item.year === undefined
                    ? undefined
                    : t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
                }
              />
            ))
          )}
        </Mosaico>
      </div>
    </section>
  )
}
