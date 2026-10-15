/**
 * Fila de novedades: lo que publica la fuente.
 *
 * Es la única fila que puede tener contenido **sin** que el usuario haya buscado
 * nada, y la única con fecha: cuando la trae, se enseña el año del título —que es
 * lo que ya había— y no «hace dos días», que pide un formato relativo y un i18n de
 * fechas que no cambia lo que la fila resuelve.
 *
 * En la vitrina es un mosaico de piezas de dos de ancho: pesa más que un favorito y
 * menos que lo que se retoma, y eso lo dice su tamaño.
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
import { Pieza, pesoDelTramo, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface FeedRowProps {
  readonly items: readonly FeedItem[]
}

export function FeedRow(props: FeedRowProps): ReactNode {
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.feed')}
        meta={t(DEFAULT_LOCALE, 'home.feed.meta')}
      />

      <div className="seccion__cuerpo">
        {props.items.length === 0 ? (
          <p className="empty">{t(DEFAULT_LOCALE, 'home.feed.empty')}</p>
        ) : (
          <Mosaico>
            {props.items.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                peso={pesoDelTramo(indice, 'w', 'b')}
                recurso={recursoDe(indice)}
                year={item.year}
                meta={item.year === undefined ? undefined : String(item.year)}
              />
            ))}
          </Mosaico>
        )}
      </div>
    </section>
  )
}
