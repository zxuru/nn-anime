/**
 * Las entregas de la obra: temporadas, películas y especiales, y lo que la
 * franquicia añade.
 *
 * La ficha de «Dandadan» lleva a su segunda temporada y la de «Bleach» a sus
 * cuatro entregas de la guerra final, y eso sale de **una** lectura local —los
 * relacionados que ya existían— más la lectura de franquicia, que es la misma con
 * otra clave. Aquí no se pide nada a la red: lo que la base no conozca, no está.
 *
 * Tres decisiones que se ven en pantalla:
 *
 * 1. **La entrega que se está viendo está en su grupo, marcada y sin enlace.**
 *    Saber dónde se está es la mitad de la función, y una lista de hermanos que
 *    no incluya la actual obliga a contar temporadas a mano.
 * 2. **La franquicia no repite lo que ya está arriba.** «Naruto Shippuden» es
 *    franquicia y saga a la vez para la lectura; en la pantalla sale una vez, en
 *    el grupo que le toca. Si no aporta ninguna entrega nueva, su sección no se
 *    pinta: una sección vacía es ruido.
 * 3. **El orden es por año y, a igualdad de año, por número de temporada.** El año
 *    es el dato que la fuente da y el que ordena de verdad —Bleach 2004, 2022,
 *    2023, 2024, 2026—; el número desempata cuando dos entregas salieron el mismo
 *    año. Sin año no se inventa uno: esas filas van al final, en el orden estable
 *    de la lectura.
 */

import { DEFAULT_LOCALE } from '@nn-anime/core/i18n'
import { type AnimeSummary, normalizeQuery } from '@nn-anime/core/models'
import { seasonNumberOf } from '@nn-anime/core/titles'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { RelatedList } from './RelatedList'

/**
 * Los tipos que son una serie.
 *
 * El tipo que falta cuenta como serie: los proveedores que no lo declaran sirven
 * sobre todo temporadas, y mandarlas al grupo de películas sería peor que
 * dejarlas donde casi siempre van.
 */
const TIPOS_DE_SERIE: readonly string[] = ['tv', 'ona']

function esSerie(item: AnimeSummary): boolean {
  return item.kind === undefined || TIPOS_DE_SERIE.includes(item.kind)
}

/**
 * La clave de orden: año, después temporada, después título.
 *
 * `Infinity` para lo que no se sabe, que es lo que las manda al final sin
 * inventarles un año.
 */
function orden(a: AnimeSummary, b: AnimeSummary): number {
  const añoA = a.year ?? Number.POSITIVE_INFINITY
  const añoB = b.year ?? Number.POSITIVE_INFINITY
  if (añoA !== añoB) return añoA - añoB

  const temporadaA = seasonNumberOf(a.title) ?? Number.POSITIVE_INFINITY
  const temporadaB = seasonNumberOf(b.title) ?? Number.POSITIVE_INFINITY
  if (temporadaA !== temporadaB) return temporadaA - temporadaB

  return a.title.localeCompare(b.title)
}

export interface SagaRailInput {
  /** La entrega que se está viendo, con lo que la ficha sabe de ella. */
  readonly current: AnimeSummary
  /** Los hermanos de saga que el servidor encontró en lo que la base conoce. */
  readonly siblings: readonly AnimeSummary[]
  /** Los hermanos de franquicia: la misma lectura con la clave de la secuela. */
  readonly franchise: readonly AnimeSummary[]
}

export interface SagaGroups {
  readonly seasons: readonly AnimeSummary[]
  readonly movies: readonly AnimeSummary[]
  /** Sólo lo que no está ya en los dos grupos de arriba. */
  readonly franchise: readonly AnimeSummary[]
}

export function sagaGroups(input: SagaRailInput): SagaGroups {
  const todas = [input.current, ...input.siblings]
  const seasons = todas.filter(esSerie).sort(orden)
  const movies = todas.filter((item) => !esSerie(item)).sort(orden)

  // La franquicia contiene a la saga: sin este filtro, cada temporada saldría dos
  // veces en la misma columna. Se compara por título normalizado y no por
  // referencia, porque la misma obra puede venir de otro proveedor.
  const yaListadas = new Set(todas.map((item) => normalizeQuery(item.title)))

  return {
    seasons,
    movies,
    franchise: input.franchise
      .filter((item) => !yaListadas.has(normalizeQuery(item.title)))
      .sort(orden),
  }
}

/** La insignia de una temporada, o nada si el título no lleva número. */
function insigniaDeTemporada(item: AnimeSummary): string | undefined {
  const numero = seasonNumberOf(item.title)

  return numero === undefined ? undefined : t(DEFAULT_LOCALE, 'detail.season', { number: numero })
}

export interface SagaRailProps {
  readonly current: AnimeSummary
  readonly siblings: readonly AnimeSummary[]
  readonly franchise: readonly AnimeSummary[]
}

export function SagaRail(props: SagaRailProps): ReactNode {
  const grupos = sagaGroups(props)

  // Sin ninguna entrega más, la sección **se explica** en vez de dejar una fila
  // con el título que ya está en la cabecera de la página.
  if (grupos.seasons.length + grupos.movies.length <= 1 && grupos.franchise.length === 0) {
    return <p className="empty">{t(DEFAULT_LOCALE, 'detail.related.none')}</p>
  }

  return (
    <>
      {grupos.seasons.length <= 1 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.seasons')}</h3>
          <RelatedList
            items={grupos.seasons}
            current={props.current.ref}
            badge={insigniaDeTemporada}
          />
        </section>
      )}

      {grupos.movies.length === 0 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.movies')}</h3>
          <RelatedList items={grupos.movies} current={props.current.ref} />
        </section>
      )}

      {grupos.franchise.length === 0 ? null : (
        <section>
          <h3>{t(DEFAULT_LOCALE, 'detail.related.franchise')}</h3>
          <RelatedList items={grupos.franchise} current={props.current.ref} />
        </section>
      )}
    </>
  )
}
