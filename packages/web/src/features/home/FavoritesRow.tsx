/**
 * Fila de favoritos.
 *
 * El estado vacío dice **dónde** se marca un favorito: «todavía no has marcado
 * ninguno» sin más deja al usuario buscando el botón por toda la aplicación. Un
 * estado vacío útil es el que enseña el camino.
 *
 * Van **apagadas**: una banda que ya has visto no puede competir con la que no has
 * empezado. El tono dice ahora lo que antes decía el tamaño —eran las piezas más
 * pequeñas de la vitrina—: aquí se viene a mirar, no a empezar.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { Mosaico } from '../../components/Mosaico'
import { Pieza, recursoDe } from '../../components/Pieza'
import { SectionHeader } from '../../components/SectionHeader'
import { TramoVacio } from '../../components/TramoVacio'
import { t } from '../../i18n'
import { SeccionCargando } from './SeccionCargando'
import { cuentaDeTitulos } from './tramo'

export interface FavoritesRowProps {
  readonly items: readonly AnimeSummary[]
  /** Si la lectura de esta fila sigue en vuelo. */
  readonly cargando?: boolean | undefined
}

export function FavoritesRow(props: FavoritesRowProps): ReactNode {
  if (props.cargando === true) {
    return (
      <SeccionCargando
        title={t(DEFAULT_LOCALE, 'home.favorites')}
        meta={t(DEFAULT_LOCALE, 'home.favorites.meta')}
      />
    )
  }

  return (
    <section className="seccion">
      <SectionHeader
        title={t(DEFAULT_LOCALE, 'home.favorites')}
        meta={t(DEFAULT_LOCALE, 'home.favorites.meta')}
        {...(props.items.length === 0 ? {} : { cuenta: cuentaDeTitulos(props.items.length) })}
      />

      <div className="seccion__cuerpo">
        <Mosaico>
          {props.items.length === 0 ? (
            <TramoVacio texto={t(DEFAULT_LOCALE, 'home.favorites.empty')} />
          ) : (
            props.items.map((item, indice) => (
              <Pieza
                key={`${item.ref.providerId}:${item.ref.value}`}
                providerId={item.ref.providerId}
                ref={item.ref.value}
                title={item.title}
                to={`/anime/${encodeURIComponent(item.ref.providerId)}/${encodeURIComponent(item.ref.value)}`}
                recurso={recursoDe(indice)}
                meta={
                  item.year === undefined
                    ? undefined
                    : t(DEFAULT_LOCALE, 'detail.related.year', { year: item.year })
                }
                apagada
              />
            ))
          )}
        </Mosaico>
      </div>
    </section>
  )
}
