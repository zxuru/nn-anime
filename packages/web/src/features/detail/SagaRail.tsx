/**
 * Las entregas de la obra: temporadas, películas y OVA, y lo que la franquicia
 * añade.
 *
 * La ficha de «Dandadan» lleva a su segunda temporada y la de «Bleach» a sus
 * cuatro entregas de la guerra final. Lo que se ve aquí sale de **tres** lecturas
 * que ya existían —los hermanos de saga y de franquicia, que la base calcula con lo
 * que conoce, y lo que AniList declara de la obra emparejada— y de una decisión:
 * las tres se pintan en el mismo sitio, agrupadas por tipo.
 *
 * Antes eran dos secciones: el rail con lo local —que de una franquicia larga suele
 * conocer una sola entrega, la que se acaba de abrir, y por eso se quedaba en «no
 * hay más títulos»— y una fila aparte con lo de AniList. La misma obra salía dos
 * veces y con dos nombres distintos. Lo que hace `filasDeSaga` es juntarlas sin
 * repetir nada, y lo que hace este componente es enseñar los grupos:
 *
 * 1. **La entrega que se está viendo está en su grupo, marcada y sin enlace.**
 *    Saber dónde se está es la mitad de la función, y una lista de hermanos que
 *    no incluya la actual obliga a contar temporadas a mano.
 * 2. **Un grupo sin nada dentro no se pinta**: una sección vacía es ruido. Y si no
 *    hay ninguna entrega más, la sección **se explica** en vez de desaparecer, que
 *    es la regla que ya sigue la home.
 * 3. **El dato ajeno se atribuye.** Si alguna fila viene de AniList, debajo va de
 *    quién es: el rail mezcla lo local y lo de un tercero, y quien lo lee tiene que
 *    poder saberlo.
 */

import type { AniListRelatedItem } from '@nn-anime/core/api'
import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import type { AnimeSummary } from '@nn-anime/core/models'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { RelatedList } from './RelatedList'
import { filasDeSaga, type SagaGroups } from './saga'

export interface SagaRailInput {
  /** La entrega que se está viendo, con lo que la ficha sabe de ella. */
  readonly current: AnimeSummary
  /** Los hermanos de saga que el servidor encontró en lo que la base conoce. */
  readonly siblings: readonly AnimeSummary[]
  /** Los hermanos de franquicia: la misma lectura con la clave de la secuela. */
  readonly franchise: readonly AnimeSummary[]
  /** Lo que AniList declara de la obra emparejada. */
  readonly anilistRelated: readonly AniListRelatedItem[]
}

/**
 * Si hay alguna entrega más que la que se está viendo.
 *
 * El grupo de temporadas incluye siempre la actual —es lo que dice en qué temporada
 * se está—, así que una lista de uno no es una lista: es el título que ya está en
 * la cabecera de la página.
 */
export function hayMasEntregas(grupos: SagaGroups): boolean {
  const total = grupos.seasons.length + grupos.movies.length + grupos.ovas.length

  return total > 1 || grupos.franchise.length > 0
}

export interface SagaRailProps extends SagaRailInput {}

export function SagaRail(props: SagaRailProps): ReactNode {
  const grupos = filasDeSaga(props)

  if (!hayMasEntregas(grupos)) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.related.none')}</p>
  }

  return (
    <>
      {grupos.seasons.length <= 1 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.seasons')}</h3>
          <RelatedList items={grupos.seasons} />
        </section>
      )}

      {grupos.movies.length === 0 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.movies')}</h3>
          <RelatedList items={grupos.movies} />
        </section>
      )}

      {grupos.ovas.length === 0 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.ova')}</h3>
          <RelatedList items={grupos.ovas} />
        </section>
      )}

      {grupos.franchise.length === 0 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.franchise')}</h3>
          <RelatedList items={grupos.franchise} />
        </section>
      )}

      {grupos.deAniList ? (
        <p className="card__meta">{t(DEFAULT_LOCALE, 'detail.related.anilist')}</p>
      ) : null}
    </>
  )
}
