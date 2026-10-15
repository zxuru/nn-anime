/**
 * Fila de favoritos.
 *
 * El estado vacío dice **dónde** se marca un favorito: «todavía no has marcado
 * ninguno» sin más deja al usuario buscando el botón por toda la aplicación. Un
 * estado vacío útil es el que enseña el camino.
 *
 * En la vitrina son las piezas más pequeñas —una celda— y van **apagadas**: una
 * banda que ya has visto no puede competir con la que no has empezado. El tamaño
 * dice lo mismo que el tono: aquí se viene a mirar, no a empezar.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { t } from '../../i18n'

export interface FavoritesRowProps {
  readonly items: readonly AnimeSummary[]
}

export function FavoritesRow(props: FavoritesRowProps): ReactNode {
  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.favorites')}
        meta={t(DEFAULT_LOCALE, 'home.favorites.meta')}
      />

      <div className="seccion__cuerpo">
        {props.items.length === 0 ? (
          <p className="empty">{t(DEFAULT_LOCALE, 'home.favorites.empty')}</p>
        ) : (
          <Mosaico>
            {props.items.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                peso="s"
                recurso={recursoDe(indice)}
                meta={item.year === undefined ? undefined : String(item.year)}
                apagada
              />
            ))}
          </Mosaico>
        )}
      </div>
    </section>
  )
}
